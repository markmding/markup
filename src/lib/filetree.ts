import type { VaultEntry } from './types'

export interface TreeRow {
  entry: VaultEntry
  depth: number
}

export function flattenTree(
  entries: VaultEntry[],
  expanded: Record<string, boolean>
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (list: VaultEntry[], depth: number) => {
    for (const entry of list) {
      rows.push({ entry, depth })
      if (entry.kind === 'dir' && (expanded[entry.path] ?? true) && entry.children) {
        walk(entry.children, depth + 1)
      }
    }
  }
  walk(entries, 0)
  return rows
}

/** Keeps directories that contain a match and highlights matching names. */
export function filterTree(entries: VaultEntry[], query: string): VaultEntry[] {
  const needle = query.toLowerCase()
  const walk = (list: VaultEntry[]): VaultEntry[] => {
    const result: VaultEntry[] = []
    for (const entry of list) {
      if (entry.kind === 'dir') {
        const children = entry.children ? walk(entry.children) : []
        if (children.length > 0 || entry.name.toLowerCase().includes(needle)) {
          result.push({ ...entry, children })
        }
      } else if (entry.name.toLowerCase().includes(needle)) {
        result.push(entry)
      }
    }
    return result
  }
  return walk(entries)
}

export function countEntries(entries: VaultEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (entry.kind === 'file') count++
    else if (entry.children) count += countEntries(entry.children)
  }
  return count
}
