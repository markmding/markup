use crate::error::{AppError, AppResult};
use ignore::{Walk, WalkBuilder};
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Directories that never show up in the tree or the search index.
pub const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".obsidian",
    ".trash",
    ".markup",
];

/// Lexically normalizes a path (no filesystem access, so it also works for
/// paths that do not exist yet). Resolves `.` and `..` components.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Joins a vault-relative path and guarantees the result stays inside the
/// vault — the core of the F1 security rule.
pub fn resolve_in_vault(vault: &Path, rel: &str) -> AppResult<PathBuf> {
    let rel = rel.trim();
    if rel.is_empty() {
        return Err(AppError::Message("路径不能为空".into()));
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(AppError::OutsideVault(rel.to_string()));
    }
    let vault_norm = normalize(vault);
    let target = normalize(&vault_norm.join(rel_path));
    if !target.starts_with(&vault_norm) {
        return Err(AppError::OutsideVault(rel.to_string()));
    }
    Ok(target)
}

/// Vault traversal that honors `.gitignore`, `.ignore` and `.markupignore`.
///
/// - `require_git(false)`: apply `.gitignore` even when the folder is not a repo
/// - `parents(false)`: never read ignore files outside the vault
/// - `git_global(false)`: ignore the user's global git excludes
/// - hidden files are skipped; hard-coded build folders are pruned as well
pub fn vault_walker(root: &Path) -> Walk {
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(true)
        .parents(false)
        .ignore(true)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(true)
        .require_git(false);
    builder.add_custom_ignore_filename(".markupignore");
    builder.filter_entry(|entry| {
        if entry.depth() == 0 {
            return true;
        }
        let name = entry.file_name().to_string_lossy();
        !SKIP_DIRS.contains(&name.as_ref())
    });
    builder.build()
}

pub fn ensure_vault_dirs(root: &Path) -> AppResult<()> {
    for dir in ["attachments", "themes", "templates"] {
        fs::create_dir_all(root.join(dir))?;
    }
    Ok(())
}

/// True when a relative export path contains no absolute prefix or `..`.
pub fn is_safe_relative(rel: &str) -> bool {
    let path = Path::new(rel);
    !path.is_absolute()
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}
