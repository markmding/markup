//! Text decoding / encoding and line-ending handling.
//!
//! Contract:
//! - The editor always works on Unicode text with `\n` line endings.
//! - Reading decodes UTF-8 (with/without BOM), GBK and Windows-1252 ("ANSI"),
//!   strips the BOM, and remembers the original encoding/EOL.
//! - Writing re-applies the target EOL and encoding. If the text contains
//!   characters the target encoding cannot represent, the write is rejected
//!   instead of silently producing `?` / garbled bytes.

use crate::error::{AppError, AppResult};
use encoding_rs::{GBK, WINDOWS_1252};

pub const UTF8: &str = "utf8";
pub const GBK_LABEL: &str = "gbk";
pub const ANSI: &str = "ansi";

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug)]
pub struct DecodedText {
    pub text: String,
    pub encoding: String,
    pub bom: bool,
}

/// OS default for brand-new documents: CRLF on Windows, LF elsewhere.
pub fn default_eol() -> &'static str {
    if cfg!(windows) {
        "crlf"
    } else {
        "lf"
    }
}

pub fn detect_eol(text: &str) -> &'static str {
    if text.is_empty() {
        return default_eol();
    }
    let crlf = text.matches("\r\n").count();
    let total_lf = text.matches('\n').count();
    let bare_lf = total_lf.saturating_sub(crlf);
    if crlf > 0 && crlf >= bare_lf {
        "crlf"
    } else {
        "lf"
    }
}

pub fn normalize_eol(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn apply_eol(text: &str, eol: &str) -> String {
    let normalized = normalize_eol(text);
    match eol {
        "crlf" => normalized.replace('\n', "\r\n"),
        _ => normalized,
    }
}

fn contains_cjk(text: &str) -> bool {
    text.chars().any(|ch| {
        matches!(
            ch as u32,
            0x3000..=0x303F   // CJK punctuation
            | 0x3400..=0x4DBF // CJK extension A
            | 0x4E00..=0x9FFF // CJK unified ideographs
            | 0xF900..=0xFAFF // compatibility ideographs
            | 0xFF00..=0xFFEF // fullwidth forms
        )
    })
}

pub fn decode(bytes: &[u8]) -> AppResult<DecodedText> {
    if bytes.is_empty() {
        return Ok(DecodedText {
            text: String::new(),
            encoding: UTF8.into(),
            bom: false,
        });
    }

    // BOMs first: UTF-16 files are reported instead of being mis-decoded.
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        return Err(AppError::Message(
            "暂不支持 UTF-16 编码，请先转换为 UTF-8".into(),
        ));
    }

    if bytes.starts_with(UTF8_BOM) {
        let text = std::str::from_utf8(&bytes[UTF8_BOM.len()..])
            .map_err(|_| AppError::Message("文件声明为 UTF-8 BOM，但内容不是有效 UTF-8".into()))?;
        return Ok(DecodedText {
            text: text.to_string(),
            encoding: UTF8.into(),
            bom: true,
        });
    }

    if bytes.contains(&0) {
        return Err(AppError::Message("检测到二进制内容，无法作为 Markdown 打开".into()));
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(DecodedText {
            text: text.to_string(),
            encoding: UTF8.into(),
            bom: false,
        });
    }

    let (gbk_text, gbk_errors) = GBK.decode_without_bom_handling(bytes);
    if !gbk_errors && contains_cjk(&gbk_text) {
        return Ok(DecodedText {
            text: gbk_text.into_owned(),
            encoding: GBK_LABEL.into(),
            bom: false,
        });
    }

    // "ANSI" on Windows is a code page; Windows-1252 is the safe fallback
    // for western content. Every byte is mappable, so this cannot fail.
    let (ansi_text, _) = WINDOWS_1252.decode_without_bom_handling(bytes);
    Ok(DecodedText {
        text: ansi_text.into_owned(),
        encoding: ANSI.into(),
        bom: false,
    })
}

pub fn encode(text: &str, encoding: &str, bom: bool) -> AppResult<Vec<u8>> {
    match encoding {
        UTF8 => {
            let mut bytes = Vec::with_capacity(text.len() + 3);
            if bom {
                bytes.extend_from_slice(UTF8_BOM);
            }
            bytes.extend_from_slice(text.as_bytes());
            Ok(bytes)
        }
        GBK_LABEL => encode_single_byte_family(text, GBK, "GBK"),
        ANSI => encode_single_byte_family(text, WINDOWS_1252, "ANSI（Windows-1252）"),
        other => Err(AppError::Message(format!("不支持的编码：{other}"))),
    }
}

fn encode_single_byte_family(
    text: &str,
    encoding: &'static encoding_rs::Encoding,
    label: &str,
) -> AppResult<Vec<u8>> {
    let (bytes, _, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(AppError::Message(format!(
            "ENCODING:文档包含 {label} 无法表示的字符，已阻止保存。请切换到 UTF-8 后重试。"
        )));
    }
    // Round-trip check: never write bytes that decode back differently.
    let (roundtrip, decode_errors) = encoding.decode_without_bom_handling(&bytes);
    if decode_errors || roundtrip != text {
        return Err(AppError::Message(format!(
            "ENCODING:转换为 {label} 时校验失败，已阻止保存。请改用 UTF-8。"
        )));
    }
    Ok(bytes.into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_and_strips_utf8_bom() {
        let mut bytes = UTF8_BOM.to_vec();
        bytes.extend_from_slice("你好".as_bytes());
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.text, "你好");
        assert_eq!(decoded.encoding, UTF8);
        assert!(decoded.bom);
    }

    #[test]
    fn decodes_gbk_chinese() {
        let bytes = [0xD6, 0xD0, 0xCE, 0xC4]; // 中文
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.text, "中文");
        assert_eq!(decoded.encoding, GBK_LABEL);
    }

    #[test]
    fn falls_back_to_ansi_for_western_bytes() {
        let bytes = [0xE9]; // é in Windows-1252
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.text, "é");
        assert_eq!(decoded.encoding, ANSI);
    }

    #[test]
    fn gbk_encoding_roundtrips() {
        let bytes = encode("中文\n第二行", GBK_LABEL, false).unwrap();
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.text, "中文\n第二行");
    }

    #[test]
    fn rejects_characters_gbk_cannot_represent() {
        let result = encode("emoji 🙂", GBK_LABEL, false);
        assert!(result.is_err());
    }

    #[test]
    fn eol_detection_and_conversion() {
        assert_eq!(detect_eol("a\r\nb\r\n"), "crlf");
        assert_eq!(detect_eol("a\nb\n"), "lf");
        assert_eq!(apply_eol("a\nb\n", "crlf"), "a\r\nb\r\n");
        assert_eq!(normalize_eol("a\r\nb\r"), "a\nb\n");
    }
}
