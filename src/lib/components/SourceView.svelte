<script lang="ts">
  import { basicSetup } from 'codemirror'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { LanguageDescription } from '@codemirror/language'
  import { Compartment, EditorState } from '@codemirror/state'
  import { EditorView } from '@codemirror/view'
  import { untrack } from 'svelte'

  let {
    value,
    filename = '',
    onchange = () => {},
    onblur,
    readonly = false,
    onready,
    onbeforeupdate
  }: {
    value: string
    /** Used to pick syntax highlighting (css, js, json, …). */
    filename?: string
    onchange?: (next: string) => void
    onblur?: () => void
    readonly?: boolean
    /** Exposes the CodeMirror instance for split-view scroll sync. */
    onready?: (view: EditorView | null) => void
    /** Called right before the mirror content is rewritten. */
    onbeforeupdate?: () => void
  } = $props()

  let host = $state<HTMLDivElement>()
  let view = $state<EditorView | null>(null)

  $effect(() => {
    if (!host) return
    const initial = untrack(() => value)
    const markdownFile = !filename || /\.(md|markdown)$/i.test(filename)
    const languageSlot = new Compartment()
    const instance = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          languageSlot.of(
            markdownFile
              ? markdown({ base: markdownLanguage, codeLanguages: languages })
              : []
          ),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readonly),
          EditorView.editable.of(!readonly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !readonly) onchange(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onblur?.()
            }
          })
        ]
      })
    })
    view = instance
    onready?.(instance)

    let cancelled = false
    if (!markdownFile && filename) {
      const description = LanguageDescription.matchFilename(languages, filename)
      if (description) {
        void description
          .load()
          .then((language) => {
            if (!cancelled) {
              instance.dispatch({ effects: languageSlot.reconfigure(language) })
            }
          })
          .catch(() => {
            // Unknown/failed language: keep plain text.
          })
      }
    }

    return () => {
      cancelled = true
      instance.destroy()
      if (view === instance) view = null
      onready?.(null)
    }
  })

  // Keep a read-only split preview in sync with the WYSIWYG editor. Heavy
  // documents get a debounce and a minimal diff instead of a full replace.
  $effect(() => {
    const next = value
    const instance = view
    if (!instance) return
    const timer = setTimeout(() => {
      const current = instance.state.doc.toString()
      if (current === next) return

      let start = 0
      const minLength = Math.min(current.length, next.length)
      while (start < minLength && current[start] === next[start]) start += 1

      let oldEnd = current.length
      let newEnd = next.length
      while (
        oldEnd > start &&
        newEnd > start &&
        current[oldEnd - 1] === next[newEnd - 1]
      ) {
        oldEnd -= 1
        newEnd -= 1
      }

      onbeforeupdate?.()
      const scroll = instance.scrollDOM.scrollTop
      instance.dispatch({
        changes: { from: start, to: oldEnd, insert: next.slice(start, newEnd) }
      })
      instance.scrollDOM.scrollTop = scroll
    }, 250)
    return () => clearTimeout(timer)
  })
</script>

<div class="source-host" bind:this={host}></div>
