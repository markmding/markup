import { readAttachment } from '../api/vault'
import type { ExportFile, HtmlExportMode } from '../types'
import { collectAssetPaths, renderMarkdown, renderMermaid } from './markdown'
import { buildDocument, exportThemeCss } from './themes'

export interface HtmlExportOptions {
  root: string | null
  markdown: string
  title: string
  mode: HtmlExportMode
  theme: 'light' | 'dark'
}

export interface HtmlExportResult {
  /** Standalone HTML document */
  html: string
  /** Files to write when exporting a folder (index.html + attachments) */
  files: ExportFile[]
  /** Referenced assets that could not be read from the vault */
  missing: string[]
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif'
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

function replaceImageSources(
  html: string,
  resolver: (src: string) => string | null
): string {
  return html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi,
    (whole, prefix: string, quote: string, src: string) => {
      const replacement = resolver(src)
      return replacement ? `${prefix}${quote}${replacement}${quote}` : whole
    }
  )
}

export async function buildHtmlExport(options: HtmlExportOptions): Promise<HtmlExportResult> {
  const body = await renderMermaid(await renderMarkdown(options.markdown), options.theme === 'dark')

  const assets = collectAssetPaths(options.markdown)
  const base64 = new Map<string, string>()
  const missing: string[] = []

  for (const asset of assets) {
    const data = options.root ? await readAttachment(options.root, asset) : null
    if (data) base64.set(asset, data)
    else missing.push(asset)
  }

  if (options.mode === 'single') {
    const inlined = replaceImageSources(body, (src) => {
      const key = src.replace(/^\.\//, '')
      const data = base64.get(key)
      return data ? `data:${mimeOf(key)};base64,${data}` : null
    })
    return {
      html: buildDocument(options.title, inlined, options.theme),
      files: [],
      missing
    }
  }

  const html = buildDocument(options.title, body, options.theme)
  const files: ExportFile[] = [
    { path: 'index.html', encoding: 'utf8', content: html },
    ...assets
      .filter((asset) => base64.has(asset))
      .map((asset) => ({
        path: asset,
        encoding: 'base64' as const,
        content: base64.get(asset)!
      }))
  ]
  return { html, files, missing }
}

/** Preview document used inside the export dialog iframe. */
export async function buildPreview(
  markdown: string,
  title: string,
  theme: 'light' | 'dark',
  root: string | null
): Promise<string> {
  const result = await buildHtmlExport({
    root,
    markdown,
    title,
    mode: 'single',
    theme
  })
  return result.html
}

export function themeCssFor(theme: 'light' | 'dark'): string {
  return exportThemeCss(theme)
}
