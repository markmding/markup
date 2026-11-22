<script lang="ts">
  import { writeExportFile, writeExportFiles } from '../api/vault'
  import { isTauri, pickExportFile, pickExportFolder } from '../api/tauri'
  import { downloadBase64, downloadText } from '../export/download'
  import { buildHtmlExport } from '../export/html'
  import { paginateHtml, printHtml } from '../export/pdf'
  import { settings } from '../stores/settings.svelte'
  import { themes } from '../stores/themes.svelte'
  import type { Tab } from '../stores/tabs.svelte'
  import { vault } from '../stores/vault.svelte'
  import type { ExportFile, HtmlExportMode } from '../types'

  let {
    open,
    tab,
    onclose
  }: { open: boolean; tab: Tab | undefined; onclose: () => void } = $props()

  let format = $state<'html' | 'pdf' | 'md'>('html')
  let htmlMode = $state<HtmlExportMode>('folder')
  let theme = $state<'light' | 'dark'>('light')
  let rangeMode = $state<'all' | 'range'>('all')
  let from = $state(1)
  let to = $state(1)
  let pageStart = $state(1)
  let preview = $state('')
  let missing = $state<string[]>([])
  let pageCount = $state(0)
  let pageBusy = $state(false)
  let busy = $state(false)
  let message = $state<{ kind: 'info' | 'warning' | 'danger'; text: string } | null>(null)

  const resolvedTheme = $derived(settings.value.theme === 'dark' ? 'dark' : 'light')

  $effect(() => {
    if (!open) return
    htmlMode = settings.value.defaultHtmlMode
    pageStart = settings.value.defaultPageStart
    rangeMode = settings.value.defaultPageRange
    theme = resolvedTheme
  })

  $effect(() => {
    if (!open || !tab || format === 'md') return
    const markdown = tab.content
    const title = tab.title
    const mode = theme
    const root = vault.root
    let cancelled = false

    const timer = setTimeout(() => {
      void buildHtmlExport({
        root,
        markdown,
        title,
        mode: 'single',
        theme: mode,
        renderDiagrams: settings.value.renderMermaid,
        customCss: themes.customCss
      })
        .then((result) => {
          if (cancelled) return
          preview = result.html
          missing = result.missing
          if (result.missing.length) {
            message = {
              kind: 'warning',
              text: `有 ${result.missing.length} 个附件未找到：${result.missing.join('、')}`
            }
          }
          if (format === 'pdf') {
            pageBusy = true
            pageCount = 0
            void paginateHtml(result.html)
              .then((paginated) => {
                if (!cancelled) pageCount = paginated.total
              })
              .catch(() => {
                if (!cancelled) pageCount = 0
              })
              .finally(() => {
                if (!cancelled) pageBusy = false
              })
          } else {
            pageCount = 0
          }
        })
        .catch((error) => {
          if (!cancelled) {
            message = { kind: 'danger', text: `预览生成失败：${String(error)}` }
          }
        })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })

  async function exportHtml(): Promise<void> {
    if (!tab) return
    busy = true
    message = null
    try {
      const result = await buildHtmlExport({
        root: vault.root,
        markdown: tab.content,
        title: tab.title,
        mode: htmlMode,
        theme,
        renderDiagrams: settings.value.renderMermaid,
        customCss: themes.customCss
      })
      if (result.missing.length) {
        missing = result.missing
        message = {
          kind: 'warning',
          text: `有 ${result.missing.length} 个附件未找到，已跳过：${result.missing.join('、')}`
        }
      }

      if (htmlMode === 'single') {
        if (isTauri) {
          const target = await pickExportFile(`${tab.title}.html`, [
            { name: 'HTML', extensions: ['html'] }
          ])
          if (!target) return
          await writeExportFile(target, result.html)
          message = { kind: 'info', text: `已导出：${target}` }
        } else {
          downloadText(`${tab.title}.html`, result.html)
          message = { kind: 'info', text: '已开始下载（浏览器演示模式）' }
        }
        return
      }

      if (isTauri) {
        const dest = await pickExportFolder()
        if (!dest) return
        const count = await writeExportFiles(dest, result.files)
        message = { kind: 'info', text: `已导出 ${count} 个文件到：${dest}` }
      } else {
        browserWriteFiles(result.files)
        message = { kind: 'info', text: '已开始下载 index.html 与附件（浏览器演示模式）' }
      }
    } catch (error) {
      message = { kind: 'danger', text: `导出失败：${String(error)}` }
    } finally {
      busy = false
    }
  }

  async function exportPdf(): Promise<void> {
    if (!tab) return
    busy = true
    message = null
    try {
      if (rangeMode === 'range' && from > to) {
        message = { kind: 'danger', text: '页码范围无效：起始页不能大于结束页' }
        return
      }
      const result = await buildHtmlExport({
        root: vault.root,
        markdown: tab.content,
        title: tab.title,
        mode: 'single',
        theme,
        renderDiagrams: settings.value.renderMermaid,
        customCss: themes.customCss
      })
      const printed = await printHtml(result.html, {
        pageStart,
        range: { mode: rangeMode, from, to }
      })
      message = {
        kind: 'info',
        text: `已选择 ${printed.printed} / ${printed.total} 页，已打开系统打印对话框。`
      }
    } catch (error) {
      message = { kind: 'danger', text: `打印失败：${String(error)}` }
    } finally {
      busy = false
    }
  }

  async function copyMarkdown(): Promise<void> {
    if (!tab) return
    try {
      await navigator.clipboard.writeText(tab.content)
      message = { kind: 'info', text: '已复制规范化 Markdown 到剪贴板。' }
    } catch (error) {
      message = { kind: 'danger', text: `复制失败：${String(error)}` }
    }
  }

  function browserWriteFiles(files: ExportFile[]): void {
    for (const file of files) {
      const name = file.path.split('/').pop() ?? 'file'
      if (file.encoding === 'base64') {
        downloadBase64(name, file.content, mimeOf(file.path))
      } else {
        downloadText(name, file.content)
      }
    }
  }

  function mimeOf(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const map: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml'
    }
    return (ext && map[ext]) || 'application/octet-stream'
  }

  function run(): void {
    if (format === 'html') void exportHtml()
    else if (format === 'pdf') void exportPdf()
    else void copyMarkdown()
  }
</script>

{#if open && tab}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose()
    }}
  >
    <div class="modal wide" role="dialog" aria-modal="true" aria-label="导出" tabindex="-1">
      <div class="modal-head">
        <h2>导出「{tab.title}」</h2>
        <button class="icon-btn" title="关闭" onclick={onclose}>×</button>
      </div>

      <div class="modal-body">
        <div class="form-grid" style="margin-bottom:14px">
          <div class="field full">
            <span class="field-label">格式</span>
            <div class="segmented">
              <button class:active={format === 'html'} onclick={() => (format = 'html')}>HTML</button>
              <button class:active={format === 'pdf'} onclick={() => (format = 'pdf')}>PDF</button>
              <button class:active={format === 'md'} onclick={() => (format = 'md')}>
                Markdown
              </button>
            </div>
          </div>

          {#if format === 'html'}
            <div class="field full">
              <span class="field-label">打包模式</span>
              <div class="segmented">
                <button
                  class:active={htmlMode === 'folder'}
                  onclick={() => (htmlMode = 'folder')}>独立文件夹</button>
                <button
                  class:active={htmlMode === 'single'}
                  onclick={() => (htmlMode = 'single')}>单 HTML（base64）</button>
              </div>
              <span class="hint">
                {htmlMode === 'folder'
                  ? '输出 index.html + attachments/，便于二次修改。'
                  : '图片内嵌为 base64，单个文件即可离线分发；附件较多时体积会明显增大。'}
              </span>
            </div>
            <div class="field">
              <label for="export-theme">导出主题</label>
              <select id="export-theme" bind:value={theme}>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
          {:else if format === 'pdf'}
            <div class="field">
              <label for="page-start">页码起始值</label>
              <input id="page-start" type="number" min="1" bind:value={pageStart} />
            </div>
            <div class="field">
              <span class="field-label">导出范围</span>
              <div class="segmented">
                <button
                  class:active={rangeMode === 'all'}
                  onclick={() => (rangeMode = 'all')}>整篇</button>
                <button
                  class:active={rangeMode === 'range'}
                  onclick={() => (rangeMode = 'range')}>指定页码</button>
              </div>
            </div>
            {#if rangeMode === 'range'}
              <div class="field full">
                <span class="field-label">页码范围（按打印分页）</span>
                <div class="range-row">
                  <input type="number" min="1" bind:value={from} aria-label="起始页" />
                  <span class="muted">至</span>
                  <input type="number" min="1" bind:value={to} aria-label="结束页" />
                </div>
              </div>
            {/if}
            <div class="field full">
              <span class="hint">
                {#if pageBusy}
                  正在按 A4 计算页数…
                {:else if pageCount > 0}
                  共 {pageCount} 页（A4 自动分页）；页码从 {pageStart} 开始编号。
                {:else}
                  预览计算完成后会显示总页数。
                {/if}
              </span>
            </div>
          {:else}
            <div class="field full">
              <span class="hint">
                复制当前文档的规范化 Markdown（AST 序列化结果），可直接粘贴到其他编辑器。
              </span>
            </div>
          {/if}
        </div>

        {#if message}
          <div class="alert {message.kind}" style="margin-bottom:12px">{message.text}</div>
        {/if}

        {#if missing.length}
          <div class="alert warning" style="margin-bottom:12px">
            缺失附件：{missing.join('、')}
          </div>
        {/if}

        {#if format !== 'md'}
          <div class="field">
            <span class="field-label">预览</span>
            <iframe class="preview-frame" title="导出预览" sandbox="allow-same-origin" srcdoc={preview}></iframe>
          </div>
        {/if}
      </div>

      <div class="modal-foot">
        <span class="faint" style="font-size:11px">
          AST 为唯一真值 · 导出前自动收集引用附件
        </span>
        <span class="spacer"></span>
        <button class="button" onclick={onclose}>取消</button>
        <button class="button primary" onclick={run} disabled={busy}>
          {busy
            ? '处理中…'
            : format === 'html'
              ? '导出 HTML'
              : format === 'pdf'
                ? '打印为 PDF'
                : '复制 Markdown'}
        </button>
      </div>
    </div>
  </div>
{/if}
