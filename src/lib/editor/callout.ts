import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

const TYPES = new Set(['note', 'tip', 'warning', 'danger', 'info', 'success'])
const MARKER = /^\[!(NOTE|TIP|WARNING|DANGER|INFO|SUCCESS)\]/i

/**
 * GFM-style callouts (`> [!TIP] title`) stay blockquotes in the AST for
 * Markdown fidelity; this plugin decorates them for the editor and hides the
 * marker text. Export applies the same convention via remark.
 */
export const calloutPlugin = new Plugin({
  key: new PluginKey('markup-callout'),
  props: {
    decorations(state) {
      const decorations: Decoration[] = []

      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'blockquote') return
        const first = node.firstChild
        if (!first || first.type.name !== 'paragraph') return false

        const match = MARKER.exec(first.textContent)
        if (!match) return false
        const kind = match[1].toLowerCase()
        if (!TYPES.has(kind)) return false

        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: `mk-callout mk-callout-${kind}`,
            'data-callout': kind
          })
        )
        // blockquote(pos) > paragraph(pos+1) > text starts at pos+2
        const start = pos + 2
        decorations.push(
          Decoration.inline(start, start + match[0].length, {
            class: 'mk-callout-marker'
          })
        )
        return false
      })

      return DecorationSet.create(state.doc, decorations)
    }
  }
})
