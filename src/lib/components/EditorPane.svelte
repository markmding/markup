<script lang="ts">
  import { Crepe } from '@milkdown/crepe'
  import '@milkdown/crepe/theme/common/style.css'
  import '@milkdown/crepe/theme/frame.css'
  import { untrack } from 'svelte'
  import type { ViewMode } from '../types'
  import { tabs, type Tab } from '../stores/tabs.svelte'
  import { settings } from '../stores/settings.svelte'
  import LazySourceView from './LazySourceView.svelte'

  let { tab, mode }: { tab: Tab; mode: ViewMode } = $props()
  let host = $state<HTMLDivElement>()

  $effect(() => {
    if (mode !== 'wysiwyg' || !host) return
    const element = host
    const path = tab.path
    const initial = untrack(() => tab.content)
    let cancelled = false
    let disposed = false
    let ready = false
    let instance: Crepe | null = null

    const crepe = new Crepe({
      root: element,
      defaultValue: initial,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: '输入 / 插入块，或直接开始写作…'
        }
      }
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
      const target = instance
      instance = null
      void target?.destroy()
    }

    instance = crepe
    void crepe
      .create()
      .then(() => {
        if (cancelled) dispose()
        else ready = true
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

  function handleBlur(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null
    const current = event.currentTarget as HTMLElement
    if (next && current.contains(next)) return
    if (settings.value.autosaveBlur) void tabs.save(tab.path)
  }
</script>

{#if mode === 'wysiwyg'}
  {#key tab.path}
    <div
      class="editor-host"
      bind:this={host}
      onfocusout={handleBlur}
      spellcheck={settings.value.spellcheck}
    ></div>
  {/key}
{:else}
  {#key tab.path}
    <LazySourceView
      value={tab.content}
      onchange={(next) => tabs.update(tab.path, next)}
      onblur={() => {
        if (settings.value.autosaveBlur) void tabs.save(tab.path)
      }}
    />
  {/key}
{/if}
