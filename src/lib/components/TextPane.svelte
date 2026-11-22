<script lang="ts">
  import LazySourceView from './LazySourceView.svelte'
  import { settings } from '../stores/settings.svelte'
  import { tabs, type Tab } from '../stores/tabs.svelte'

  let { tab }: { tab: Tab } = $props()
</script>

<!-- Plain-text files (css/js/txt/…) always use the source editor. -->
{#key `${tab.path}:${tab.revision}`}
  <div class="text-host">
    <LazySourceView
      value={tab.content}
      filename={tab.path}
      onchange={(next) => tabs.update(tab.path, next)}
      onblur={() => {
        if (settings.value.autosaveBlur) void tabs.save(tab.path)
      }}
    />
  </div>
{/key}
