<script lang="ts">
  // CodeMirror is ~1MB of JS; only pull it in when the source view is used.
  let {
    value,
    filename = '',
    onchange = () => {},
    onblur,
    readonly = false,
    onready,
    onbeforeupdate
  }: {
    value: string
    filename?: string
    onchange?: (next: string) => void
    onblur?: () => void
    readonly?: boolean
    onready?: (view: import('@codemirror/view').EditorView | null) => void
    onbeforeupdate?: () => void
  } = $props()

  let Loaded = $state<any>(null)

  $effect(() => {
    let cancelled = false
    void import('./SourceView.svelte').then((module) => {
      if (!cancelled) Loaded = module.default
    })
    return () => {
      cancelled = true
    }
  })
</script>

{#if Loaded}
  <Loaded {value} {filename} {onchange} {onblur} {readonly} {onready} {onbeforeupdate} />
{:else}
  <div class="empty">正在加载源码视图…</div>
{/if}
