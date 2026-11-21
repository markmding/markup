<script lang="ts">
  // Export pipeline (remark/rehype/katex) is only needed on demand.
  import type { Tab } from '../stores/tabs.svelte'

  let {
    open,
    tab,
    onclose
  }: { open: boolean; tab: Tab | undefined; onclose: () => void } = $props()

  let Loaded = $state<any>(null)

  $effect(() => {
    if (!open || Loaded) return
    let cancelled = false
    void import('./ExportDialog.svelte').then((module) => {
      if (!cancelled) Loaded = module.default
    })
    return () => {
      cancelled = true
    }
  })
</script>

{#if open && Loaded}
  <Loaded {open} {tab} {onclose} />
{/if}
