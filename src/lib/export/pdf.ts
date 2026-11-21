export interface PageRange {
  mode: 'all' | 'range'
  from: number
  to: number
}

export interface PdfOptions {
  pageStart: number
  range: PageRange
}

/**
 * Prints an HTML document through the WebView print API.
 *
 * Known platform gap (PRD R2): WebView2 / WKWebView do not expose a reliable
 * API for a page sub-range, and CSS cannot renumber printed pages. M0 must
 * verify:
 *   1. `@page` margin + browser header/footer page numbers;
 *   2. whether a print range can be achieved by DOM slicing after pagination.
 * Until then the range is validated and reported, but the whole document is
 * sent to the print dialog.
 */
export async function printHtml(html: string, options: PdfOptions): Promise<void> {
  if (options.range.mode === 'range' && options.range.from > options.range.to) {
    throw new Error('页码范围无效：起始页不能大于结束页')
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.srcdoc = html

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
    // Give the print dialog time to read the document before removing it.
    setTimeout(() => iframe.remove(), 2000)
  }
}

/** CSS the theme should provide; kept here for print tuning experiments. */
export function printPageStyle(pageStart: number): string {
  return `
@media print {
  @page { size: A4; margin: 18mm 16mm 20mm; }
  body { counter-reset: markup-page ${Math.max(0, pageStart - 1)}; }
}
`
}
