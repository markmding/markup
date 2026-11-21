export const isTauri =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Thin wrapper so the whole app can run in a plain browser for UI work. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: rawInvoke } = await import('@tauri-apps/api/core')
  return rawInvoke<T>(cmd, args)
}

export async function pickVaultFolder(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择知识库文件夹（Vault）'
  })
  return typeof selected === 'string' ? selected : null
}

export async function pickExportFile(
  defaultPath: string,
  filters: { name: string; extensions: string[] }[]
): Promise<string | null> {
  if (!isTauri) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  const selected = await save({
    defaultPath,
    title: '选择导出位置',
    filters
  })
  return typeof selected === 'string' ? selected : null
}

export async function pickExportFolder(): Promise<string | null> {
  if (!isTauri) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择导出文件夹'
  })
  return typeof selected === 'string' ? selected : null
}

export async function listenVaultChanges(
  handler: (paths: string[]) => void
): Promise<() => void> {
  if (!isTauri) return () => {}
  const { listen } = await import('@tauri-apps/api/event')
  const unlisten = await listen<string[]>('vault:changed', (event) => handler(event.payload))
  return unlisten
}
