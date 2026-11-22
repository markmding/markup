import * as api from '../api/vault'
import {
  basename,
  ensureMdExtension,
  isMarkdown,
  joinPath,
  osDefaultEol,
  stripExtension
} from '../paths'
import type { Encoding, Eol } from '../types'
import { vault } from './vault.svelte'

export interface Tab {
  /** Vault-relative path doubles as the tab id. */
  id: string
  path: string
  title: string
  /** Markdown tabs use the rich editor; text tabs always use the source editor. */
  kind: 'markdown' | 'text'
  content: string
  mtime: number
  encoding: Encoding
  eol: Eol
  bom: boolean
  dirty: boolean
  saving: boolean
  /** Bumped when content is replaced from disk, forcing the editor to remount. */
  revision: number
}

export type SaveOutcome = 'saved' | 'conflict' | 'error' | 'noop'

class TabsStore {
  tabs = $state<Tab[]>([])
  activeId = $state<string | null>(null)
  lastSavedAt = $state<number | null>(null)
  saveError = $state<string | null>(null)
  /** Path whose on-disk mtime no longer matches the tab (non-blocking banner). */
  conflict = $state<{ path: string } | null>(null)

  get active(): Tab | undefined {
    return this.tabs.find((tab) => tab.id === this.activeId)
  }

  get dirtyCount(): number {
    return this.tabs.filter((tab) => tab.dirty).length
  }

  async open(path: string): Promise<void> {
    const existing = this.tabs.find((tab) => tab.path === path)
    if (existing) {
      this.activeId = existing.id
      return
    }
    if (!vault.root) return
    const doc = await api.readDoc(vault.root, path)
    const markdown = isMarkdown(path)
    this.tabs.push({
      id: path,
      path,
      title: markdown ? stripExtension(basename(path)) : basename(path),
      kind: markdown ? 'markdown' : 'text',
      content: doc.content,
      mtime: doc.mtime,
      encoding: doc.encoding,
      eol: doc.eol,
      bom: doc.bom,
      dirty: false,
      saving: false,
      revision: 0
    })
    this.activeId = path
  }

  async createAndOpen(folder: string, rawName: string, content = ''): Promise<void> {
    if (!vault.root) return
    const name = ensureMdExtension(rawName.trim())
    const rel = joinPath(folder, name)
    await api.createEntry(vault.root, rel, 'file')
    if (content) {
      await api.writeDoc(vault.root, rel, content, 0, true, {
        encoding: 'utf8',
        eol: osDefaultEol(),
        bom: false
      })
    }
    await vault.refresh()
    await this.open(rel)
  }

  select(id: string | null): void {
    this.activeId = id
  }

  /** Changing the target encoding marks the tab dirty; the next save converts. */
  setEncoding(path: string, encoding: Encoding, bom: boolean): void {
    const tab = this.tabs.find((item) => item.path === path)
    if (!tab) return
    if (tab.encoding === encoding && tab.bom === bom) return
    tab.encoding = encoding
    tab.bom = encoding === 'utf8' ? bom : false
    tab.dirty = true
  }

  setEol(path: string, eol: Eol): void {
    const tab = this.tabs.find((item) => item.path === path)
    if (!tab || tab.eol === eol) return
    tab.eol = eol
    tab.dirty = true
  }

  /** Resolves a save conflict from the non-blocking banner. */
  async resolveConflict(path: string, action: 'reload' | 'overwrite'): Promise<boolean> {
    const tab = this.tabs.find((item) => item.path === path)
    if (!tab || !vault.root) return false

    if (action === 'overwrite') {
      const outcome = await this.save(path, true)
      return outcome === 'saved'
    }

    try {
      const doc = await api.readDoc(vault.root, tab.path)
      tab.content = doc.content
      tab.mtime = doc.mtime
      tab.encoding = doc.encoding
      tab.eol = doc.eol
      tab.bom = doc.bom
      tab.dirty = false
      tab.revision += 1
      this.conflict = null
      this.saveError = null
      return true
    } catch (error) {
      this.saveError = error instanceof Error ? error.message : String(error)
      return false
    }
  }

  /** Drops all tabs when switching to another vault. */
  reset(): void {
    this.tabs = []
    this.activeId = null
    this.saveError = null
    this.conflict = null
    this.lastSavedAt = null
  }

