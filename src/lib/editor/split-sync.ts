import type { EditorView as ProseView } from '@milkdown/kit/prose/view'
import type { EditorView as SourceView } from '@codemirror/view'

/**
 * F8.2 split view: keep the WYSIWYG pane and the read-only source pane on the
 * same document position.
 *
 * ProseMirror does not expose a source position → Markdown line mapping, and
 * the PRD explicitly settles for block-level alignment instead of a character
 * mapping. We pair the N-th heading in the AST with the N-th heading in the
 * Markdown text (both come from the same serialized document), then interpolate
 * between two neighboring headings. Heading positions adapt to different block
 * heights (code, images, tables), which plain scroll-ratio syncing cannot.
 *
 * Both directions are supported; each programmatic scroll is briefly ignored
 * by the receiving pane to avoid feedback loops.
 */

interface SplitSyncOptions {
  /** ProseMirror editor (WYSIWYG pane). */
  prose: ProseView
  /** CodeMirror editor (source pane). */
  source: SourceView
  /** The scrollable element of the WYSIWYG pane (`.editor-host`). */
  scroller: HTMLElement
}

type Side = 'left' | 'right'

const IGNORE_MS = 400

export interface SplitScrollSync {
  /** Stop listening and cancel any pending frame. */
  destroy(): void
  /**
   * Ignore source-side scroll events for a moment. The source pane rewrites
   * the whole document when the WYSIWYG content changes, and CodeMirror may
   * fire scroll events during that rewrite; they must not drag the WYSIWYG
   * pane back to the top.
   */
  suspend(): void
}

