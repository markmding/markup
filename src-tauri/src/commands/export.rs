use crate::error::{AppError, AppResult};
use crate::paths::{is_safe_relative, normalize};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub path: String,
    /// `utf8` (default) or `base64`
    pub encoding: String,
    pub content: String,
}

/// Writes a folder export (index.html + attachments) into `dest`.
#[tauri::command]
pub fn write_export_files(dest: String, files: Vec<ExportFile>) -> AppResult<usize> {
    let dest = PathBuf::from(&dest);
    fs::create_dir_all(&dest)?;
    let dest_norm = normalize(&dest);

    let mut written = 0usize;
    for file in files {
        if !is_safe_relative(&file.path) {
            return Err(AppError::Message(format!("导出路径非法：{}", file.path)));
        }
        let target = normalize(&dest_norm.join(&file.path));
        if !target.starts_with(&dest_norm) {
            return Err(AppError::Message(format!("导出路径越界：{}", file.path)));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = match file.encoding.as_str() {
            "base64" => STANDARD
                .decode(file.content.as_bytes())
                .map_err(|error| AppError::Message(format!("附件编码错误：{error}")))?,
            _ => file.content.into_bytes(),
        };
        fs::write(&target, bytes)?;
        written += 1;
    }
    Ok(written)
}

/// Writes a single UTF-8 file (single-file HTML export / future PDF sidecar).
#[tauri::command]
pub fn write_export_file(path: String, content: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target, content.as_bytes())?;
    Ok(())
}
