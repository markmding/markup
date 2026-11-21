/** Browser-only fallbacks used by the demo vault (no Tauri available). */

export function downloadText(
  filename: string,
  content: string,
  mime = 'text/html;charset=utf-8'
): void {
  downloadBlob(filename, new Blob([content], { type: mime }))
}

export function downloadBase64(filename: string, base64: string, mime: string): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  downloadBlob(filename, new Blob([bytes], { type: mime }))
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
