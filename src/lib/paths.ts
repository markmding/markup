import type { Eol } from './types'

/** Vault-relative path helpers. All paths use forward slashes. */

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index === -1 ? '' : normalized.slice(0, index)
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '')
}

export function stripExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? name : name.slice(0, index)
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** Common plain-text formats that can be edited in the source editor. */
const TEXT_EXTENSIONS = new Set([
  // prose / data
  'txt', 'text', 'log', 'csv', 'tsv',
  // style
  'css', 'scss', 'sass', 'less', 'styl',
  // script / markup
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'vue', 'svelte', 'astro', 'html', 'htm', 'xhtml', 'xml', 'svg',
  // config
  'json', 'jsonc', 'json5', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'properties', 'env',
  // shell
  'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1',
  // other languages
  'py', 'rb', 'php', 'lua', 'pl', 'r', 'rs', 'go', 'java', 'kt', 'kts',
  'swift', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx', 'cs', 'fs', 'm', 'mm',
  'sql', 'graphql', 'gql', 'proto', 'gradle', 'groovy'
])

/** Well-known text files without a (meaningful) extension. */
const TEXT_FILENAMES = new Set([
  'dockerfile',
  'makefile',
  'license',
  'readme',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.env',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc'
])

/** Lowercase extension without the dot; empty for names like `.env` or `README`. */
export function extensionOf(path: string): string {
  const name = basename(path).toLowerCase()
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1) : ''
}

/** Whether the file can be opened by the plain-text editor. */
export function isTextFile(path: string): boolean {
  if (isMarkdown(path)) return true
  const name = basename(path).toLowerCase()
  if (TEXT_FILENAMES.has(name)) return true
  return TEXT_EXTENSIONS.has(extensionOf(path))
}

/** Adds the original file's extension when the user renames without one. */
export function withDefaultExtension(name: string, original: string): string {
  if (/\.[^./\\]+$/.test(basename(name))) return name
  const ext = extensionOf(original)
  return ext ? `${name}.${ext}` : name
}

export function ensureMdExtension(name: string): string {
  return isMarkdown(name) ? name : `${name}.md`
}

/** New documents follow the host OS convention: CRLF on Windows, LF elsewhere. */
export function osDefaultEol(): Eol {
  if (typeof navigator === 'undefined') return 'lf'
  return /Windows/i.test(navigator.userAgent) ? 'crlf' : 'lf'
}

/** Rejects `..` traversal in user-supplied relative paths. */
export function isSafeRelativePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false
  return !normalized.split('/').some((segment) => segment === '..')
}
