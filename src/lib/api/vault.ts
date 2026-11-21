import type {
  DocPayload,
  ExportFile,
  SaveAttachmentResult,
  SearchHit,
  VaultInfo,
  WriteOptions,
  WriteResult
} from '../types'
import { downloadText } from '../export/download'
import { DEMO_ROOT, mock } from './mock'
import { invoke, isTauri } from './tauri'

export function isDemoRoot(root: string | null): boolean {
  return root === DEMO_ROOT
}

export async function openVault(path: string): Promise<VaultInfo> {
  if (path === DEMO_ROOT) return mock.open()
  return invoke<VaultInfo>('open_vault', { path })
}

export async function readDoc(root: string, rel: string): Promise<DocPayload> {
  if (isDemoRoot(root)) return mock.readDoc(rel)
  return invoke<DocPayload>('read_doc', { vault: root, rel })
}

export async function writeDoc(
  root: string,
  rel: string,
  content: string,
  mtime: number,
  force: boolean,
  options: WriteOptions
): Promise<WriteResult> {
  if (isDemoRoot(root)) return mock.writeDoc(rel, content, options)
  return invoke<WriteResult>('write_doc', {
    vault: root,
    rel,
    content,
    mtime,
    force,
    encoding: options.encoding,
    eol: options.eol,
    bom: options.bom
  })
}

export async function createEntry(
  root: string,
  rel: string,
  kind: 'dir' | 'file'
): Promise<void> {
  if (isDemoRoot(root)) {
    mock.createEntry(rel, kind)
    return
  }
  await invoke('create_entry', { vault: root, rel, kind })
}

export async function renameEntry(root: string, from: string, to: string): Promise<void> {
  if (isDemoRoot(root)) {
    mock.renameEntry(from, to)
    return
  }
  await invoke('rename_entry', { vault: root, from, to })
}

export async function deleteEntry(root: string, rel: string): Promise<void> {
  if (isDemoRoot(root)) {
    mock.deleteEntry(rel)
    return
  }
  await invoke('delete_entry', { vault: root, rel })
}

export async function saveAttachment(
  root: string,
  name: string,
  base64: string
): Promise<SaveAttachmentResult> {
  if (isDemoRoot(root)) return mock.saveAttachment(name, base64)
  return invoke<SaveAttachmentResult>('save_attachment', {
    vault: root,
    name,
    data: base64
  })
}

export async function searchVault(
  root: string,
  query: string,
  limit = 50
): Promise<SearchHit[]> {
  if (isDemoRoot(root)) return mock.search(query)
  return invoke<SearchHit[]>('search_vault', { vault: root, query, limit })
}

export async function readAttachment(root: string, rel: string): Promise<string | null> {
  if (isDemoRoot(root)) return null
  try {
    return await invoke<string | null>('read_attachment', { vault: root, rel })
  } catch {
    return null
  }
}

export async function writeExportFiles(dest: string, files: ExportFile[]): Promise<number> {
  if (!isTauri) return 0
  return invoke<number>('write_export_files', { dest, files })
}

/** Writes a single UTF-8 file (used by the single-file HTML export). */
export async function writeExportFile(path: string, content: string): Promise<void> {
  if (!isTauri) {
    const filename = path.split(/[\\/]/).pop() ?? 'export.html'
    downloadText(filename, content)
    return
  }
  await invoke('write_export_file', { path, content })
}

export async function watchVault(root: string): Promise<void> {
  if (isDemoRoot(root) || !isTauri) return
  await invoke('watch_vault', { root })
}

export async function unwatchVault(): Promise<void> {
  if (!isTauri) return
  await invoke('unwatch_vault')
}
