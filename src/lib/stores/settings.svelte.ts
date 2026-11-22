import type { HtmlExportMode } from '../types'

const STORAGE_KEY = 'markup.settings.v1'

export type AppTheme = 'light' | 'dark' | 'system'

export interface SettingsState {
  theme: AppTheme
  /** `light` | `dark` | `theme:<vault-relative-path>` */
  documentTheme: string
  editorFontSize: number
  /** F2.8 timer autosave (independent switch) */
  autosaveTimer: boolean
  autosaveInterval: number
  /** F2.8 blur autosave (independent switch) */
  autosaveBlur: boolean
  spellcheck: boolean
  /** Render Mermaid diagrams in export preview / exported HTML */
  renderMermaid: boolean
  /** Skip rendering off-screen blocks in long documents (F2.7 stage 1) */
  chunkedRendering: boolean
  /** F7.4 export defaults */
  defaultHtmlMode: HtmlExportMode
  defaultPageStart: number
  defaultPageRange: 'all' | 'range'
  sidebarVisible: boolean
}

const defaults: SettingsState = {
  theme: 'light',
  documentTheme: 'light',
  editorFontSize: 16,
  autosaveTimer: true,
  autosaveInterval: 30,
  autosaveBlur: true,
  spellcheck: false,
  renderMermaid: true,
  chunkedRendering: true,
  defaultHtmlMode: 'folder',
  defaultPageStart: 1,
  defaultPageRange: 'all',
  sidebarVisible: true
}

function load(): SettingsState {
  if (typeof localStorage === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    return { ...defaults, ...(JSON.parse(raw) as Partial<SettingsState>) }
  } catch {
    return { ...defaults }
  }
}

class SettingsStore {
  value = $state<SettingsState>(load())

  update(patch: Partial<SettingsState>): void {
    this.value = { ...this.value, ...patch }
    this.persist()
  }

  setTheme(theme: AppTheme): void {
    this.update({ theme })
    this.applyTheme()
  }

  /** Applies theme + typography to the document root. */
  applyTheme(): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const resolved =
      this.value.theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : this.value.theme
    root.dataset.theme = resolved
    root.style.setProperty('--editor-font-size', `${this.value.editorFontSize}px`)
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.value))
    } catch {
      // Quota / private mode: settings stay in memory for this session.
    }
  }
}

export const settings = new SettingsStore()
