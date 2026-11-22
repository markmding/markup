/** Menu-driven formatting actions handled by the active WYSIWYG editor. */

export type EditorAction =
  | 'strong'
  | 'emphasis'
  | 'strikethrough'
  | 'inlineCode'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'blockquote'
  | 'bulletList'
  | 'orderedList'
  | 'codeBlock'
  | 'table'

type Handler = (action: EditorAction) => boolean

let handler: Handler | null = null

/** Called by EditorPane when a Milkdown instance is ready. */
export function setEditorActionHandler(next: Handler | null): void {
  handler = next
}

/** Returns false when no Markdown editor is mounted. */
export function runEditorAction(action: EditorAction): boolean {
  return handler ? handler(action) : false
}
