//! Tantivy full-text index.
//!
//! The index lives in RAM and is synchronized lazily on the first search:
//! new/changed files are re-indexed by mtime, deleted files are removed.
//! Chinese text is indexed with a 2–3 gram tokenizer so substring queries work
//! without a dictionary. The command layer falls back to a linear scan if the
//! index cannot be built.

use crate::commands::SearchHit;
use crate::error::{AppError, AppResult};
use crate::paths::vault_walker;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{
    Field, IndexRecordOption, Schema, TextFieldIndexing, TextOptions, Value, STORED, STRING,
};
use tantivy::tokenizer::{LowerCaser, NgramTokenizer, TextAnalyzer};
use tantivy::{doc, Index, IndexReader, IndexWriter, Term};

const WRITER_MEMORY: usize = 50_000_000;

struct CachedIndex {
    root: String,
    index: Index,
    reader: IndexReader,
    writer: IndexWriter,
    path_field: Field,
    title_field: Field,
    body_field: Field,
    mtimes: HashMap<String, u64>,
}

static CACHE: OnceLock<Mutex<Option<CachedIndex>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<CachedIndex>> {
    CACHE.get_or_init(|| Mutex::new(None))
}

fn text_options() -> TextOptions {
    TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("ngram")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored()
}

fn create_index(root: &str) -> AppResult<CachedIndex> {
    let mut schema_builder = Schema::builder();
    let path_field = schema_builder.add_text_field("path", STRING | STORED);
    let title_field = schema_builder.add_text_field("title", text_options());
    let body_field = schema_builder.add_text_field("body", text_options());
    let schema = schema_builder.build();

    let index = Index::create_in_ram(schema);
    let ngram = NgramTokenizer::new(2, 3, false)
        .map_err(|error| AppError::Message(format!("分词器初始化失败：{error}")))?;
    index.tokenizers().register(
        "ngram",
        TextAnalyzer::builder(ngram).filter(LowerCaser).build(),
    );

    let reader = index.reader()?;
    let writer = index.writer(WRITER_MEMORY)?;
    Ok(CachedIndex {
        root: root.to_string(),
        index,
        reader,
        writer,
        path_field,
        title_field,
        body_field,
        mtimes: HashMap::new(),
    })
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("md") | Some("markdown") | Some("MD") | Some("MDX")
    )
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

fn sync(cached: &mut CachedIndex) -> AppResult<()> {
    let root = Path::new(&cached.root);
    let path_field = cached.path_field;
    let title_field = cached.title_field;
    let body_field = cached.body_field;
    let writer = &mut cached.writer;

    let mut current: HashMap<String, u64> = HashMap::new();
    let mut changed = false;

    for result in vault_walker(root) {
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() || !is_markdown(entry.path()) {
            continue;
        }
        let Ok(rel_path) = entry.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel_path.to_string_lossy().replace('\\', "/");
        let mtime = entry.metadata().map(|meta| mtime_ms(&meta)).unwrap_or(0);
        current.insert(rel.clone(), mtime);

        if cached.mtimes.get(&rel) == Some(&mtime) {
            continue;
        }
        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        let title = title_of(&content, &rel);
        writer.delete_term(Term::from_field_text(path_field, &rel));
        writer.add_document(doc!(
            path_field => rel,
            title_field => title,
            body_field => content
        ))?;
        changed = true;
    }

    let removed: Vec<String> = cached
        .mtimes
        .keys()
        .filter(|path| !current.contains_key(*path))
        .cloned()
        .collect();
    for rel in removed {
        writer.delete_term(Term::from_field_text(path_field, &rel));
        changed = true;
    }

    if changed {
        writer.commit()?;
        cached.reader.reload()?;
    }
    cached.mtimes = current;
    Ok(())
}

fn clamp_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn snippet_of(body: &str, needle: &str) -> String {
    let lower = body.to_lowercase();
    let Some(index) = lower.find(needle) else {
        return body.chars().take(120).collect();
    };
    let start = clamp_boundary(body, index.saturating_sub(40));
    let end = clamp_boundary(body, (index + needle.len() + 90).min(body.len()));
    body[start..end].replace(['\n', '\r'], " ")
}

pub fn search(root: &str, query: &str, limit: usize) -> AppResult<Vec<SearchHit>> {
    let mut guard = cache()
        .lock()
        .map_err(|_| AppError::Message("搜索索引锁不可用".into()))?;

    if guard
        .as_ref()
        .map(|cached| cached.root != root)
        .unwrap_or(true)
    {
        *guard = None;
    }
    if guard.is_none() {
        *guard = Some(create_index(root)?);
    }
    let cached = guard.as_mut().expect("index was just created");
    sync(cached)?;

    let searcher = cached.reader.searcher();
    let mut parser =
        QueryParser::for_index(&cached.index, vec![cached.title_field, cached.body_field]);
    parser.set_conjunction_by_default();
    let parsed = parser
        .parse_query(query)
        .map_err(|error| AppError::Message(format!("搜索语法错误：{error}")))?;

    let top = searcher.search(&parsed, &TopDocs::with_limit(limit))?;
    let mut hits = Vec::new();
    for (score, address) in top {
        let document = searcher.doc::<tantivy::TantivyDocument>(address)?;
        let path = document
            .get_first(cached.path_field)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if path.is_empty() {
            continue;
        }
        let title = document
            .get_first(cached.title_field)
            .and_then(|value| value.as_str())
            .unwrap_or(&path)
            .to_string();
        let body = document
            .get_first(cached.body_field)
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        hits.push(SearchHit {
            path,
            title,
            snippet: snippet_of(body, &query.to_lowercase()),
            score: (score.max(0.0) * 100.0) as usize + 1,
        });
    }
    Ok(hits)
}
