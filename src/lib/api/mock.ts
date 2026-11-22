import { basename, dirname, osDefaultEol } from '../paths'
import type {
  DocPayload,
  Eol,
  Encoding,
  SaveAttachmentResult,
  SearchHit,
  VaultEntry,
  VaultInfo,
  WriteOptions,
  WriteResult
} from '../types'

/** Virtual root used by the browser-only demo vault. */
export const DEMO_ROOT = 'markup-demo://vault'

const WELCOME = `# 欢迎使用 Markup

Markup 是一个**本地优先**的 Markdown 知识库编辑器：文件保存在你自己的文件夹里，使用标准 Markdown 存储。

## 快速上手

1. 点击左上角「打开文件夹」选择你的 Vault；
2. 使用 \`Ctrl + S\` 保存，\`Ctrl + N\` 新建笔记；
3. 输入 \`/\` 唤起斜杠菜单，插入表格、公式、Mermaid 等块。

## 公式与图表

行内公式 $E = mc^2$，块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

\`\`\`mermaid
flowchart LR
  A[打开 Vault] --> B[编辑 Markdown]
  B --> C{需要导出?}
  C -->|是| D[PDF / HTML]
  C -->|否| B
\`\`\`

## 代码块

\`\`\`ts
export function greeting(name: string): string {
  return \`你好，\${name}\`
}
\`\`\`

> [!TIP] 这是 Callout
> 编辑体验对标 Typora，文件管理对标 Obsidian。

| 能力 | 状态 |
| ---- | ---- |
| WYSIWYG 编辑 | ✅ |
| 源码视图 | ✅ |
| Mermaid | ✅ |
| 导出 PDF/HTML | ✅ |
`

const SHORTCUTS = `# 快捷键

| 快捷键 | 功能 |
| ------ | ---- |
| Ctrl + B | 加粗 |
| Ctrl + I | 斜体 |
| Ctrl + S | 保存 |
| Ctrl + N | 新建笔记 |
| Ctrl + \\\\ | 切换源码视图 |
`

const EXPORT_GUIDE = `# 导出指南

- **HTML · 独立文件夹**：\`index.html\` + \`attachments/\`，适合二次编辑；
- **HTML · 单文件**：图片以 base64 内嵌，可直接离线分发；
- **PDF**：基于系统打印，支持页边距、页码起始值与页面范围。

> 导出的样式跟随当前主题，主题需要包含 \`@media print\` 规则。
`

const DEMO_THEME = `/* Markup 示例主题：暖阳 */
.milkdown .ProseMirror h1,
.milkdown .ProseMirror h2,
.markup-doc h1,
.markup-doc h2 {
  color: #b45309;
}

.milkdown .ProseMirror blockquote,
.markup-doc blockquote {
  border-left-color: #f59e0b;
}
`

const TEMPLATE = `# 新文档

## 概要

## 正文

## 参考
`

interface DocMeta {
  encoding: Encoding
  eol: Eol
  bom: boolean
}

interface MockState {
  root: string
  name: string
  files: Map<string, string>
  mtimes: Map<string, number>
  meta: Map<string, DocMeta>
  attachments: Map<string, string>
  dirs: Set<string>
  /** Dev-only: next save for these paths fails with a CONFLICT (banner test). */
  conflictOnce: Set<string>
}

function createState(): MockState {
  const now = Date.now()
  const files = new Map<string, string>([
    ['欢迎使用 Markup.md', WELCOME],
    ['指南/快捷键.md', SHORTCUTS],
    ['指南/导出指南.md', EXPORT_GUIDE],
    ['templates/默认模板.md', TEMPLATE],
    ['themes/暖阳.css', DEMO_THEME]
  ])
  const mtimes = new Map<string, number>()
  const meta = new Map<string, DocMeta>()
  for (const key of files.keys()) {
    mtimes.set(key, now)
    meta.set(key, { encoding: 'utf8', eol: 'lf', bom: false })
  }
  return {
    root: DEMO_ROOT,
    name: 'Markup 示例库',
    files,
    mtimes,
    meta,
    attachments: new Map<string, string>(),
    dirs: new Set(['attachments', 'themes', 'templates', '指南']),
    conflictOnce: new Set<string>()
  }
}

let state = createState()

/** Rebuilds the tree from the flat file map so create/rename/delete show up. */
function buildTree(snapshot: MockState): VaultEntry[] {
  const top: VaultEntry[] = []
  const known = new Map<string, VaultEntry>()

  const ensureDir = (path: string): VaultEntry => {
    const existing = known.get(path)
    if (existing) return existing
    const entry: VaultEntry = {
      name: basename(path),
      path,
      kind: 'dir',
      children: []
    }
    known.set(path, entry)
    const parent = dirname(path)
    if (parent) ensureDir(parent).children!.push(entry)
    else top.push(entry)
    return entry
  }

  for (const dir of snapshot.dirs) ensureDir(dir)

  for (const [path, _content] of snapshot.files) {
    if (path.endsWith('/.keep')) continue
    const parent = dirname(path)
    const entry: VaultEntry = {
      name: basename(path),
      path,
      kind: 'file',
      mtime: snapshot.mtimes.get(path) ?? Date.now()
    }
    if (parent) ensureDir(parent).children!.push(entry)
    else top.push(entry)
  }

  const sort = (list: VaultEntry[]): void => {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
    for (const item of list) if (item.children) sort(item.children)
  }
  sort(top)
  return top
}

