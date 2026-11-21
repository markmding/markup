<script lang="ts">
  import { basicSetup } from 'codemirror'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { languages } from '@codemirror/language-data'
  import { EditorState } from '@codemirror/state'
  import { EditorView } from '@codemirror/view'
  import { untrack } from 'svelte'

  let {
    value,
    onchange,
    onblur
  }: {
    value: string
    onchange: (next: string) => void
    onblur?: () => void
  } = $props()

  let host = $state<HTMLDivElement>()

  $effect(() => {
    if (!host) return
    const initial = untrack(() => value)
    const instance = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onchange(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: () => {
              onblur?.()
            }
          })
        ]
      })
    })
    return () => instance.destroy()
  })
</script>

<div class="source-host" bind:this={host}></div>