  update(path: string, content: string): void {
    const tab = this.tabs.find((item) => item.path === path)
    if (!tab || tab.content === content) return
    tab.content = content
    tab.dirty = true
  }

  async save(path: string, force = false): Promise<SaveOutcome> {
    const tab = this.tabs.find((item) => item.path === path)
    if (!tab || !vault.root) return 'noop'
    // A pending conflict must be resolved explicitly; don't retry in the background.
    if (this.conflict?.path === path && !force) return 'conflict'
    if (!tab.dirty && !force) return 'noop'
    if (tab.saving) return 'noop'

    tab.saving = true
    this.saveError = null
    try {
      const result = await api.writeDoc(vault.root, tab.path, tab.content, tab.mtime, force, {
        encoding: tab.encoding,
        eol: tab.eol,
        bom: tab.bom
      })
      tab.mtime = result.mtime
      tab.dirty = false
      this.lastSavedAt = Date.now()
      if (this.conflict?.path === path) this.conflict = null
      return 'saved'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('CONFLICT')) {
        this.conflict = { path }
        this.saveError = null
        return 'conflict'
      }
      this.saveError = message
      return 'error'
    } finally {
      tab.saving = false
    }
  }

  async saveAll(): Promise<void> {
    for (const tab of this.tabs.filter((item) => item.dirty)) {
      await this.save(tab.path)
    }
  }

  /** Keeps open tabs pointing at the new location after rename/move. */
  renamePath(from: string, to: string): void {
    const previousActive = this.activeId
    for (const tab of this.tabs) {
      if (tab.path === from) {
        tab.path = to
        tab.id = to
        // Renaming across types (e.g. note.md → note.txt) switches editors.
        const markdown = isMarkdown(to)
        tab.kind = markdown ? 'markdown' : 'text'
        tab.title = markdown ? stripExtension(basename(to)) : basename(to)
      } else if (tab.path.startsWith(`${from}/`)) {
        const next = `${to}${tab.path.slice(from.length)}`
        tab.path = next
        tab.id = next
      }
    }
    if (previousActive === from) this.activeId = to
    else if (previousActive?.startsWith(`${from}/`)) {
      this.activeId = `${to}${previousActive.slice(from.length)}`
    }
  }

  closeByPath(path: string, force = false): void {
    const targets = this.tabs.filter(
      (tab) => tab.path === path || tab.path.startsWith(`${path}/`)
    )
    for (const tab of targets) this.close(tab.id, force)
  }

  close(id: string, force = false): void {
    const tab = this.tabs.find((item) => item.id === id)
    if (!tab) return
    if (tab.dirty && !force) {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm(`「${tab.title}」有未保存的修改，确定关闭吗？`)
          : true
      if (!confirmed) return
    }
    if (this.conflict?.path === tab.path) this.conflict = null
    const index = this.tabs.findIndex((item) => item.id === id)
    this.tabs.splice(index, 1)
    if (this.activeId === id) {
      const next = this.tabs[index] ?? this.tabs[index - 1]
      this.activeId = next?.id ?? null
    }
  }

  /** Called when the file watcher reports external changes. */
  syncFromDisk(paths: string[]): void {
    const normalized = new Set(paths.map((p) => p.replace(/\\/g, '/')))
    for (const tab of this.tabs) {
      const changed = [...normalized].some((p) => p.endsWith(tab.path))
      if (changed && !tab.dirty) {
        void this.reload(tab)
      }
    }
  }

  private async reload(tab: Tab): Promise<void> {
    if (!vault.root) return
    try {
      const doc = await api.readDoc(vault.root, tab.path)
      if (!tab.dirty) {
        if (doc.content !== tab.content) {
          tab.content = doc.content
          tab.revision += 1
        }
        // Refresh metadata even when content is unchanged, so the next save
        // does not false-positive on mtime.
        tab.mtime = doc.mtime
        tab.encoding = doc.encoding
        tab.eol = doc.eol
        tab.bom = doc.bom
      }
    } catch {
      // File may have been deleted externally; the tree refresh will reflect it.
    }
  }
}

export const tabs = new TabsStore()
