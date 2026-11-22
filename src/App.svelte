<script lang="ts">
  import { onMount } from 'svelte'
  import ConflictBar from './lib/components/ConflictBar.svelte'
  import EditorPane from './lib/components/EditorPane.svelte'
  import LazyExportDialog from './lib/components/LazyExportDialog.svelte'
  import NewDocDialog from './lib/components/NewDocDialog.svelte'
  import SettingsDialog from './lib/components/SettingsDialog.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'
  import TabBar from './lib/components/TabBar.svelte'
  import TextPane from './lib/components/TextPane.svelte'
  import Welcome from './lib/components/Welcome.svelte'
  import { getCurrentWindow } from '@tauri-apps/api/window'
  import { listenVaultChanges } from './lib/api/tauri'
  import { runEditorAction, type EditorAction } from './lib/editor/actions'
  import { dirname } from './lib/paths'
  import { settings } from './lib/stores/settings.svelte'
  import { tabs } from './lib/stores/tabs.svelte'
  import { themes } from './lib/stores/themes.svelte'
  import { vault } from './lib/stores/vault.svelte'
  import type { ViewMode } from './lib/types'

  let viewMode = $state<ViewMode>('wysiwyg')
  let showExport = $state(false)
  let showSettings = $state(false)
  let showNewDoc = $state(false)
  let showAbout = $state(false)
  let newDocFolder = $state('')
  let openMenu = $state<string | null>(null)
  let focusBeforeMenu: HTMLElement | null = null
  let lastEditorFocus: HTMLElement | null = null

  const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  const appWindow = IS_TAURI ? getCurrentWindow() : null

  const textTabActive = $derived(tabs.active?.kind === 'text')
  const markdownTabActive = $derived(tabs.active?.kind === 'markdown')
  const canFormat = $derived(markdownTabActive && viewMode !== 'source')

  interface MenuAction {
    label: string
    shortcut?: string
    disabled?: boolean
    checked?: boolean
    run: () => void
  }
  type MenuEntry = MenuAction | { separator: true }
  interface Menu {
    label: string
    entries: MenuEntry[]
  }

  const menus = $derived<Menu[]>([
    {
      label: '文件',
      entries: [
        { label: '打开文件夹…', shortcut: 'Ctrl+O', run: () => void openVault() },
        { label: '新建笔记', shortcut: 'Ctrl+N', run: () => void openNewDoc() },
        { separator: true },
        {
          label: '保存',
          shortcut: 'Ctrl+S',
          disabled: !tabs.active,
          run: () => void saveActive()
        },
        {
          label: '导出…',
          shortcut: 'Ctrl+Shift+E',
          disabled: !markdownTabActive,
          run: () => (showExport = true)
        },
        { separator: true },
        {
          label: '关闭标签页',
          shortcut: 'Ctrl+W',
          disabled: !tabs.active,
          run: closeActiveTab
        }
      ]
    },
    {
      label: '编辑',
      entries: [
        {
          label: '撤销',
          shortcut: 'Ctrl+Z',
          disabled: !tabs.active,
          run: () => editCommand('undo')
        },
        {
          label: '重做',
          shortcut: 'Ctrl+Shift+Z',
          disabled: !tabs.active,
          run: () => editCommand('redo')
        },
        { separator: true },
        {
          label: '全选',
          shortcut: 'Ctrl+A',
          disabled: !tabs.active,
          run: () => editCommand('selectAll')
        },
        { label: '查找…', shortcut: 'Ctrl+F', run: focusSearch }
      ]
    },
    {
      label: '格式',
      entries: [
        { label: '加粗', shortcut: 'Ctrl+B', disabled: !canFormat, run: () => format('strong') },
        { label: '斜体', shortcut: 'Ctrl+I', disabled: !canFormat, run: () => format('emphasis') },
        { label: '删除线', disabled: !canFormat, run: () => format('strikethrough') },
        { label: '行内代码', disabled: !canFormat, run: () => format('inlineCode') },
        { separator: true },
        { label: '标题 1', disabled: !canFormat, run: () => format('heading1') },
        { label: '标题 2', disabled: !canFormat, run: () => format('heading2') },
        { label: '标题 3', disabled: !canFormat, run: () => format('heading3') },
        { label: '正文', disabled: !canFormat, run: () => format('paragraph') },
        { separator: true },
        { label: '引用', disabled: !canFormat, run: () => format('blockquote') },
        { label: '无序列表', disabled: !canFormat, run: () => format('bulletList') },
        { label: '有序列表', disabled: !canFormat, run: () => format('orderedList') },
        { separator: true },
        { label: '代码块', disabled: !canFormat, run: () => format('codeBlock') },
        { label: '表格', disabled: !canFormat, run: () => format('table') }
      ]
    },
    {
      label: '视图',
      entries: [
        {
          label: '预览',
          checked: viewMode === 'wysiwyg',
          disabled: textTabActive,
          run: () => (viewMode = 'wysiwyg')
        },
        {
          label: '源码',
          shortcut: 'Ctrl+\\',
          checked: viewMode === 'source',
          disabled: textTabActive,
          run: () => (viewMode = 'source')
        },
        {
          label: '分栏',
          checked: viewMode === 'split',
          disabled: textTabActive,
          run: () => (viewMode = 'split')
        },
        { separator: true },
        {
          label: '切换侧边栏',
          checked: settings.value.sidebarVisible,
          run: toggleSidebar
        }
      ]
    },
    {
      label: '选项',
      entries: [
        { label: '设置…', shortcut: 'Ctrl+,', run: () => (showSettings = true) }
      ]
    },
    {
      label: '关于',
      entries: [
        { label: '关于 Markup', run: () => (showAbout = true) },
        { label: '版本 0.1.0', disabled: true, run: () => {} }
      ]
    }
  ])

  // Export and Markdown preview modes do not apply to plain-text files.
  $effect(() => {
    if (textTabActive) showExport = false
  })

  $effect(() => {
    settings.applyTheme()
  })

  $effect(() => {
    themes.applySelection()
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
      const themeChanged = paths.some((path) => /[\\/]themes[\\/]/i.test(path))
      clearTimeout(watcherTimer)
      watcherTimer = setTimeout(() => {
        void vault.refresh().then(() => {
          if (themeChanged) void themes.load()
        })
        tabs.syncFromDisk(paths)
      }, 350)
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })

    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && openMenu) {
        openMenu = null
        return
      }
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        void saveActive()
      } else if (key === 'o') {
        event.preventDefault()
        void openVault()
      } else if (key === 'w') {
        event.preventDefault()
        closeActiveTab()
      } else if (key === 'f') {
        event.preventDefault()
        focusSearch()
      } else if (key === 'n') {
        event.preventDefault()
        void openNewDoc()
      } else if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (markdownTabActive) showExport = true
      } else if (key === ',' ) {
        event.preventDefault()
        showSettings = true
      } else if (event.key === '\\') {
        event.preventDefault()
        if (markdownTabActive) {
          viewMode = viewMode === 'wysiwyg' ? 'source' : 'wysiwyg'
        }
      }
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('.ProseMirror, .cm-content')) {
        lastEditorFocus = target
      }
    }

    window.addEventListener('keydown', onKeydown)
    window.addEventListener('focusin', onFocusIn)
    return () => {
      disposed = true
      clearTimeout(watcherTimer)
      unlisten?.()
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('focusin', onFocusIn)
    }
  })

  async function openVault(): Promise<boolean> {
    const opened = await vault.choose()
    if (opened) {
      tabs.reset()
      await themes.load()
    } else if (vault.error) {
      window.alert(vault.error)
    }
    return opened
  }

  async function openDemo(): Promise<void> {
    await vault.openDemo()
    tabs.reset()
    await themes.load()
    await tabs.open('欢迎使用 Markup.md')
  }

  async function openNewDoc(folder?: string): Promise<void> {
    // Clicking "new note" before choosing a folder used to do nothing at all.
    // Ask for the Vault first, then continue with the new-note dialog. The
    // browser preview has no folder picker, so it falls back to the demo vault.
    if (!vault.isOpen) {
      if (IS_TAURI) {
        const opened = await openVault()
        if (!opened) return
      } else {
        await openDemo()
        if (!vault.isOpen) return
      }
    }
    newDocFolder = folder ?? (tabs.active ? dirname(tabs.active.path) : '')
    showNewDoc = true
  }

  async function createNewDoc(name: string, content: string): Promise<void> {
    await tabs.createAndOpen(newDocFolder, name, content)
  }

  async function saveActive(force = false): Promise<void> {
    const tab = tabs.active
    if (!tab) return
    const outcome = await tabs.save(tab.path, force)
    // Conflicts surface as a non-blocking banner above the editor.
    if (outcome === 'error' && tabs.saveError) {
      window.alert(tabs.saveError.replace(/^ENCODING:/, ''))
    }
  }

  function toggleSidebar(): void {
    settings.update({ sidebarVisible: !settings.value.sidebarVisible })
  }

  function toggleMenu(label: string): void {
    if (openMenu === label) {
      openMenu = null
      return
    }
    if (!openMenu) {
      focusBeforeMenu = document.activeElement as HTMLElement | null
    }
    openMenu = label
  }

  function hoverMenu(label: string): void {
    if (openMenu && openMenu !== label) openMenu = label
  }

  function chooseMenu(run: () => void): void {
    const previous = lastEditorFocus?.isConnected ? lastEditorFocus : focusBeforeMenu
    focusBeforeMenu = null
    openMenu = null
    if (previous?.isConnected) previous.focus()
    run()
  }

  function closeMenuOnOutsideClick(event: MouseEvent): void {
    if (!openMenu) return
    const target = event.target as Element | null
    if (!target?.closest?.('.menubar')) openMenu = null
  }

  function format(action: EditorAction): void {
    runEditorAction(action)
  }

  function editCommand(command: 'undo' | 'redo' | 'selectAll'): void {
    // ProseMirror and CodeMirror both handle the standard editing shortcuts;
    // dispatching the key event works for either editor without knowing which
    // one is mounted.
    const target = lastEditorFocus?.isConnected
      ? lastEditorFocus
      : (document.activeElement as HTMLElement | null)
    if (!target) return
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: command === 'selectAll' ? 'a' : 'z',
        ctrlKey: true,
        shiftKey: command === 'redo',
        bubbles: true,
        cancelable: true
      })
    )
  }

  function closeActiveTab(): void {
    const tab = tabs.active
    if (tab) tabs.close(tab.id)
  }

  function focusSearch(): void {
    if (!settings.value.sidebarVisible) {
      settings.update({ sidebarVisible: true })
    }
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('.sidebar-search input')
      input?.focus()
      input?.select()
    })
  }

  async function minimizeWindow(): Promise<void> {
    try {
      await appWindow?.minimize()
    } catch {
      // Not running inside Tauri.
    }
  }

  async function toggleMaximizeWindow(): Promise<void> {
    try {
      await appWindow?.toggleMaximize()
    } catch {
      // Not running inside Tauri.
    }
  }

  async function closeWindow(): Promise<void> {
    try {
      await appWindow?.close()
    } catch {
      // Not running inside Tauri.
    }
  }
