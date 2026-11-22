<script lang="ts">
  import { Crepe } from '@milkdown/crepe'
  import '@milkdown/crepe/theme/common/style.css'
  import '@milkdown/crepe/theme/frame.css'
  import {
    commandsCtx,
    editorViewCtx,
    editorViewOptionsCtx,
    prosePluginsCtx
  } from '@milkdown/kit/core'
  import type { EditorView as ProseEditorView } from '@milkdown/kit/prose/view'
  import type { EditorView as SourceEditorView } from '@codemirror/view'
  import { upload, uploadConfig } from '@milkdown/kit/plugin/upload'
  import {
    addBlockTypeCommand,
    clearTextInCurrentBlockCommand,
    codeBlockSchema,
    createCodeBlockCommand,
    toggleEmphasisCommand,
    toggleInlineCodeCommand,
    toggleStrongCommand,
    wrapInBlockquoteCommand,
    wrapInBulletListCommand,
    wrapInHeadingCommand,
    wrapInOrderedListCommand
  } from '@milkdown/kit/preset/commonmark'
  import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
  import { untrack } from 'svelte'
  import {
    setEditorActionHandler,
    type EditorAction
  } from '../editor/actions'
  import {
    createUploader,
    persistAttachment,
    resolveAttachmentUrl
  } from '../editor/attachments'
  import { calloutPlugin } from '../editor/callout'
  import {
    createSplitScrollSync,
    type SplitScrollSync
  } from '../editor/split-sync'
  import {
    refreshVirtualBlocks,
    restoreVirtualBlocks,
    virtualBlockNodeViews
  } from '../editor/virtual-blocks'
  import { renderMermaidSvg } from '../mermaid'
  import type { ViewMode } from '../types'
  import { tabs, type Tab } from '../stores/tabs.svelte'
  import { settings } from '../stores/settings.svelte'
  import { vault } from '../stores/vault.svelte'
  import LazySourceView from './LazySourceView.svelte'

  const MERMAID_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h4a3 3 0 0 1 3 3V15"/></svg>`

  let { tab, mode }: { tab: Tab; mode: ViewMode } = $props()
  let host = $state<HTMLDivElement>()
  let proseView = $state<ProseEditorView | null>(null)
  let sourceView = $state<SourceEditorView | null>(null)
  let splitSync: SplitScrollSync | null = null

  // Keep the WYSIWYG editor mounted when switching between 预览 and 分栏;
  // rebuilding it would reset the scroll position and the undo history.
  const editorEnabled = $derived(mode !== 'source')

  // 分块渲染 off: immediately bring back blocks that were already detached.
  // On: re-run the intersection check so far-away blocks detach again.
  $effect(() => {
    if (settings.value.chunkedRendering) refreshVirtualBlocks()
    else restoreVirtualBlocks()
  })

  // Entering/leaving 分栏 changes the pane width, so the cached remembered
  // heights of detached blocks no longer match. Restore them once, then let
  // the observer re-detach with heights measured at the new width.
  $effect(() => {
    if (!host || !editorEnabled) return
    const frame = requestAnimationFrame(() => {
      restoreVirtualBlocks()
      refreshVirtualBlocks()
    })
    return () => cancelAnimationFrame(frame)
  })

  $effect(() => {
    if (!editorEnabled || !host) return
    const element = host
    const path = tab.path
    const initial = untrack(() => tab.content)
    // Tracked dependency: toggling the setting rebuilds the editor so existing
    // Mermaid preview panels appear/disappear immediately.
    const mermaidEnabled = settings.value.renderMermaid
    let cancelled = false
    let disposed = false
    let ready = false
    let instance: Crepe | null = null

    const uploadImage = async (file: File): Promise<string> => {
      if (!vault.root) throw new Error('请先打开一个 Vault 再插入图片')
      return persistAttachment(vault.root, file)
    }

    const escapePreview = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

    // Mermaid live preview inside the code block (Crepe preview panel).
    // Renders are queued in mermaid.ts, so applying in completion order keeps
    // the newest content last; no global sequence gate (it would starve blocks).
    const renderPreview = (
      language: string,
      content: string,
      applyPreview: (value: string | HTMLElement | null) => void
    ): void | null => {
      if (language !== 'mermaid' || !mermaidEnabled || !content.trim()) return null
      const dark = document.documentElement.dataset.theme === 'dark'
      void renderMermaidSvg(content, dark)
        .then((svg) => applyPreview(svg))
        .catch((error) => {
          applyPreview(
            `<div class="mermaid-render-error">Mermaid 渲染失败：${escapePreview(
              String(error)
            )}</div>`
          )
        })
      return undefined
    }

    const crepe = new Crepe({
      root: element,
      defaultValue: initial,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: '输入 / 插入块，或直接开始写作…'
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: uploadImage,
          inlineOnUpload: uploadImage,
          blockOnUpload: uploadImage,
          proxyDomURL: (url: string) => resolveAttachmentUrl(vault.root, url)
        },
        [Crepe.Feature.CodeMirror]: {
          renderPreview,
          previewLabel: '预览',
          previewLoading: '正在渲染 Mermaid…',
          previewToggleText: (previewOnlyMode: boolean) =>
            previewOnlyMode ? '编辑' : '隐藏预览'
        },
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder) => {
            builder.getGroup('advanced').addItem('mermaid', {
              label: 'Mermaid 图表',
              icon: MERMAID_ICON,
              onRun: (ctx) => {
                const commands = ctx.get(commandsCtx)
                const view = ctx.get(editorViewCtx)
                const codeBlock = codeBlockSchema.type(ctx)
                commands.call(clearTextInCurrentBlockCommand.key)
                commands.call(addBlockTypeCommand.key, {
                  nodeType: codeBlock,
                  attrs: { language: 'mermaid' }
                })
                // Seed the block so users immediately see a valid diagram.
                const template = 'flowchart LR\n  A[开始] --> B[结束]'
                view.dispatch(
                  view.state.tr.insertText(template, view.state.selection.from)
                )
              }
            })
          }
        }
      }
    })

    // Paste/drag images anywhere: save into attachments/ and insert an image node.
    crepe.editor.use(upload)
    crepe.editor.config((ctx) => {
      ctx.update(uploadConfig.key, (value) => ({
        ...value,
        uploader: createUploader(() => vault.root),
        enableHtmlFileUploader: false
      }))
      ctx.update(prosePluginsCtx, (plugins) => [...plugins, calloutPlugin])
      ctx.update(editorViewOptionsCtx, (options) => {
        const next = {
          ...options,
          nodeViews: {
            ...(options.nodeViews ?? {}),
            ...virtualBlockNodeViews
          }
        }
        ;(window as Window & { __markupNodeViews?: string[] }).__markupNodeViews =
          Object.keys(next.nodeViews ?? {})
        return next
      })
    })

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, previous) => {
        // Ignore the initial parse so opening a document is never "dirty".
        if (!ready) return
        if (markdown !== previous) tabs.update(path, markdown)
      })
    })

    const dispose = () => {
      if (disposed) return
      disposed = true
      proseView = null
      setEditorActionHandler(null)
      const target = instance
      instance = null
      void target?.destroy()
    }

    const installEditorActions = (): void => {
      setEditorActionHandler((action: EditorAction) => {
        try {
          const commands = crepe.editor.ctx.get(commandsCtx)
          const view = crepe.editor.ctx.get(editorViewCtx)
          view.focus()
          switch (action) {
            case 'strong':
              commands.call(toggleStrongCommand.key)
              break
            case 'emphasis':
              commands.call(toggleEmphasisCommand.key)
              break
            case 'strikethrough':
              commands.call(toggleStrikethroughCommand.key)
              break
            case 'inlineCode':
              commands.call(toggleInlineCodeCommand.key)
              break
            case 'heading1':
              commands.call(wrapInHeadingCommand.key, 1)
              break
            case 'heading2':
              commands.call(wrapInHeadingCommand.key, 2)
              break
            case 'heading3':
              commands.call(wrapInHeadingCommand.key, 3)
              break
            case 'paragraph':
              commands.call(wrapInHeadingCommand.key, 0)
              break
            case 'blockquote':
              commands.call(wrapInBlockquoteCommand.key)
              break
            case 'bulletList':
              commands.call(wrapInBulletListCommand.key)
              break
            case 'orderedList':
              commands.call(wrapInOrderedListCommand.key)
              break
            case 'codeBlock':
              commands.call(createCodeBlockCommand.key)
              break
            case 'table':
              commands.call(insertTableCommand.key, {})
              break
            default:
              return false
          }
          return true
        } catch {
          return false
        }
      })
    }

    instance = crepe
    void crepe
      .create()
      .then(() => {
        if (cancelled) {
          dispose()
          return
        }
        ready = true
        try {
          proseView = crepe.editor.ctx.get(editorViewCtx)
        } catch {
          proseView = null
        }
        installEditorActions()
      })
      .catch((error) => {
        console.error('[markup] editor failed to start', error)
        dispose()
      })

    return () => {
      cancelled = true
      dispose()
    }
  })

  // F8.2 split view: block-level scroll sync between the two panes.
  $effect(() => {
    if (mode !== 'split' || !proseView || !sourceView || !host) return
    const sync = createSplitScrollSync({
      prose: proseView,
      source: sourceView,
      scroller: host
    })
    splitSync = sync
    return () => {
      sync.destroy()
      if (splitSync === sync) splitSync = null
    }
  })

  function handleBlur(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null
    const current = event.currentTarget as HTMLElement
    if (next && current.contains(next)) return
    if (settings.value.autosaveBlur) void tabs.save(tab.path)
  }
</script>

{#if mode === 'source'}
  {#key `${tab.path}:${tab.revision}`}
    <LazySourceView
      value={tab.content}
      filename={tab.path}
      onchange={(next) => tabs.update(tab.path, next)}
      onblur={() => {
        if (settings.value.autosaveBlur) void tabs.save(tab.path)
      }}
    />
  {/key}
{:else}
  <div class="editor-split" class:split={mode === 'split'}>
    {#key `${tab.path}:${tab.revision}`}
      <div
        class="editor-host"
        class:chunked={settings.value.chunkedRendering}
        bind:this={host}
        onfocusout={handleBlur}
        spellcheck={settings.value.spellcheck}
      ></div>
    {/key}
    {#if mode === 'split'}
      <div class="split-source">
        <LazySourceView
          value={tab.content}
          filename={tab.path}
          readonly
          onready={(view) => (sourceView = view)}
          onbeforeupdate={() => splitSync?.suspend()}
        />
      </div>
    {/if}
  </div>
{/if}
