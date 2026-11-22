# 前端 ↔ Rust 命令契约

所有命令通过 `invoke` 调用，参数均为**单词**（避免 Tauri v1/v2 参数命名差异）。
成功返回 JSON（字段 `camelCase`），失败返回字符串错误；冲突保存返回以 `CONFLICT:` 开头的错误。

## Vault

| 命令 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `open_vault` | `path` | `VaultInfo` | 校验目录、创建 `attachments/themes/templates`、返回完整树 |
| `read_doc` | `vault`, `rel` | `{ content, mtime, encoding, eol, bom }` | 自动识别 UTF-8 / GBK / ANSI 与 LF / CRLF；`content` 已统一为 LF，BOM 已剥离 |
| `write_doc` | `vault`, `rel`, `content`, `mtime`, `force`, `encoding`, `eol`, `bom` | `{ mtime }` | `mtime` 为 0 或 `force` 时跳过冲突检查；冲突返回 `CONFLICT:<current>`；`encoding` 无法表示内容时返回 `ENCODING:` 错误且不写文件 |
| `create_entry` | `vault`, `rel`, `kind` | `void` | `kind`: `dir` / `file` |
| `rename_entry` | `vault`, `from`, `to` | `void` | 同时用于移动 |
| `delete_entry` | `vault`, `rel` | `void` | 删除目录时递归 |
| `save_attachment` | `vault`, `name`, `data` | `{ path, name }` | `data` 为 base64；自动去重命名 |
| `read_attachment` | `vault`, `rel` | `string \| null` | 返回 base64；>100MB 或缺省返回 `null` |

> `open_vault` 的文件树与 `search_vault` 使用同一套忽略规则：`.gitignore`、`.ignore`、`.markupignore`（无需 Vault 是 Git 仓库），并内置跳过 `node_modules`、`target`、`.git` 等目录。

## 搜索

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `search_vault` | `vault`, `query`, `limit?` | `SearchHit[]`：`{ path, title, snippet, score }` |

## 监听

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `watch_vault` | `root` | 递归监听，事件 `vault:changed`，payload 为路径数组 |
| `unwatch_vault` | — | 停止监听 |

## 导出

| 命令 | 参数 | 说明 |
| --- | --- | --- |
| `write_export_files` | `dest`, `files` | `files: { path, encoding: 'utf8'\|'base64', content }[]`；`dest` 为绝对目录，`path` 必须为安全的相对路径 |
| `write_export_file` | `path`, `content` | 单文件导出（绝对路径，由保存对话框选择） |

## 文本编码与换行符

读取顺序（`src-tauri/src/encoding.rs`）：

1. UTF-16 BOM → 报错（暂不支持，避免误解码）；
2. UTF-8 BOM → UTF-8，`bom = true`；
3. 含 NUL 字节 → 报错（二进制）；
4. 合法 UTF-8 → UTF-8；
5. GBK 解码无错误且包含 CJK 字符 → GBK；
6. 其余 → ANSI（Windows-1252）。

写入规则：

- 编辑器内容统一使用 LF；保存时按 `eol` 转换为 LF 或 CRLF。
- `utf8` 可选保留 BOM；`gbk` / `ansi` 不写 BOM。
- GBK / ANSI 编码后做反向解码校验；存在无法表示的字符时返回错误，**不写入文件**，避免产生乱码或 `?`。
- 新文件为空时，换行符由 Rust 侧按操作系统决定：Windows → `crlf`，其他 → `lf`。

## 安全规则

- 所有 `vault` + `rel` 组合经 `paths::resolve_in_vault` 规范化；拒绝绝对路径、`..` 越界。
- 导出相对路径经 `paths::is_safe_relative`，并再次校验落在 `dest` 内。
- 前端不持有任意文件系统权限，只通过上述命令操作。
