import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { renderMermaidSvg } from '../mermaid'

const CALLOUT_LABEL: Record<string, string> = {
  note: '注意',
  tip: '提示',
  warning: '警告',
  danger: '危险',
  info: '信息',
  success: '完成'
}

/**
 * Turns GFM-style callouts (`> [!TIP] title`) into
 * `<div class="callout callout-tip">` while keeping the body as markdown.
 * Only plain-text titles are supported in this scaffold.
 */
function remarkCallout() {
  return (tree: unknown) => {
    visit(tree, 'blockquote', (node: any) => {
      const first = node.children?.[0]
      if (!first || first.type !== 'paragraph' || !first.children?.length) return
      const head = first.children[0]
      if (head.type !== 'text') return
      const match =
        /^\[!(NOTE|TIP|WARNING|DANGER|INFO|SUCCESS)\]\s*([^\n]*)\n?/i.exec(head.value)
      if (!match) return

      const kind = match[1].toLowerCase()
      const title = match[2].trim() || CALLOUT_LABEL[kind] || match[1]
      head.value = head.value.slice(match[0].length)
      if (head.value === '') first.children.shift()
      if (first.children.length === 0) node.children.shift()

      node.children.unshift({
        type: 'paragraph',
        data: { hProperties: { className: ['callout-title'] } },
        children: [{ type: 'text', value: title }]
      })
      node.data = {
        ...(node.data ?? {}),
        hName: 'div',
        hProperties: { className: ['callout', `callout-${kind}`] }
      }
    })
  }
}

export async function renderMarkdown(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkCallout)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown)
  return String(file)
}

/** Replaces mermaid code blocks with rendered SVG. Browser-only. */
export async function renderMermaid(html: string, dark = false): Promise<string> {
  if (!html.includes('language-mermaid')) return html
  const container = document.createElement('div')
  container.innerHTML = html
  const blocks = [...container.querySelectorAll('code.language-mermaid')]
  if (!blocks.length) return html

  for (const block of blocks) {
    const source = block.textContent ?? ''
    if (!source.trim()) continue
    try {
      const svg = await renderMermaidSvg(source, dark)
      const wrapper = document.createElement('div')
      wrapper.className = 'mermaid-diagram'
      wrapper.innerHTML = svg
      block.closest('pre')?.replaceWith(wrapper)
    } catch {
      // Keep the original code block so the reader can still see the source.
      block.parentElement?.classList.add('mermaid-error')
    }
  }
  return container.innerHTML
}

/** Vault-relative asset references used by images in the document. */
export function collectAssetPaths(markdown: string): string[] {
  const found = new Set<string>()
  const candidates: string[] = []

  const imageRe = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g
  for (const match of markdown.matchAll(imageRe)) candidates.push(match[1])

  const htmlImgRe = /<img[^>]+src\s*=\s*["']([^"']+)["']/gi
  for (const match of markdown.matchAll(htmlImgRe)) candidates.push(match[1])

  for (const candidate of candidates) {
    const path = candidate.replace(/^\.\//, '')
    if (/^(https?:|data:|mailto:|#)/i.test(path)) continue
    found.add(path)
  }
  return [...found]
}