function getFile(path: string): string {
  const content = state.files.get(path)
  if (content === undefined) throw new Error(`演示库中不存在文件：${path}`)
  return content
}

function replacePrefix(from: string, to: string): void {
  if (state.dirs.has(from)) {
    state.dirs = new Set(
      [...state.dirs].map((dir) =>
        dir === from ? to : dir.startsWith(`${from}/`) ? `${to}${dir.slice(from.length)}` : dir
      )
    )
  }
  for (const key of [...state.files.keys()]) {
    if (key !== from && !key.startsWith(`${from}/`)) continue
    const content = state.files.get(key) ?? ''
    const mtime = state.mtimes.get(key) ?? Date.now()
    const docMeta = state.meta.get(key)
    state.files.delete(key)
    state.mtimes.delete(key)
    state.meta.delete(key)
    const nextKey = key === from ? to : `${to}${key.slice(from.length)}`
    state.files.set(nextKey, content)
    state.mtimes.set(nextKey, mtime)
    if (docMeta) state.meta.set(nextKey, docMeta)
  }
}

function removePrefix(path: string): void {
  state.dirs = new Set(
    [...state.dirs].filter((dir) => dir !== path && !dir.startsWith(`${path}/`))
  )
  for (const key of [...state.files.keys()]) {
    if (key === path || key.startsWith(`${path}/`)) {
      state.files.delete(key)
      state.mtimes.delete(key)
      state.meta.delete(key)
    }
  }
}

export const mock = {
  open(): VaultInfo {
    return { root: state.root, name: state.name, entries: buildTree(state) }
  },

  readDoc(path: string): DocPayload {
    const docMeta = state.meta.get(path) ?? {
      encoding: 'utf8' as Encoding,
      eol: osDefaultEol(),
      bom: false
    }
    return {
      content: getFile(path),
      mtime: state.mtimes.get(path) ?? Date.now(),
      encoding: docMeta.encoding,
      eol: docMeta.eol,
      bom: docMeta.bom
    }
  },

  writeDoc(path: string, content: string, options: WriteOptions): WriteResult {
    if (state.conflictOnce.has(path)) {
      state.conflictOnce.delete(path)
      throw new Error(`CONFLICT:${Date.now()}`)
    }
    state.files.set(path, content)
    const mtime = Date.now()
    state.mtimes.set(path, mtime)
    state.meta.set(path, {
      encoding: options.encoding,
      eol: options.eol,
      bom: options.encoding === 'utf8' ? options.bom : false
    })
    return { mtime }
  },

  createEntry(path: string, kind: 'dir' | 'file'): void {
    if (kind === 'dir') {
      state.dirs.add(path)
      return
    }
    state.files.set(path, '')
    state.mtimes.set(path, Date.now())
    state.meta.set(path, { encoding: 'utf8', eol: osDefaultEol(), bom: false })
  },

  renameEntry(from: string, to: string): void {
    replacePrefix(from, to)
  },

  deleteEntry(path: string): void {
    removePrefix(path)
  },

  saveAttachment(name: string, base64: string): SaveAttachmentResult {
    let stored = name
    let path = `attachments/${stored}`
    let index = 1
    while (state.attachments.has(path)) {
      const dot = name.lastIndexOf('.')
      stored =
        dot > 0
          ? `${name.slice(0, dot)}-${index}${name.slice(dot)}`
          : `${name}-${index}`
      path = `attachments/${stored}`
      index += 1
    }
    state.attachments.set(path, base64)
    return { path, name: stored }
  },

  readAttachment(path: string): string | null {
    return state.attachments.get(path) ?? null
  },

  search(query: string): SearchHit[] {
    const needle = query.toLowerCase()
    const hits: SearchHit[] = []
    for (const [path, content] of state.files) {
      if (!path.endsWith('.md')) continue
      const index = content.toLowerCase().indexOf(needle)
      if (index === -1) continue
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? path
      const start = Math.max(0, index - 40)
      hits.push({
        path,
        title,
        snippet: content.slice(start, index + needle.length + 80).replace(/\n/g, ' '),
        score: 1
      })
    }
    return hits
  },

  /** Dev-only helper used by Settings/automation to exercise the conflict banner. */
  markExternalChange(path: string): void {
    const current = state.files.get(path) ?? ''
    state.files.set(path, `${current}\n\n> 来自外部的修改\n`)
    state.mtimes.set(path, Date.now())
    state.conflictOnce.add(path)
  },

  reset(): void {
    state = createState()
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as Window & { __markupMock?: typeof mock }).__markupMock = mock
}
