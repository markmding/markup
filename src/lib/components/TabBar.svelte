<script lang="ts">
  import { tabs } from '../stores/tabs.svelte'

  let { onnew }: { onnew: () => void } = $props()
</script>

<div class="tabbar" role="tablist" aria-label="打开的文档">
  {#each tabs.tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tabs.activeId === tab.id}
      role="tab"
      tabindex="0"
      aria-selected={tabs.activeId === tab.id}
      title={tab.path}
      onclick={() => tabs.select(tab.id)}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          tabs.select(tab.id)
        }
      }}
    >
      {#if tab.dirty}
        <span class="tab-dot" title="有未保存的修改"></span>
      {/if}
      <span class="tab-title">{tab.title}</span>
      <button
        class="tab-close"
        title="关闭"
        aria-label={`关闭 ${tab.title}`}
        onclick={(event) => {
          event.stopPropagation()
          tabs.close(tab.id)
        }}>×</button>
    </div>
  {/each}
  <button class="icon-btn tabbar-new" title="新建笔记 (Ctrl+N)" onclick={onnew}>＋</button>
</div>
