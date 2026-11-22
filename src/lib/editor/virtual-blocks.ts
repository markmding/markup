import { DOMSerializer, type Node as ProseNode } from '@milkdown/kit/prose/model'
import type {
  Decoration,
  EditorView,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from '@milkdown/kit/prose/view'

/**
 * F2.7 stage 2: viewport virtualization for top-level blocks.
 *
 * A generic NodeView mimics ProseMirror's default rendering (via `toDOM`),
 * then detaches its rendered children into a DocumentFragment once the block
 * is far outside the viewport. The shell keeps a measured min-height so the
 * scroll position stays stable; scrolling back re-attaches the same DOM nodes.
 *
 * We intentionally keep code blocks / tables / media on their dedicated
 * Crepe NodeViews, and only virtualize plain top-level blocks. Detached
 * content is not available to find-in-page until it is re-attached.
 */

const registry = new WeakMap<HTMLElement, VirtualBlockView>()
const liveViews = new Set<VirtualBlockView>()
const pendingObserve = new Set<VirtualBlockView>()
const observers = new Map<Element | null, IntersectionObserver>()
const scrollRootCache = new WeakMap<Element, Element | null>()
let observeScheduled = false

/**
 * The editor scrolls inside its own pane, and IntersectionObserver clips the
 * intersection rect at that pane before applying `rootMargin` to the viewport.
 * Using the pane as root lets the margin prefetch blocks above/below instead
 * of detaching everything outside the visible 800px.
 */
function scrollRoot(el: Element): Element | null {
  const cached = scrollRootCache.get(el)
  if (cached !== undefined) return cached
  let found: Element | null = null
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      found = node
      break
    }
  }
  scrollRootCache.set(el, found)
  return found
}

interface ObserverControl {
  stopped<T>(callback: () => T): T
}

/**
 * Run DOM surgery with ProseMirror's mutation observer disconnected.
 *
 * `ignoreMutation` covers mutations the observer reports, but a detached
 * content hole that ProseMirror happens to inspect while reading the DOM can
 * still be turned into a document change (deleting the block's text). Stopping
 * the observer around our own DOM moves removes that race entirely.
 */
function withoutMutations<T>(view: EditorView, callback: () => T): T {
  const control = (view as unknown as { domObserver?: ObserverControl }).domObserver
  return control?.stopped ? control.stopped(callback) : callback()
}

function observerFor(root: Element | null): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null
  let instance = observers.get(root)
  if (!instance) {
    instance = new IntersectionObserver(
      (entries) => {
        const groups = new Map<EditorView, Array<[VirtualBlockView, boolean, number]>>()
        for (const entry of entries) {
          const view = registry.get(entry.target as HTMLElement)
          if (!view) continue
          const list = groups.get(view.editorView) ?? []
          list.push([view, entry.isIntersecting, entry.boundingClientRect.height])
          groups.set(view.editorView, list)
        }
        for (const [editorView, list] of groups) {
          withoutMutations(editorView, () => {
            for (const [view, visible, height] of list) view.updateVisibility(visible, height)
          })
        }
      },
      { root, rootMargin: '2500px 0px' }
    )
    observers.set(root, instance)
  }
  return instance
}

/**
 * NodeViews are constructed before ProseMirror inserts their DOM, and an
 * IntersectionObserver only reports targets whose ratio *changes*. Observing a
 * detached element yields a one-off "not intersecting" entry, so blocks that
 * stay offscreen would never be reported. Wait one frame — by then the whole
 * document render has been appended — and observe every queued view at once.
 */
function scheduleObserve(view: VirtualBlockView): void {
  pendingObserve.add(view)
  if (observeScheduled) return
  observeScheduled = true
  const flush = () => {
    observeScheduled = false
    const batch = [...pendingObserve]
    pendingObserve.clear()
    for (const item of batch) item.startObserving()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush)
  else setTimeout(flush, 0)
}

