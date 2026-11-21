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
