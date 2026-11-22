use crate::encoding;
use crate::error::{AppError, AppResult};
use crate::paths::{ensure_vault_dirs, normalize, resolve_in_vault, vault_walker};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ATTACHMENT_BYTES: u64 = 100 * 1024 * 1024;
const MAX_TREE_DEPTH: usize = 20;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Entry>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
    pub entries: Vec<Entry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocPayload {
    pub content: String,
    pub mtime: u64,
    /// `utf8` | `gbk` | `ansi`
    pub encoding: String,
    /// `lf` | `crlf`
    pub eol: String,
    pub bom: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub mtime: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentResult {
    pub path: String,
    pub name: String,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn to_rel(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Collects the paths approved by the ignore-aware walker, then builds the
/// nested tree from them. This keeps .gitignore / .markupignore semantics in
/// one place while preserving sorted, lazily-shaped output.
fn read_tree(root: &Path) -> AppResult<Vec<Entry>> {
    let mut allowed = HashSet::new();
    for result in vault_walker(root) {
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        if let Ok(rel) = entry.path().strip_prefix(root) {
            allowed.insert(rel.to_path_buf());
        }
    }
    Ok(build_tree(root, Path::new(""), &allowed, 0))
}

fn build_tree(root: &Path, rel: &Path, allowed: &HashSet<PathBuf>, depth: usize) -> Vec<Entry> {
    if depth > MAX_TREE_DEPTH {
        return Vec::new();
    }
    let dir = if rel.as_os_str().is_empty() {
        root.to_path_buf()
    } else {
        root.join(rel)
    };
    let Ok(read) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        let child_rel = rel.join(item.file_name());
        if !allowed.contains(&child_rel) {
            continue;
        }
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        let child_path = item.path();
        let rel_string = to_rel(root, &child_path);

        if file_type.is_dir() {
            let children = build_tree(root, &child_rel, allowed, depth + 1);
            entries.push(Entry {
                name,
                path: rel_string,
                kind: "dir".into(),
                mtime: None,
                children: Some(children),
            });
        } else if file_type.is_file() {
            let mtime = item.metadata().ok().map(|meta| mtime_ms(&meta));
            entries.push(Entry {
                name,
                path: rel_string,
                kind: "file".into(),
                mtime,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
        ("dir", "file") => Ordering::Less,
        ("file", "dir") => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    entries
}

#[tauri::command]
pub fn open_vault(path: String) -> AppResult<VaultInfo> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(AppError::Message(format!("不是有效的文件夹：{path}")));
    }
    let root = root.canonicalize()?;
    ensure_vault_dirs(&root)?;

    let entries = read_tree(&root)?;
    let name = root
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vault".into());

    Ok(VaultInfo {
        root: root.to_string_lossy().replace('\\', "/"),
        name,
        entries,
    })
}

#[tauri::command]
pub fn read_doc(vault: String, rel: String) -> AppResult<DocPayload> {
    let root = PathBuf::from(&vault);
    let path = resolve_in_vault(&root, &rel)?;
    let meta = fs::metadata(&path).map_err(|_| AppError::Message(format!("文件不存在：{rel}")))?;
    if !meta.is_file() {
        return Err(AppError::Message(format!("不是文件：{rel}")));
    }
    let bytes = fs::read(&path)?;
    let decoded = encoding::decode(&bytes)?;
    let eol = encoding::detect_eol(&decoded.text);
    Ok(DocPayload {
        content: encoding::normalize_eol(&decoded.text),
        mtime: mtime_ms(&meta),
        encoding: decoded.encoding,
        eol: eol.to_string(),
        bom: decoded.bom,
    })
}

#[tauri::command]
pub fn write_doc(
    vault: String,
    rel: String,
    content: String,
    mtime: u64,
    force: bool,
    encoding: String,
    eol: String,
    bom: bool,
) -> AppResult<WriteResult> {
    let root = PathBuf::from(&vault);
    let path = resolve_in_vault(&root, &rel)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    if eol != "lf" && eol != "crlf" {
        return Err(AppError::Message(format!("不支持的换行符：{eol}")));
    }

    if path.exists() && !force && mtime != 0 {
        let current = fs::metadata(&path).map(|meta| mtime_ms(&meta)).unwrap_or(0);
        if current != mtime {
            return Err(AppError::Message(format!("CONFLICT:{current}")));
        }
    }

    let with_eol = encoding::apply_eol(&content, &eol);
    let bytes = encoding::encode(&with_eol, &encoding, bom)?;
    fs::write(&path, &bytes)?;
    let meta = fs::metadata(&path)?;
    Ok(WriteResult {
        mtime: mtime_ms(&meta),
    })
}

#[tauri::command]
pub fn create_entry(vault: String, rel: String, kind: String) -> AppResult<()> {
    let root = PathBuf::from(&vault);
    let path = resolve_in_vault(&root, &rel)?;
    if path.exists() {
        return Err(AppError::Message(format!("已存在：{rel}")));
    }
    match kind.as_str() {
        "dir" => fs::create_dir_all(&path)?,
        "file" => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&path, b"")?;
        }
        other => return Err(AppError::Message(format!("未知类型：{other}"))),
    }
    Ok(())
}

#[tauri::command]
pub fn rename_entry(vault: String, from: String, to: String) -> AppResult<()> {
    let root = PathBuf::from(&vault);
    let source = resolve_in_vault(&root, &from)?;
    let target = resolve_in_vault(&root, &to)?;
    if !source.exists() {
        return Err(AppError::Message(format!("源路径不存在：{from}")));
    }
    if target.exists() {
        return Err(AppError::Message(format!("目标已存在：{to}")));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &target)?;
    Ok(())
}

/// Moves an entry into the vault-local `.markup-trash` folder instead of
/// deleting it permanently. The trash folder is hidden from the tree/search.
#[tauri::command]
pub fn delete_entry(vault: String, rel: String) -> AppResult<()> {
    let root = PathBuf::from(&vault);
    let path = resolve_in_vault(&root, &rel)?;
    if normalize(&path) == normalize(&root) {
        return Err(AppError::Message("不能删除 Vault 根目录".into()));
    }
    if !path.exists() {
        return Err(AppError::Message(format!("路径不存在：{rel}")));
    }

    let trash = root.join(".markup-trash");
    fs::create_dir_all(&trash)?;

    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".into());
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    let mut target = trash.join(format!("{stamp}-{name}"));
    let mut index = 1;
    while target.exists() {
        target = trash.join(format!("{stamp}-{index}-{name}"));
        index += 1;
    }

    fs::rename(&path, &target)?;
    Ok(())
}

fn sanitize_file_name(name: &str) -> AppResult<String> {
    let base = Path::new(name)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .filter(|value| !value.is_empty() && value != "." && value != "..")
        .ok_or_else(|| AppError::Message("附件文件名无效".into()))?;
    Ok(base
        .chars()
        .map(|ch| if "<>:\"/\\|?*".contains(ch) { '_' } else { ch })
        .collect())
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());
    let ext = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..10_000 {
        let candidate = dir.join(format!("{stem}-{index}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{stem}-{}{ext}", std::process::id()))
}

#[tauri::command]
pub fn save_attachment(vault: String, name: String, data: String) -> AppResult<AttachmentResult> {
    let root = PathBuf::from(&vault);
    let attachments = root.join("attachments");
    fs::create_dir_all(&attachments)?;

    let safe_name = sanitize_file_name(&name)?;
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|error| AppError::Message(format!("附件解码失败：{error}")))?;
    let target = unique_path(&attachments, &safe_name);
    fs::write(&target, &bytes)?;

    let stored = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or(safe_name);
    Ok(AttachmentResult {
        path: format!("attachments/{stored}"),
        name: stored,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search_vault;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_vault() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("markup-test-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn gbk_crlf_roundtrip() {
        let root = temp_vault();
        let vault = root.to_string_lossy().to_string();

        write_doc(
            vault.clone(),
            "note.md".into(),
            "中文\n第二行\n".into(),
            0,
            true,
            "gbk".into(),
            "crlf".into(),
            false,
        )
        .unwrap();

        let raw = fs::read(root.join("note.md")).unwrap();
        assert_eq!(&raw[..2], &[0xD6, 0xD0]); // 中 in GBK
        assert!(raw.windows(2).any(|pair| pair == b"\r\n"));

        let doc = read_doc(vault, "note.md".into()).unwrap();
        assert_eq!(doc.content, "中文\n第二行\n");
        assert_eq!(doc.encoding, "gbk");
        assert_eq!(doc.eol, "crlf");

        fs::remove_dir_all(&root).ok();
    }

    fn collect_names(entries: &[Entry], out: &mut Vec<String>) {
        for entry in entries {
            out.push(entry.name.clone());
            if let Some(children) = &entry.children {
                collect_names(children, out);
            }
        }
    }

    #[test]
    fn respects_gitignore_and_markupignore_in_tree_and_search() {
        let root = temp_vault();
        fs::write(root.join("keep.md"), "# keep\nneedle").unwrap();
        fs::write(root.join("secret.md"), "needle").unwrap();
        fs::write(root.join(".gitignore"), "secret.md\ndrafts/\n").unwrap();
        fs::create_dir_all(root.join("drafts")).unwrap();
        fs::write(root.join("drafts/note.md"), "needle").unwrap();
        fs::write(root.join(".markupignore"), "private/\n").unwrap();
        fs::create_dir_all(root.join("private")).unwrap();
        fs::write(root.join("private/hidden.md"), "needle").unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/dep.md"), "needle").unwrap();

        let vault = root.to_string_lossy().to_string();
        let info = open_vault(vault.clone()).unwrap();
        let mut names = Vec::new();
        collect_names(&info.entries, &mut names);

        assert!(names.iter().any(|name| name == "keep.md"));
        assert!(!names.iter().any(|name| name == "secret.md"));
        assert!(!names.iter().any(|name| name == "note.md"));
        assert!(!names.iter().any(|name| name == "hidden.md"));
        assert!(!names.iter().any(|name| name == "node_modules"));

        let hits = search_vault(vault, "needle".into(), None).unwrap();
        assert_eq!(hits.len(), 1, "ignored files must not be searchable");
        assert_eq!(hits[0].path, "keep.md");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_moves_entry_into_trash() {
        let root = temp_vault();
        fs::write(root.join("keep.md"), "# keep").unwrap();

        let vault = root.to_string_lossy().to_string();
        delete_entry(vault, "keep.md".into()).unwrap();

        assert!(!root.join("keep.md").exists());
        let trash = root.join(".markup-trash");
        let entries: Vec<_> = fs::read_dir(&trash).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].file_name().to_string_lossy().contains("keep.md"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn tantivy_finds_chinese_substrings() {
        let root = temp_vault();
        fs::write(root.join("a.md"), "# 中文标题\n这是中文检索测试").unwrap();
        fs::write(root.join("b.md"), "无关内容").unwrap();

        let vault = root.to_string_lossy().to_string();
        let hits = search_vault(vault, "中文".into(), None).unwrap();
        assert!(hits.iter().any(|hit| hit.path == "a.md"));
        assert!(!hits.iter().any(|hit| hit.path == "b.md"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn keeps_file_intact_when_encoding_cannot_represent_text() {
        let root = temp_vault();
        let vault = root.to_string_lossy().to_string();

        write_doc(
            vault.clone(),
            "note.md".into(),
            "原始内容\n".into(),
            0,
            true,
            "utf8".into(),
            "lf".into(),
            false,
        )
        .unwrap();

        let result = write_doc(
            vault.clone(),
            "note.md".into(),
            "含 emoji 🙂\n".into(),
            0,
            true,
            "gbk".into(),
            "lf".into(),
            false,
        );
        assert!(result.is_err());

        let doc = read_doc(vault, "note.md".into()).unwrap();
        assert_eq!(doc.content, "原始内容\n");
        assert_eq!(doc.encoding, "utf8");

        fs::remove_dir_all(&root).ok();
    }
}

#[tauri::command]
pub fn read_attachment(vault: String, rel: String) -> AppResult<Option<String>> {
    let root = PathBuf::from(&vault);
    let path = resolve_in_vault(&root, &rel)?;
    if !path.exists() {
        return Ok(None);
    }
    let meta = fs::metadata(&path)?;
    if !meta.is_file() || meta.len() > MAX_ATTACHMENT_BYTES {
        return Ok(None);
    }
    let bytes = fs::read(&path)?;
    Ok(Some(STANDARD.encode(bytes)))
}
