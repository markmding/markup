import * as api from '../api/vault'
import { settings } from './settings.svelte'
import { vault } from './vault.svelte'

export interface ThemeItem {
  name: string
  path: string
  css: string
}

class ThemeStore {
  items = $state<ThemeItem[]>([])
  customCss = $state('')
  loading = $state(false)

  /** Reads themes/*.css from the current vault. */
  async load(): Promise<void> {
    const root = vault.root
    if (!root) {
      this.items = []
      this.applySelection()
      return
    }
    const dir = vault.entries.find(
      (entry) => entry.kind === 'dir' && entry.name === 'themes'
    )
    const files = (dir?.children ?? []).filter(
      (entry) => entry.kind === 'file' && /\.css$/i.test(entry.name)
    )
    this.loading = true
    try {
      const loaded = await Promise.all(
        files.map(async (file) => {
          try {
            const doc = await api.readDoc(root, file.path)
            return {
              name: file.name.replace(/\.css$/i, ''),
              path: file.path,
              css: doc.content
            }
          } catch {
            return null
          }
        })
      )
      this.items = loaded.filter((item): item is ThemeItem => item !== null)
    } finally {
      this.loading = false
    }
    this.applySelection()
  }

  /** Applies the selected theme CSS to the app (editor + preview share it). */
  applySelection(): void {
    const id = settings.value.documentTheme
    const path = id.startsWith('theme:') ? id.slice('theme:'.length) : ''
    const item = path ? this.items.find((theme) => theme.path === path) : undefined
    this.customCss = item?.css ?? ''
    if (typeof document === 'undefined') return

    let style = document.getElementById('markup-custom-theme') as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = 'markup-custom-theme'
      document.head.appendChild(style)
    }
    style.textContent = this.customCss
  }
}

export const themes = new ThemeStore()
