<script lang="ts">
  import { createEntry, deleteEntry, renameEntry, searchVault } from '../api/vault'
  import { flattenTree, filterTree } from '../filetree'
  import { basename, dirname, isTextFile, joinPath, withDefaultExtension } from '../paths'
  import { tabs } from '../stores/tabs.svelte'
  import { vault } from '../stores/vault.svelte'
  import type { SearchHit } from '../types'

  let { onnew }: { onnew: (folder?: string) => void } = $props()

  let query = $state('')
  let dragPath = $state<string | null>(null)
  let dropTarget = $state<string | null>(null)
  let hits = $state<SearchHit[]>([])
  let searchBusy = $state(false)
  let searchError = $state<string | null>(null)

  const filtered = $derived(
    query.trim() ? filterTree(vault.entries, query.trim()) : vault.entries
  )
  const rows = $derived(flattenTree(filtered, vault.expanded))
  const fullTextMode = $derived(query.trim().length >= 2)

  $effect(() => {
    const text = query.trim()
    const root = vault.root
    if (!root || text.length < 2) {
      hits = []
      searchBusy = false
      searchError = null
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      searchBusy = true
      void searchVault(root, text, 30)
        .then((result) => {
          if (cancelled) return
          hits = result
          searchError = null
        })
        .catch((error) => {
          if (!cancelled) searchError = message(error)
        })
        .finally(() => {
          if (!cancelled) searchBusy = false
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  })

  function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function openEntry(path: string): Promise<void> {
    if (!isTextFile(path)) {
      window.alert('暂不支持打开该类型的文件（支持 Markdown 与常见纯文本格式）。')
      return
    }
    try {
      await tabs.open(path)
    } catch (error) {
      window.alert(message(error))
    }
  }

  function activeFolder(): string {
    return tabs.active ? dirname(tabs.active.path) : ''
  }

  async function newFolder(parent = activeFolder()): Promise<void> {
    if (!vault.root) return
    const name = window.prompt('新建文件夹名称')
    if (!name?.trim()) return
    try {
      await createEntry(vault.root, joinPath(parent, name.trim()), 'dir')
      await vault.refresh()
    } catch (error) {
      window.alert(message(error))
    }
  }

  async function rename(entryPath: string, isDir = false): Promise<void> {
    if (!vault.root) return
    const current = basename(entryPath)
    const next = window.prompt('重命名为', current)
    if (!next?.trim() || next.trim() === current) return
    const target = joinPath(
      dirname(entryPath),
      isDir ? next.trim() : withDefaultExtension(next.trim(), entryPath)
    )
    try {
      await renameEntry(vault.root, entryPath, target)
      tabs.renamePath(entryPath, target)
      await vault.refresh()
    } catch (error) {
      window.alert(message(error))
    }
  }

  async function remove(entryPath: string): Promise<void> {
    if (!vault.root) return
    if (!window.confirm(`确定将「${basename(entryPath)}」移入回收站？`)) return
    try {
      await deleteEntry(vault.root, entryPath)
      tabs.closeByPath(entryPath, true)
      await vault.refresh()
    } catch (error) {
      window.alert(message(error))
    }
  }

  async function moveInto(targetDir: string): Promise<void> {
    const source = dragPath
    dragPath = null
    dropTarget = null
    if (!vault.root || !source) return
    if (dirname(source) === targetDir) return
    if (targetDir === source || targetDir.startsWith(`${source}/`)) return
    const target = joinPath(targetDir, basename(source))
    try {
      await renameEntry(vault.root, source, target)
      tabs.renamePath(source, target)
      await vault.refresh()
    } catch (error) {
      window.alert(message(error))
    }
  }

  function handleDrop(event: DragEvent, targetDir: string): void {
    event.preventDefault()
    event.stopPropagation()
    void moveInto(targetDir)
  }
</script>

<aside class="sidebar">
  <div class="sidebar-head">
    <span class="sidebar-title">{vault.name || '未打开 Vault'}</span>
    <button class="icon-btn" title="新建笔记 (Ctrl+N)" onclick={() => onnew()}>＋</button>
    <button class="icon-btn" title="刷新" onclick={() => void vault.refresh()}>↻</button>
  </div>

  <div class="sidebar-search">
    <input
      type="search"
      placeholder="搜索文件与内容…"
      bind:value={query}
      aria-label="搜索文件与内容"
    />
  </div>

  <div
    class="file-tree"
    role="tree"
    tabindex="0"
    ondragover={(event) => {
      event.preventDefault()
      dropTarget = ''
    }}
    ondragleave={() => (dropTarget = null)}
    ondrop={(event) => handleDrop(event, '')}
    class:drop-root={dropTarget === ''}
  >
    {#if fullTextMode}
      <div class="search-section-title">
        内容匹配{searchBusy ? ' · 搜索中…' : hits.length ? ` · ${hits.length}` : ''}
      </div>
      {#if searchError}
        <div class="empty">{searchError}</div>
      {:else if !searchBusy && hits.length === 0}
        <div class="empty">没有内容匹配</div>
      {/if}
      {#each hits as hit (hit.path)}
        <button
          class="search-hit"
          title={hit.path}
          onclick={() => void openEntry(hit.path)}
        >
          <span class="search-hit-title">{hit.title}</span>
          <span class="search-hit-path">{hit.path}</span>
          <span class="search-hit-snippet">{hit.snippet}</span>
        </button>
      {/each}
      <div class="search-section-title">文件</div>
    {/if}

    {#if rows.length === 0}
      <div class="empty">
        {vault.isOpen ? '没有匹配的文件' : '先打开一个知识库文件夹'}
      </div>
    {/if}

    {#each rows as row (row.entry.path)}
      {@const entry = row.entry}
      <div
        class="tree-row"
        class:selected={tabs.activeId === entry.path}
        class:drag-over={dropTarget === entry.path}
        role="treeitem"
        tabindex="-1"
        aria-selected={tabs.activeId === entry.path}
        aria-expanded={entry.kind === 'dir' ? vault.isExpanded(entry.path) : undefined}
        style={`padding-left: ${6 + row.depth * 14}px`}
        draggable={entry.kind === 'file'}
        onclick={() =>
          entry.kind === 'dir' ? vault.toggle(entry.path) : void openEntry(entry.path)}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            if (entry.kind === 'dir') vault.toggle(entry.path)
            else void openEntry(entry.path)
          }
        }}
        ondragstart={(event) => {
          dragPath = entry.path
          event.dataTransfer?.setData('text/plain', entry.path)
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        }}
        ondragend={() => {
          dragPath = null
          dropTarget = null
        }}
        ondragover={(event) => {
          if (entry.kind !== 'dir') return
          event.preventDefault()
          event.stopPropagation()
          dropTarget = entry.path
        }}
        ondrop={(event) => entry.kind === 'dir' && handleDrop(event, entry.path)}
      >
        <span class="tree-caret" class:open={entry.kind === 'dir' && vault.isExpanded(entry.path)}>
          {entry.kind === 'dir' ? '▶' : ''}
        </span>
        <span class="tree-icon">{entry.kind === 'dir' ? '📁' : '📄'}</span>
        <span class="tree-label" title={entry.path}>{entry.name}</span>
        <span class="tree-actions">
          {#if entry.kind === 'dir'}
            <button
              title="在此新建笔记"
              onclick={(event) => {
                event.stopPropagation()
                onnew(entry.path)
              }}>＋</button>
          {/if}
          <button
            title="重命名"
            onclick={(event) => {
              event.stopPropagation()
              void rename(entry.path, entry.kind === 'dir')
            }}>✎</button>
          <button
            title="删除"
            onclick={(event) => {
              event.stopPropagation()
              void remove(entry.path)
            }}>✕</button>
        </span>
      </div>
    {/each}
  </div>

  <div class="sidebar-foot">
    <button class="icon-btn" title="新建文件夹" onclick={() => void newFolder()}>📁＋</button>
    <button class="icon-btn" title="全部展开" onclick={() => vault.expandAll(true)}>展开</button>
    <button class="icon-btn" title="全部折叠" onclick={() => vault.expandAll(false)}>折叠</button>
    <span class="spacer" style="flex:1"></span>
    {#if vault.isDemo}
      <span class="faint" style="font-size:11px">示例库</span>
    {/if}
  </div>
</aside>
