import katexCss from 'katex/dist/katex.min.css?inline'

export type ExportTheme = 'light' | 'dark'

const base = `
:root {
  --mk-text: #1f2328;
  --mk-muted: #656d76;
  --mk-border: #d0d7de;
  --mk-surface: #f6f8fa;
  --mk-accent: #4f46e5;
  --mk-bg: #ffffff;
  --mk-code-bg: #f6f8fa;
  --mk-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mk-mono: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--mk-bg);
  color: var(--mk-text);
  font-family: var(--mk-font);
  font-size: 16px;
  line-height: 1.75;
  -webkit-font-smoothing: antialiased;
}
.markup-doc { max-width: 820px; margin: 0 auto; padding: 40px 24px 64px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 650; }
h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--mk-border); }
h2 { font-size: 1.5em; padding-bottom: .25em; border-bottom: 1px solid var(--mk-border); }
h3 { font-size: 1.25em; }
p { margin: .9em 0; }
a { color: var(--mk-accent); text-decoration: none; }
a:hover { text-decoration: underline; }
ul, ol { padding-left: 1.6em; margin: .8em 0; }
li + li { margin-top: .25em; }
blockquote {
  margin: 1em 0;
  padding: .2em 1em;
  color: var(--mk-muted);
  border-left: 4px solid var(--mk-border);
  background: var(--mk-surface);
}
code {
  font-family: var(--mk-mono);
  font-size: .9em;
  background: var(--mk-code-bg);
  padding: .15em .4em;
  border-radius: 4px;
}
pre {
  background: var(--mk-code-bg);
  padding: 14px 16px;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid var(--mk-border);
}
pre code { background: none; padding: 0; font-size: .875em; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
th, td { border: 1px solid var(--mk-border); padding: 8px 12px; text-align: left; }
th { background: var(--mk-surface); font-weight: 600; }
hr { border: none; border-top: 1px solid var(--mk-border); margin: 2em 0; }
img { max-width: 100%; height: auto; border-radius: 6px; }
.callout {
  margin: 1em 0;
  padding: .75em 1em;
  border-radius: 8px;
  border: 1px solid var(--mk-border);
  border-left: 4px solid var(--mk-accent);
  background: var(--mk-surface);
}
.callout-title { margin: 0 0 .35em; font-weight: 650; }
.callout-tip { border-left-color: #16a34a; }
.callout-warning { border-left-color: #d97706; }
.callout-danger { border-left-color: #dc2626; }
.callout-info { border-left-color: #0284c7; }
.callout-success { border-left-color: #15803d; }
.mermaid-diagram { margin: 1.2em 0; text-align: center; }
.mermaid-diagram svg { max-width: 100%; height: auto; }
.mermaid-error { border-color: #dc2626; }
.katex-display { overflow-x: auto; overflow-y: hidden; }
`

const dark = `
:root {
  --mk-text: #e6edf3;
  --mk-muted: #8b949e;
  --mk-border: #30363d;
  --mk-surface: #161b22;
  --mk-accent: #818cf8;
  --mk-bg: #0d1117;
  --mk-code-bg: #161b22;
}
`

const print = `
@page {
  size: A4;
  margin: 18mm 16mm 20mm;
}
@media print {
  html, body { background: #fff; color: #000; }
  .markup-doc { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: underline; }
  h1, h2, h3, h4 { break-after: avoid; }
  pre, blockquote, table, img, .callout { break-inside: avoid; }
  pre { white-space: pre-wrap; word-break: break-word; }
  .no-print { display: none !important; }
}
`

export function exportThemeCss(theme: ExportTheme): string {
  return base + (theme === 'dark' ? dark : '') + print
}

/** KaTeX stylesheet, needed inside exported standalone HTML. */
export function katexStylesheet(): string {
  return katexCss
}

export function buildDocument(title: string, bodyHtml: string, theme: ExportTheme): string {
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${exportThemeCss(theme)}</style>
<style>${katexStylesheet()}</style>
</head>
<body>
<main class="markup-doc">${bodyHtml}</main>
</body>
</html>`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
