<script lang="ts">
  import { tabs } from '../stores/tabs.svelte'

  const active = $derived(tabs.active)
  const visible = $derived(
    Boolean(active && tabs.conflict && tabs.conflict.path === active.path)
  )

  async function resolve(action: 'reload' | 'overwrite'): Promise<void> {
    if (!active) return
    const ok = await tabs.resolveConflict(active.path, action)
    if (!ok && tabs.saveError) window.alert(tabs.saveError)
  }
</script>

{#if visible && active}
  <div class="conflict-bar" role="alert">
    <span>「{active.title}」已在外部被修改，保存已被阻止。</span>
    <span class="conflict-hint">请选择保留哪一份内容。</span>
    <span class="spacer"></span>
    <button class="button ghost" onclick={() => void resolve('reload')}>
      重新加载（放弃本地修改）
    </button>
    <button class="button primary" onclick={() => void resolve('overwrite')}>
      覆盖保存
    </button>
  </div>
{/if}
