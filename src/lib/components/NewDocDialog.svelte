<script lang="ts">
  import * as api from '../api/vault'
  import { stripExtension } from '../paths'
  import { vault } from '../stores/vault.svelte'
  import { untrack } from 'svelte'

  interface TemplateItem {
    name: string
    path: string
    content: string
  }

  let {
    open,
    folder = '',
    onclose,
    oncreate
  }: {
    open: boolean
    folder?: string
    onclose: () => void
    oncreate: (name: string, content: string) => Promise<void> | void
  } = $props()

  let name = $state('未命名')
  let selected = $state('')
  let templates = $state<TemplateItem[]>([])
  let loading = $state(false)
  let busy = $state(false)
  let error = $state('')

  $effect(() => {
    if (!open) return
    name = '未命名'
    selected = ''
    templates = []
    error = ''
    void loadTemplates()
  })

  async function loadTemplates(): Promise<void> {
    const root = untrack(() => vault.root)
    if (!root) return
    const dir = untrack(() =>
      vault.entries.find((entry) => entry.kind === 'dir' && entry.name === 'templates')
    )
    const files = (dir?.children ?? []).filter(
      (entry) => entry.kind === 'file' && /\.md$/i.test(entry.name)
    )
    loading = true
    try {
      const loaded = await Promise.all(
        files.map(async (file) => {
          try {
            const doc = await api.readDoc(root, file.path)
            return {
              name: stripExtension(file.name),
              path: file.path,
              content: doc.content
            }
          } catch {
            return null
          }
        })
      )
      templates = loaded.filter((item): item is TemplateItem => item !== null)
    } finally {
      loading = false
    }
  }

  async function submit(): Promise<void> {
    if (busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      error = '请输入笔记名称'
      return
    }
    const template = templates.find((item) => item.name === selected)
    error = ''
    busy = true
    try {
      await oncreate(trimmed, template?.content ?? '')
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

{#if open}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose()
    }}
  >
    <div class="modal" role="dialog" aria-modal="true" aria-label="新建笔记" tabindex="-1">
      <div class="modal-head">
        <h2>新建笔记</h2>
        <button class="icon-btn" title="关闭" onclick={onclose}>×</button>
      </div>

      <div class="modal-body">
        <div class="form-grid">
          <div class="field full">
            <label for="new-doc-name">文件名</label>
            <input
              id="new-doc-name"
              bind:value={name}
              placeholder="未命名"
              oninput={() => (error = '')}
              onkeydown={(event) => {
                if (event.key === 'Enter') void submit()
              }}
            />
            <span class="hint">自动补全 .md；位置：{folder || 'Vault 根目录'}</span>
          </div>

          <div class="field full">
            <label for="new-doc-template">模板</label>
            <select id="new-doc-template" bind:value={selected}>
              <option value="">空白文档</option>
              {#each templates as template (template.path)}
                <option value={template.name}>{template.name}</option>
              {/each}
            </select>
            <span class="hint">
              {#if loading}
                正在读取 templates/ …
              {:else if templates.length === 0}
                在 Vault 的 templates/ 目录放置 .md 文件即可作为模板
              {:else}
                已发现 {templates.length} 个模板
              {/if}
            </span>
          </div>
        </div>
        {#if error}
          <div class="alert danger" role="alert">{error}</div>
        {/if}
      </div>

      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="button" onclick={onclose}>取消</button>
        <button class="button primary" onclick={() => void submit()} disabled={busy}>
          {busy ? '创建中…' : '创建'}
        </button>
      </div>
    </div>
  </div>
{/if}
