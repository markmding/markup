export interface PageRange {
  mode: 'all' | 'range'
  from: number
  to: number
}

export interface PdfOptions {
  pageStart: number
  range: PageRange
}

export interface PaginatedDocument {
  total: number
  /** inner HTML of each A4 content page */
  pages: string[]
  /** styles collected from the exported document */
  styles: string
}

export interface PdfPrintResult {
  printed: number
  total: number
}

const PAGE_W = 794 // A4 @96dpi
const PAGE_H = 1123
const MARGIN_X = 60
const MARGIN_TOP = 68
const MARGIN_BOTTOM = 76
const CONTENT_W = PAGE_W - MARGIN_X * 2
const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM

/**
 * Packs exported HTML into A4 pages by measuring real layout in a hidden
 * shadow root. Blocks are atomic (a block taller than a page is clipped),
 * which keeps the result predictable for typical notes.
 */
export async function paginateHtml(html: string): Promise<PaginatedDocument> {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const styles = [...parsed.querySelectorAll('style')]
    .map((style) => style.textContent ?? '')
    .join('\n')
  const source = parsed.querySelector('.markup-doc')
  const content = source ? source.innerHTML : parsed.body.innerHTML

  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${CONTENT_W}px;visibility:hidden;font-size:16px;line-height:1.75;color:#1f2328;`
  const shadow = host.attachShadow({ mode: 'closed' })
  shadow.innerHTML = `<style>${styles}
.markup-doc.stage, .markup-doc.page-measure {
  max-width: none; margin: 0; padding: 0; width: ${CONTENT_W}px;
  font-size: 16px; line-height: 1.75;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}</style><div class="markup-doc stage"></div>`
  document.body.appendChild(host)

  try {
    const stage = shadow.querySelector('.stage') as HTMLElement
    stage.innerHTML = content

    const images = [...shadow.querySelectorAll('img')]
    await Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) return resolve()
            image.addEventListener('load', () => resolve(), { once: true })
            image.addEventListener('error', () => resolve(), { once: true })
          })
      )
    )
    await document.fonts?.ready

    const pages: HTMLElement[] = []
    const newPage = (): HTMLElement => {
      const page = document.createElement('div')
      page.className = 'markup-doc page-measure'
      shadow.appendChild(page)
      pages.push(page)
      return page
    }

    let current = newPage()
    for (const child of Array.from(stage.children)) {
      current.appendChild(child)
      if (current.scrollHeight > CONTENT_H && current.children.length > 1) {
        current.removeChild(child)
        current = newPage()
        current.appendChild(child)
      }
    }
    if (current.children.length === 0 && pages.length > 1) {
      current.remove()
      pages.pop()
    }

    return {
      total: pages.length,
      pages: pages.map((page) => page.innerHTML),
      styles
    }
  } finally {
    host.remove()
  }
}

export function buildPrintHtml(
  paginated: PaginatedDocument,
  options: PdfOptions
): { html: string; printed: number } {
  const total = paginated.total
  if (total === 0) throw new Error('文档没有可打印的内容')

  let from = 1
  let to = total
  if (options.range.mode === 'range') {
    from = Math.max(1, Math.min(options.range.from, total))
    to = Math.max(1, Math.min(options.range.to, total))
    if (from > to) throw new Error('页码范围无效：起始页不能大于结束页')
  }

  const start = Math.max(1, options.pageStart)
  const pages: string[] = []
  for (let index = from - 1; index < to; index += 1) {
    const number = start + index
    pages.push(
      `<section class="markup-doc print-page">${paginated.pages[index]}` +
        `<footer class="print-footer">${number}</footer></section>`
    )
  }

  const printCss = `
@page { size: A4; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
.print-page {
  width: 210mm; height: 297mm; box-sizing: border-box;
  padding: 18mm 16mm 20mm; position: relative; overflow: hidden;
  break-after: page; page-break-after: always;
}
.print-page:last-child { break-after: auto; page-break-after: auto; }
.print-page.markup-doc { max-width: none; margin: 0; }
.print-footer {
  position: absolute; left: 0; right: 0; bottom: 8mm;
  text-align: center; font-size: 10pt; color: #666;
}
`

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<style>${paginated.styles}</style><style>${printCss}</style></head>
<body>${pages.join('')}</body></html>`
  return { html, printed: to - from + 1 }
}

/** Prints the selected A4 pages through the WebView print dialog. */
export async function printHtml(
  html: string,
  options: PdfOptions
): Promise<PdfPrintResult> {
  const paginated = await paginateHtml(html)
  const { html: printHtmlSource, printed } = buildPrintHtml(paginated, options)

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  iframe.srcdoc = printHtmlSource

  await new Promise<void>((resolve) => {
    iframe.onload = () => resolve()
    document.body.appendChild(iframe)
  })

  try {
    const target = iframe.contentWindow
    if (!target) throw new Error('无法创建打印窗口')
    target.focus()
    target.print()
  } finally {
    setTimeout(() => iframe.remove(), 2000)
  }

  return { printed, total: paginated.total }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as Window & { __markupPaginate?: typeof paginateHtml }).__markupPaginate =
    paginateHtml
}
