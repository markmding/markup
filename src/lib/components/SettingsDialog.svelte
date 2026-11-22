<script lang="ts">
  import {
    settings,
    type AppTheme,
    type SettingsState
  } from '../stores/settings.svelte'
  import { themes } from '../stores/themes.svelte'

  let { open, onclose }: { open: boolean; onclose: () => void } = $props()

  const s = $derived(settings.value)

  function update<K extends keyof SettingsState>(key: K, value: SettingsState[K]): void {
    settings.update({ [key]: value } as Partial<SettingsState>)
  }

  function changeDocTheme(value: string): void {
    settings.update({ documentTheme: value })
    if (value === 'light' || value === 'dark') settings.setTheme(value)
    themes.applySelection()
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
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1">
      <div class="modal-head">
        <h2>设置</h2>
        <button class="icon-btn" title="关闭" onclick={onclose}>×</button>
      </div>

      <div class="modal-body">
        <div class="field" style="margin-bottom:12px">
          <label for="theme">外观主题</label>
          <select
            id="theme"
            value={s.theme}
            onchange={(event) => settings.setTheme(event.currentTarget.value as AppTheme)}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </div>

        <div class="field" style="margin-bottom:12px">
          <label for="doc-theme">文档主题</label>
          <select
            id="doc-theme"
            value={s.documentTheme}
            onchange={(event) => changeDocTheme(event.currentTarget.value)}
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            {#each themes.items as theme (theme.path)}
              <option value={`theme:${theme.path}`}>{theme.name}</option>
            {/each}
          </select>
          <span class="hint">
            {#if themes.loading}
              正在读取 themes/ …
            {:else if themes.items.length === 0}
              在 Vault 的 themes/ 目录放置 .css 文件即可作为主题
            {:else}
              已加载 {themes.items.length} 个自定义主题（themes/*.css）
            {/if}
          </span>
          <button
            class="button"
            style="align-self:flex-start;margin-top:6px;height:28px"
            onclick={() => void themes.load()}
          >
            刷新主题
          </button>
        </div>

        <div class="field" style="margin-bottom:12px">
          <label for="font-size">编辑器字体大小（{s.editorFontSize}px）</label>
          <input
            id="font-size"
            type="range"
            min="13"
            max="22"
            step="1"
            value={s.editorFontSize}
            oninput={(event) => update('editorFontSize', Number(event.currentTarget.value))}
          />
        </div>

        <h3 style="font-size:13px;margin:18px 0 4px">自动保存</h3>
        <div class="switch-row">
          <div class="switch-label">
            <strong>定时自动保存</strong>
            <span>按固定间隔保存当前文档</span>
          </div>
          <button
            class="switch"
            class:on={s.autosaveTimer}
            role="switch"
            aria-checked={s.autosaveTimer}
            aria-label="定时自动保存"
            onclick={() => update('autosaveTimer', !s.autosaveTimer)}
          ></button>
        </div>
        {#if s.autosaveTimer}
          <div class="field" style="margin:6px 0 12px">
            <label for="interval">间隔：{s.autosaveInterval} 秒（10–300）</label>
            <input
              id="interval"
              type="range"
              min="10"
              max="300"
              step="5"
              value={s.autosaveInterval}
              oninput={(event) => update('autosaveInterval', Number(event.currentTarget.value))}
            />
          </div>
        {/if}
        <div class="switch-row">
          <div class="switch-label">
            <strong>失焦自动保存</strong>
            <span>编辑器失去焦点时保存</span>
          </div>
          <button
            class="switch"
            class:on={s.autosaveBlur}
            role="switch"
            aria-checked={s.autosaveBlur}
            aria-label="失焦自动保存"
            onclick={() => update('autosaveBlur', !s.autosaveBlur)}
          ></button>
        </div>
        <div class="switch-row">
          <div class="switch-label">
            <strong>拼写检查</strong>
            <span>编辑器内启用系统拼写检查</span>
          </div>
          <button
            class="switch"
            class:on={s.spellcheck}
            role="switch"
            aria-checked={s.spellcheck}
            aria-label="拼写检查"
            onclick={() => update('spellcheck', !s.spellcheck)}
          ></button>
        </div>

        <h3 style="font-size:13px;margin:18px 0 4px">编辑器与渲染</h3>
        <div class="switch-row">
          <div class="switch-label">
            <strong>渲染 Mermaid 图表</strong>
            <span>关闭后编辑器、导出预览与导出的 HTML 都保留 Mermaid 源码块，不做图表渲染</span>
          </div>
          <button
            class="switch"
            class:on={s.renderMermaid}
            role="switch"
            aria-checked={s.renderMermaid}
            aria-label="渲染 Mermaid 图表"
            onclick={() => update('renderMermaid', !s.renderMermaid)}
          ></button>
        </div>
        <div class="switch-row">
          <div class="switch-label">
            <strong>长文档分块渲染（实验）</strong>
            <span>视口外的块卸载 DOM 内容、滚动时按需恢复，降低长文档内存占用与输入卡顿</span>
          </div>
          <button
            class="switch"
            class:on={s.chunkedRendering}
            role="switch"
            aria-checked={s.chunkedRendering}
            aria-label="长文档分块渲染"
            onclick={() => update('chunkedRendering', !s.chunkedRendering)}
          ></button>
        </div>

        <h3 style="font-size:13px;margin:18px 0 4px">导出默认偏好</h3>
        <div class="form-grid">
          <div class="field">
            <label for="html-mode">HTML 打包模式</label>
            <select
              id="html-mode"
              value={s.defaultHtmlMode}
              onchange={(event) =>
                update('defaultHtmlMode', event.currentTarget.value as 'folder' | 'single')}
            >
              <option value="folder">独立文件夹</option>
              <option value="single">单 HTML（base64）</option>
            </select>
          </div>
          <div class="field">
            <label for="page-start">PDF 页码起始值</label>
            <input
              id="page-start"
              type="number"
              min="1"
              value={s.defaultPageStart}
              onchange={(event) =>
                update('defaultPageStart', Math.max(1, Number(event.currentTarget.value) || 1))}
            />
          </div>
        </div>

        <p class="hint" style="margin-top:18px">
          Markup 以富文本 AST 为基准，Markdown 为持久化格式；保存时会自动规范化标记风格
          （加粗统一为 **、列表统一为 -、标题统一为 #）。
        </p>
      </div>

      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="button primary" onclick={onclose}>完成</button>
      </div>
    </div>
  </div>
{/if}
