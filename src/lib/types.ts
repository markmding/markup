export type EntryKind = 'dir' | 'file'

export interface VaultEntry {
  /** Display name, e.g. `指南` or `note.md` */
  name: string
  /** Vault-relative path with forward slashes, e.g. `指南/入门.md` */
  path: string
  kind: EntryKind
  /** Modification time in ms since epoch (files only) */
  mtime?: number
  children?: VaultEntry[]
}

export interface VaultInfo {
  /** Absolute vault root. In demo mode this is a virtual URI. */
  root: string
  name: string
  entries: VaultEntry[]
}

export type Encoding = 'utf8' | 'gbk' | 'ansi'
export type Eol = 'lf' | 'crlf'

export interface DocPayload {
  content: string
  mtime: number
  /** Detected on-disk encoding */
  encoding: Encoding
  /** Detected on-disk line ending */
  eol: Eol
  /** UTF-8 BOM present (only meaningful for utf8) */
  bom: boolean
}

/** Target format used when saving a document. */
export interface WriteOptions {
  encoding: Encoding
  eol: Eol
  bom: boolean
}

export interface WriteResult {
  mtime: number
}

export interface SearchHit {
  path: string
  title: string
  snippet: string
  score: number
}

export interface ExportFile {
  /** Destination-relative path, forward slashes */
  path: string
  encoding: 'utf8' | 'base64'
  content: string
}

export interface SaveAttachmentResult {
  /** Vault-relative path of the stored attachment */
  path: string
  name: string
}

export type ViewMode = 'wysiwyg' | 'source' | 'split'
export type HtmlExportMode = 'folder' | 'single'