</script>

<svelte:window onclick={closeMenuOnOutsideClick} />

<div class="app" class:sidebar-hidden={!vault.isOpen || !settings.value.sidebarVisible}>
  <header class="menubar" data-tauri-drag-region>
    <div class="app-mark" data-tauri-drag-region aria-hidden="true">M</div>

    <div class="menus" role="menubar" aria-label="应用菜单">
      {#each menus as menu (menu.label)}
        <div class="menu-root" role="none" onmouseenter={() => hoverMenu(menu.label)}>
          <button
            class="menu-trigger"
            class:open={openMenu === menu.label}
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.label}
            onclick={() => toggleMenu(menu.label)}>
            {menu.label}
          </button>
          {#if openMenu === menu.label}
            <div class="menu-pop" role="menu" aria-label={menu.label}>
              {#each menu.entries as item}
                {#if 'separator' in item}
                  <div class="menu-sep" role="separator"></div>
                {:else}
                  <button
                    class="menu-item"
                    role="menuitem"
                    disabled={item.disabled}
                    onclick={() => chooseMenu(item.run)}>
                    <span class="menu-check">{item.checked ? '✓' : ''}</span>
                    <span class="menu-label">{item.label}</span>
                    {#if item.shortcut}
                      <span class="menu-shortcut">{item.shortcut}</span>
                    {/if}
                  </button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="menubar-spacer" data-tauri-drag-region></div>

    <button
      class="icon-btn menubar-sidebar"
      class:active={settings.value.sidebarVisible}
      title="切换侧边栏"
      aria-label="切换侧边栏"
      onclick={toggleSidebar}>☰</button>

    {#if IS_TAURI}
      <div class="window-controls">
        <button
          class="window-btn"
          title="最小化"
          aria-label="最小化"
          onclick={() => void minimizeWindow()}>–</button>
        <button
          class="window-btn"
          title="最大化 / 还原"
          aria-label="最大化或还原"
          onclick={() => void toggleMaximizeWindow()}>□</button>
        <button
          class="window-btn close"
          title="关闭"
          aria-label="关闭窗口"
          onclick={() => void closeWindow()}>×</button>
      </div>
    {/if}
  </header>

  <TabBar onnew={() => void openNewDoc()} />

  {#if vault.isOpen}
    <Sidebar onnew={openNewDoc} />
  {:else}
    <div></div>
  {/if}

  <main class="main">
    <ConflictBar />
    <div class="editor-area">
      {#if tabs.active}
        {#if tabs.active.kind === 'text'}
          <TextPane tab={tabs.active} />
        {:else}
          <EditorPane tab={tabs.active} mode={viewMode} />
        {/if}
      {:else if !vault.isOpen}
        <Welcome onopen={() => void openVault()} ondemo={() => void openDemo()} busy={vault.loading} />
      {:else}
        <div class="welcome">
          <div class="welcome-card">
            <h1 style="font-size:22px">开始写作</h1>
            <p>从左侧选择一篇笔记，或新建文档。附件会统一保存到 <code>attachments/</code>。</p>
            <div class="welcome-actions">
              <button class="button primary" onclick={() => void openNewDoc()}>新建笔记</button>
              <button class="button" onclick={() => (showSettings = true)}>打开设置</button>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </main>

  <StatusBar />
</div>

{#if tabs.active && tabs.active.kind === 'markdown'}
  <LazyExportDialog open={showExport} tab={tabs.active} onclose={() => (showExport = false)} />
{/if}
<NewDocDialog
  open={showNewDoc}
  folder={newDocFolder}
  onclose={() => (showNewDoc = false)}
  oncreate={createNewDoc}
/>
<SettingsDialog open={showSettings} onclose={() => (showSettings = false)} />

{#if showAbout}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showAbout = false
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="关于 Markup" tabindex="-1">
      <div class="modal-head">
        <h2>关于 Markup</h2>
      </div>
      <div class="modal-body">
        <p><strong>Markup</strong> 0.1.0</p>
        <p class="hint">本地优先的 Markdown 知识库编辑器。</p>
        <p class="hint">Tauri 2 · Svelte 5 · Milkdown / ProseMirror · CodeMirror 6</p>
      </div>
      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="button primary" onclick={() => (showAbout = false)}>关闭</button>
      </div>
    </div>
  </div>
{/if}