export function createSplitScrollSync({ prose, source, scroller }: SplitSyncOptions): SplitScrollSync {
  const sourceScroller = source.scrollDOM

  let proseDoc: typeof prose.state.doc | null = null
  let proseHeadings: number[] = []
  let sourceDoc: typeof source.state.doc | null = null
  let sourceHeadings: number[] = []

  let frame = 0
  let direction: Side = 'left'
  let resyncTimer: ReturnType<typeof setTimeout> | undefined
  const ignoreUntil: Record<Side, number> = { left: 0, right: 0 }

  function refreshProseHeadings(): void {
    const doc = prose.state.doc
    if (proseDoc === doc) return
    proseDoc = doc
    const next: number[] = []
    proseDoc.forEach((node, offset) => {
      if (node.type.name === 'heading') next.push(offset)
    })
    proseHeadings = next
  }

  function refreshSourceHeadings(): void {
    const doc = source.state.doc
    if (sourceDoc === doc) return
    sourceDoc = doc
    const next: number[] = []
    let fence: string | null = null
    for (let n = 1; n <= doc.lines; n += 1) {
      const text = doc.line(n).text
      const marker = /^\s*(`{3,}|~{3,})/.exec(text)
      if (marker) {
        const char = marker[1][0]
        if (fence === null) fence = char
        else if (fence === char) fence = null
        continue
      }
      if (fence === null && /^#{1,6}\s/.test(text)) next.push(doc.line(n).from)
    }
    sourceHeadings = next
  }

  /** Index of the last heading at or before `pos`, or -1. */
  function headingIndexAt(positions: number[], pos: number): number {
    let low = 0
    let high = positions.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (positions[mid] <= pos) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return found
  }

  /** Top of a top-level block in the WYSIWYG scroller's content coordinates. */
  function proseTop(pos: number): number | null {
    const node = prose.nodeDOM(pos)
    if (!(node instanceof HTMLElement)) return null
    const rect = node.getBoundingClientRect()
    const base = scroller.getBoundingClientRect()
    return rect.top - base.top + scroller.scrollTop
  }

  /** Top of a source position in the CodeMirror scroller's content coordinates. */
  function sourceTop(pos: number): number | null {
    const base = sourceScroller.getBoundingClientRect()
    const content = source.contentDOM.getBoundingClientRect()
    const contentTop = content.top - base.top + sourceScroller.scrollTop
    return contentTop + source.lineBlockAt(pos).top
  }

  function maxScroll(el: HTMLElement): number {
    return Math.max(0, el.scrollHeight - el.clientHeight)
  }

  function apply(side: Side, top: number): void {
    const el = side === 'left' ? scroller : sourceScroller
    const next = Math.max(0, Math.min(maxScroll(el), top))
    if (Math.abs(el.scrollTop - next) < 0.5) return
    ignoreUntil[side] = performance.now() + IGNORE_MS
    el.scrollTop = next
  }

  function syncRatio(side: Side): void {
    const from = side === 'left' ? scroller : sourceScroller
    const to = side === 'left' ? sourceScroller : scroller
    const fromMax = maxScroll(from)
    const toMax = maxScroll(to)
    if (fromMax < 1) return
    const applied = (from.scrollTop / fromMax) * toMax
    apply(side === 'left' ? 'right' : 'left', applied)
  }

  function sync(side: Side, pass = 0): void {
    refreshProseHeadings()
    refreshSourceHeadings()
    if (
      proseHeadings.length === 0 ||
      proseHeadings.length !== sourceHeadings.length
    ) {
      syncRatio(side)
      return
    }

    const from = side === 'left' ? scroller : sourceScroller
    const fromHeads = side === 'left' ? proseHeadings : sourceHeadings
    const target = side === 'left' ? 'right' : 'left'
    const targetEl = target === 'left' ? scroller : sourceScroller
    const targetHeads = target === 'left' ? proseHeadings : sourceHeadings
    const yFrom = (i: number): number | null =>
      side === 'left' ? proseTop(fromHeads[i]) : sourceTop(fromHeads[i])
    const yTarget = (i: number): number | null =>
      target === 'left' ? proseTop(targetHeads[i]) : sourceTop(targetHeads[i])

    const rect = from.getBoundingClientRect()
    let pos: number | undefined
    if (side === 'left') {
      pos = prose.posAtCoords({ left: rect.left + 24, top: rect.top + 8 })?.pos
    } else {
      pos = source.posAtCoords({ x: rect.left + 24, y: rect.top + 8 }) ?? undefined
    }
    const index = headingIndexAt(fromHeads, pos ?? 0)

    const fromTop = from.scrollTop
    const fromMax = maxScroll(from)
    const targetMax = maxScroll(targetEl)

    const headA = index >= 0 ? yFrom(index) : 0
    const headB =
      index + 1 < fromHeads.length ? yFrom(index + 1) : fromMax
    const targetA = index >= 0 ? yTarget(index) : 0
    const targetB =
      index + 1 < targetHeads.length ? yTarget(index + 1) : targetMax

    if (headA === null || headB === null || targetA === null || targetB === null) {
      syncRatio(side)
      return
    }
    if (headB <= headA) {
      apply(target, targetA)
      return
    }

    const fraction = Math.max(0, Math.min(1, (fromTop - headA) / (headB - headA)))
    const applied = targetA + fraction * (targetB - targetA)
    const jump = Math.abs(applied - targetEl.scrollTop)
    apply(target, applied)

    // CodeMirror estimates the height of lines it has not measured yet, so a
    // large jump lands at an estimated position. After it measures the new
    // viewport the anchor moves; correct once to land on the real position.
    if (pass === 0 && target === 'right' && jump > 400) {
      const expectedFrom = scroller.scrollTop
      requestAnimationFrame(() => {
        if (Math.abs(scroller.scrollTop - expectedFrom) < 1) sync('left', 1)
      })
    }
  }

  function schedule(side: Side): void {
    direction = side
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      sync(direction)
    })
  }

  const onLeftScroll = (): void => {
    if (performance.now() < ignoreUntil.left) return
    schedule('left')
  }
  const onRightScroll = (): void => {
    if (performance.now() < ignoreUntil.right) return
    schedule('right')
  }

  scroller.addEventListener('scroll', onLeftScroll, { passive: true })
  sourceScroller.addEventListener('scroll', onRightScroll, { passive: true })

  // Align once after the split layout has been measured.
  const initial = requestAnimationFrame(() => {
    requestAnimationFrame(() => schedule('left'))
  })

  return {
    destroy() {
      cancelAnimationFrame(initial)
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(resyncTimer)
      scroller.removeEventListener('scroll', onLeftScroll)
      sourceScroller.removeEventListener('scroll', onRightScroll)
    },
    suspend() {
      ignoreUntil.right = performance.now() + IGNORE_MS * 2
      ignoreUntil.left = performance.now() + IGNORE_MS
      // The source pane is rewritten as a whole; once CodeMirror has settled,
      // realign it to the WYSIWYG pane (the editor the user is typing in).
      clearTimeout(resyncTimer)
      resyncTimer = setTimeout(() => schedule('left'), 120)
    }
  }
}
