<script lang="ts">
  import { onMount } from 'svelte'
  import EditorPane from './lib/components/EditorPane.svelte'
  import LazyExportDialog from './lib/components/LazyExportDialog.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'
  import TabBar from './lib/components/TabBar.svelte'
  import Welcome from './lib/components/Welcome.svelte'
  import { listenVaultChanges } from './lib/api/tauri'
  import { dirname } from './lib/paths'
  import { settings } from './lib/stores/settings.svelte'
  import { tabs } from './lib/stores/tabs.svelte'
  import { vault } from './lib/stores/vault.svelte'
  import type { ViewMode } from './lib/types'

  let viewMode = $state<ViewMode>('wysiwyg')
  let showExport = $state(false)
  let showSettings = $state(false)

  $effect(() => {
    settings.applyTheme()
  })

  // F2.8 timer autosave — independent from blur autosave.
  $effect(() => {
    const enabled = settings.value.autosaveTimer
    const seconds = Math.min(300, Math.max(10, settings.value.autosaveInterval))
    if (!enabled) return
    const timer = setInterval(() => void tabs.saveAll(), seconds * 1000)
    return () => clearInterval(timer)
  })

  onMount(() => {
    let watcherTimer: ReturnType<typeof setTimeout> | undefined
    let unlisten: (() => void) | undefined
    let disposed = false

    void listenVaultChanges((paths) => {
      clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => {
        void vault.refresh()
        tabs.syncFromDisk(paths)
      }, 350)
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })

    const onKeydown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void saveActive()
      } else if (key === 'n') {
        event.preventDefault()
        void newDoc()
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (tabs.active) showExport = true
      } else if (key === ',' ) {
        event.preventDefault()
        showSettings = true
      } else if (event.key === '\\') {
        event.preventDefault()
        viewMode = viewMode === 'wysiwyg' ? 'source' : 'wysiwyg'
      }
    }

    window.addEventListener('keydown', onKeydown)
    return () => {
      disposed = true
      clearTimeout(watcherTimer)
      unlisten?.()
      window.removeEventListener('keydown', onKeydown)
    }
  })

  async function openVault(): Promise<void> {
    const opened = await vault.choose()
    if (opened) tabs.reset()
    else if (vault.error) window.alert(vault.error)
  }

  async function openDemo(): Promise<void> {
    await vault.openDemo()
    tabs.reset()
    await tabs.open('欢迎使用 Markup.md')
  }

  async function newDoc(): Promise<void> {
    if (!vault.isOpen) return
    const name = window.prompt('新建笔记名称（自动补全 .md）', '未命名')
    if (!name?.trim()) return
    const folder = tabs.active ? dirname(tabs.active.path) : ''
    try {
      await tabs.createAndOpen(folder, name.trim())
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  async function saveActive(force = false): Promise<void> {
    const tab = tabs.active
    if (!tab) return
    const outcome = await tabs.save(tab.path, force)
    if (outcome === 'conflict') {
      const overwrite = window.confirm(
        '「' + tab.title + '」已被外部修改。要用编辑器中的内容覆盖磁盘文件吗？'
      )
      if (overwrite) await saveActive(true)
    } else if (outcome === 'error' && tabs.saveError) {
      window.alert(tabs.saveError.replace(/^ENCODING:/, ''))
    }
  }

  function toggleSidebar(): void {
    settings.update({ sidebarVisible: !settings.value.sidebarVisible })
  }
</script>

<div class="app" class:sidebar-hidden={!vault.isOpen || !settings.value.sidebarVisible}>
  <header class="topbar">
    <div class="brand">
      <span class="brand-mark">M</span>
      <span>Markup</span>
    </div>

    {#if vault.isOpen}
      <span class="topbar-vault" title={vault.root ?? ''}>{vault.name}</span>
    {/if}

    <button
      class="icon-btn"
      class:active={settings.value.sidebarVisible}
      title="切换侧边栏"
      aria-label="切换侧边栏"
      onclick={toggleSidebar}>☰</button>

    <span class="topbar-spacer"></span>

    <button class="icon-btn" title="打开文件夹" onclick={() => void openVault()}>打开</button>
    <button class="icon-btn" title="新建笔记 (Ctrl+N)" onclick={() => void newDoc()}>新建</button>
    <button class="icon-btn" title="保存 (Ctrl+S)" onclick={() => void saveActive()}>保存</button>
    <button
      class="icon-btn"
      class:active={viewMode === 'source'}
      title="切换源码视图 (Ctrl+\\)"
      onclick={() => (viewMode = viewMode === 'wysiwyg' ? 'source' : 'wysiwyg')}>
      {viewMode === 'wysiwyg' ? '源码' : '预览'}
    </button>
    <button
      class="icon-btn"
      title="导出 (Ctrl+Shift+E)"
      disabled={!tabs.active}
      onclick={() => (showExport = true)}>导出</button>
    <button class="icon-btn" title="设置 (Ctrl+,)" onclick={() => (showSettings = true)}>设置</button>
  </header>

  {#if vault.isOpen}
    <Sidebar />
  {:else}
    <div></div>
  {/if}

  <main class="main">
    <TabBar onnew={() => void newDoc()} />
    <div class="editor-area">
      {#if tabs.active}
        <EditorPane tab={tabs.active} mode={viewMode} />
      {:else if !vault.isOpen}
        <Welcome onopen={() => void openVault()} ondemo={() => void openDemo()} busy={vault.loading} />
      {:else}
        <div class="welcome">
          <div class="welcome-card">
            <h1 style="font-size:22px">开始写作</h1>
            <p>从左侧选择一篇笔记，或新建文档。附件会统一保存到 <code>attachments/</code>。</p>
            <div class="welcome-actions">
              <button class="button primary" onclick={() => void newDoc()}>新建笔记</button>
              <button class="button" onclick={() => (showSettings = true)}>打开设置</button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </main>

  <StatusBar />
</div>

{#if tabs.active}
  <LazyExportDialog open={showExport} tab={tabs.active} onclose={() => (showExport = false)} />
{/if}
<SettingsDialog open={showSettings} onclose={() => (showSettings = false)} />
