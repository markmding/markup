//! Full-text search.
//!
//! v0 scaffold: a synchronous substring scan over Markdown files. It keeps the
//! command surface stable while tantivy integration (PRD F5, P1) is pending.
//! Replace the body with a background index; the response shape stays the same.

use crate::error::{AppError, AppResult};
use crate::paths::vault_walker;
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: usize,
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("md") | Some("markdown") | Some("MD") | Some("MDX")
    )
}

fn clamp_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn title_of(content: &str, fallback: &str) -> String {
    for line in content.lines().take(40) {
        if let Some(rest) = line.trim_start().strip_prefix('#') {
            let title = rest.trim_start_matches('#').trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    fallback.to_string()
}

#[tauri::command]
pub fn search_vault(
    vault: String,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    let root = Path::new(&vault);
    if !root.is_dir() {
        return Err(AppError::Message(format!("不是有效的文件夹：{vault}")));
    }
    let needle = query.trim().to_string();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let max = limit.unwrap_or(50).clamp(1, 200);

    // One-character queries produce no 2–3 grams; use the scan directly.
    if needle.chars().count() >= 2 {
        if let Ok(hits) = crate::index::search(&vault, &needle, max) {
            return Ok(hits);
        }
    }
    scan_search(vault, needle, Some(max))
}

/// Linear fallback used when tantivy cannot build an index.
fn scan_search(vault: String, query: String, limit: Option<usize>) -> AppResult<Vec<SearchHit>> {
    let root = Path::new(&vault);
    if !root.is_dir() {
        return Err(AppError::Message(format!("不是有效的文件夹：{vault}")));
    }
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(50).clamp(1, 200);

    let mut hits = Vec::new();
    for entry in vault_walker(root).flatten() {
        if entry.depth() == 0 {
            continue;
        }
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() || !is_markdown(entry.path()) {
            continue;
        }
        let content = match fs::read_to_string(entry.path()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let lower = content.to_lowercase();
        let score = lower.matches(&needle).count();
        if score == 0 {
            continue;
        }
        let index = lower.find(&needle).unwrap_or(0);
        let start = clamp_boundary(&content, index.saturating_sub(40));
        let end = clamp_boundary(&content, (index + needle.len() + 90).min(content.len()));
        let fallback = entry
            .path()
            .file_stem()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default();

        hits.push(SearchHit {
            path: entry
                .path()
                .strip_prefix(root)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/"),
            title: title_of(&content, &fallback),
            snippet: content[start..end].replace(['\n', '\r'], " "),
            score,
        });
    }

    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.path.cmp(&b.path)));
    hits.truncate(limit);
    Ok(hits)
}