class VirtualBlockView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement

  private node: ProseNode
  private view: EditorView
  private getPos: () => number | undefined
  private virtual: boolean
  private detached = false
  private fragment: DocumentFragment | null = null
  /** Nodes we just put back into contentDOM, so their insertion is ignored. */
  private restoredNodes: Set<Node> | null = null
  private observeAttempts = 0
  private observerRoot: Element | null = null
  private observed = false

  constructor(
    node: ProseNode,
    view: EditorView,
    getPos: () => number | undefined
  ) {
    this.node = node
    this.view = view
    this.getPos = getPos

    const doc = view.dom.ownerDocument ?? document
    const spec = node.type.spec.toDOM?.(node) ?? ['div', 0]
    const rendered = DOMSerializer.renderSpec(doc, spec)
    this.dom = rendered.dom as HTMLElement
    this.dom.classList.add('mk-virtual-block')
    this.contentDOM = (rendered.contentDOM as HTMLElement | null) ?? undefined

    let topLevel = false
    const pos = getPos()
    if (typeof pos === 'number') {
      try {
        topLevel = view.state.doc.resolve(pos).depth === 0
      } catch {
        topLevel = false
      }
    }
    this.virtual = topLevel && Boolean(this.contentDOM) && !node.isLeaf
    if (this.virtual) {
      registry.set(this.dom, this)
      liveViews.add(this)
      scheduleObserve(this)
    }
  }

  /** Retried on upcoming frames until the editor has mounted into the page. */
  startObserving(): void {
    if (!this.virtual || this.observed) return
    if (!this.dom.isConnected) {
      if (this.observeAttempts++ < 120) scheduleObserve(this)
      return
    }
    this.observerRoot = scrollRoot(this.view.dom)
    observerFor(this.observerRoot)?.observe(this.dom)
    this.observed = true
  }

  update(node: ProseNode, _decorations: readonly Decoration[]): boolean {
    this.node = node
    // ProseMirror re-syncs the children of a content-bearing node view on
    // update. If the block is detached, restore its DOM first so its
    // reconciliation works against the live content node instead of the
    // fragment we parked the children in.
    if (this.detached) this.attach()
    return true
  }

  destroy(): void {
    registry.delete(this.dom)
    liveViews.delete(this)
    pendingObserve.delete(this)
    if (this.observed) observers.get(this.observerRoot)?.unobserve(this.dom)
    this.observed = false
    this.fragment = null
    this.restoredNodes = null
    this.detached = false
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (mutation.type === 'selection') return false

    // Toggling `mk-block-detached` / min-height must not look like a document
    // edit to ProseMirror, otherwise it recreates the node view and the block
    // detaches again — an endless detach/recreate loop. These are the only
    // attributes we ever change on the shell itself.
    if (mutation.type === 'attributes') {
      return (
        mutation.target === this.dom &&
        (mutation.attributeName === 'class' || mutation.attributeName === 'style')
      )
    }

    if (mutation.type !== 'childList' || mutation.target !== this.contentDOM) return false

    // While detached, nothing but our own removal can touch this content hole.
    if (this.detached) return true

    // The insertion that restores the parked children is ours too. Anything
    // else (including user input) must still reach ProseMirror.
    const restored = this.restoredNodes
    if (!restored || mutation.addedNodes.length === 0) return false
    for (const node of mutation.addedNodes) {
      if (!restored.has(node)) return false
    }
    return true
  }

  updateVisibility(visible: boolean, height: number): void {
    if (!this.virtual || !this.contentDOM) return

    // Virtualization is part of the "分块渲染" setting; when it is off the
    // editor must behave exactly like the plain ProseMirror DOM.
    if (visible || !this.dom.closest('.editor-host.chunked')) {
      this.attach()
      return
    }

    if (this.detached) return
    if (this.selectionInside()) return

    const measured = height || this.dom.offsetHeight
    if (measured < 1) return

    const target = this.contentDOM
    this.restoredNodes = null
    withoutMutations(this.view, () => {
      this.fragment = target.ownerDocument.createDocumentFragment()
      while (target.firstChild) {
        this.fragment.appendChild(target.firstChild)
      }
      this.dom.style.minHeight = `${Math.round(measured)}px`
      this.dom.classList.add('mk-block-detached')
    })
    this.detached = true
  }

  get editorView(): EditorView {
    return this.view
  }

  /** Restores the block even if it is far outside the viewport. */
  restore(): void {
    withoutMutations(this.view, () => this.attach())
  }

  /** Re-runs the intersection check (after the setting is switched back on). */
  reobserve(): void {
    if (!this.observed) {
      this.startObserving()
      return
    }
    const instance = observers.get(this.observerRoot)
    instance?.unobserve(this.dom)
    instance?.observe(this.dom)
  }

  private attach(): void {
    if (!this.detached || !this.contentDOM || !this.fragment) return
    const content = this.contentDOM
    const fragment = this.fragment
    const nodes = Array.from(fragment.childNodes)
    withoutMutations(this.view, () => {
      content.appendChild(fragment)
      this.dom.style.minHeight = ''
      this.dom.classList.remove('mk-block-detached')
    })
    this.restoredNodes = new Set(nodes)
    this.fragment = null
    this.detached = false
  }

  private selectionInside(): boolean {
    const pos = this.getPos()
    if (typeof pos !== 'number') return true
    const { from, to } = this.view.state.selection
    return from < pos + this.node.nodeSize && to > pos
  }
}

function create(node: ProseNode, view: EditorView, getPos: () => number | undefined): NodeView {
  return new VirtualBlockView(node, view, getPos)
}

/** Re-attaches every detached block, e.g. when 分块渲染 is turned off. */
export function restoreVirtualBlocks(): void {
  const groups = new Map<EditorView, VirtualBlockView[]>()
  for (const view of liveViews) {
    const list = groups.get(view.editorView) ?? []
    list.push(view)
    groups.set(view.editorView, list)
  }
  for (const [editorView, list] of groups) {
    withoutMutations(editorView, () => {
      for (const view of list) view.restore()
    })
  }
}

/** Re-evaluates every block, e.g. when 分块渲染 is turned back on. */
export function refreshVirtualBlocks(): void {
  for (const view of liveViews) view.reobserve()
}

export const virtualBlockNodeViews: Record<string, NodeViewConstructor> = {
  paragraph: create,
  heading: create,
  blockquote: create,
  bullet_list: create,
  ordered_list: create
}
