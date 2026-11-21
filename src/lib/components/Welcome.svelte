<script lang="ts">
  let {
    onopen,
    ondemo,
    busy = false
  }: { onopen: () => void; ondemo: () => void; busy?: boolean } = $props()
</script>

<div class="welcome">
  <div class="welcome-card">
    <div class="welcome-mark">M</div>
    <h1>Markup</h1>
    <p>
      本地优先的 Markdown 知识库编辑器。文件保存在你自己的文件夹里，
      所见即所得编辑，支持公式、Mermaid、主题与 PDF / HTML 导出。
    </p>

    <div class="welcome-actions">
      <button class="button primary" onclick={onopen} disabled={busy}>
        {busy ? '正在打开…' : '打开文件夹'}
      </button>
      <button class="button" onclick={ondemo} disabled={busy}>打开示例库</button>
    </div>

    <div class="welcome-points">
      <div><strong>Vault 模式</strong>：任意本地文件夹即知识库，附件固定存放于 <code>attachments/</code>。</div>
      <div><strong>富文本即真值</strong>：保存时自动规范化 Markdown 语法，切换源码视图不丢内容。</div>
      <div><strong>快捷键</strong>：<kbd>Ctrl</kbd> + <kbd>N</kbd> 新建 · <kbd>Ctrl</kbd> + <kbd>S</kbd> 保存 · <kbd>Ctrl</kbd> + <kbd>\</kbd> 切换源码</div>
    </div>
  </div>
</div>
