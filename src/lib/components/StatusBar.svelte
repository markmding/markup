<script lang="ts">
  import { tabs } from '../stores/tabs.svelte'
  import { vault } from '../stores/vault.svelte'
  import type { Encoding, Eol } from '../types'

  const active = $derived(tabs.active)

  const stats = $derived.by(() => {
    if (!active) return { words: 0, lines: 0 }
    const text = active.content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/[#>*_~|-]/g, ' ')
    const cjk = (text.match(/[㐀-鿿぀-ヿ가-힯]/g) ?? []).length
    const latin = text
      .replace(/[㐀-鿿぀-ヿ가-힯]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
    return {
      words: cjk + latin,
      lines: active.content.split('\n').length
    }
  })

  const saveState = $derived.by(() => {
    if (!active) return { label: '', cls: '' }
    if (active.saving) return { label: '保存中…', cls: 'dirty' }
    if (tabs.saveError) return { label: '保存失败', cls: 'error' }
    if (active.dirty) return { label: '未保存', cls: 'dirty' }
    return { label: '已保存', cls: '' }
  })

  const encodingValue = $derived(
    active ? (active.encoding === 'utf8' && active.bom ? 'utf8-bom' : active.encoding) : 'utf8'
  )

  function changeEncoding(event: Event): void {
    if (!active) return
    const value = (event.currentTarget as HTMLSelectElement).value
    if (value === 'utf8-bom') tabs.setEncoding(active.path, 'utf8', true)
    else tabs.setEncoding(active.path, value as Encoding, false)
  }

  function changeEol(event: Event): void {
    if (!active) return
    tabs.setEol(active.path, (event.currentTarget as HTMLSelectElement).value as Eol)
  }
</script>

<footer class="statusbar">
  <span title={vault.root ?? ''}>
    {#if vault.root}{vault.isDemo ? '示例库' : vault.root}{/if}
  </span>
  <span class="spacer"></span>
  {#if active}
    <span>{stats.words} 字 · {stats.lines} 行</span>
    <select
      class="status-select"
      aria-label="文件编码"
      title="保存时使用的文本编码；无法表示的字符会阻止保存"
      value={encodingValue}
      onchange={changeEncoding}
    >
      <option value="utf8">UTF-8</option>
      <option value="utf8-bom">UTF-8 BOM</option>
      <option value="gbk">GBK</option>
      <option value="ansi">ANSI</option>
    </select>
    <select
      class="status-select"
      aria-label="换行符"
      title="保存时使用的换行符；新文件默认跟随操作系统"
      value={active.eol}
      onchange={changeEol}
    >
      <option value="lf">LF</option>
      <option value="crlf">CRLF</option>
    </select>
    <span title={tabs.saveError ?? ''}>
      <span class="status-dot {saveState.cls}"></span>{saveState.label}
    </span>
  {:else}
    <span class="faint">Markup v0.1.0 · v1 不含双链与图谱</span>
  {/if}
</footer>
