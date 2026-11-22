import type { Ctx } from '@milkdown/kit/ctx'
import { imageSchema } from '@milkdown/kit/preset/commonmark'
import type { UploadOptions } from '@milkdown/plugin-upload'
import { readAttachment, saveAttachment } from '../api/vault'
import { mimeOf } from '../mime'

/** data URL cache: vault root + relative path -> data URL */
const displayCache = new Map<string, string>()

export function clearAttachmentCache(): void {
  displayCache.clear()
}

export function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
    }
    return btoa(binary)
  })
}

function attachmentName(file: File): string {
  if (file.name && /\.[a-z0-9]+$/i.test(file.name)) return file.name
  const ext = file.type.split('/')[1] || 'png'
  return `pasted-${Date.now()}.${ext}`
}

/** Saves one pasted/dropped file and returns its vault-relative path. */
export async function persistAttachment(root: string, file: File): Promise<string> {
  const base64 = await fileToBase64(file)
  const saved = await saveAttachment(root, attachmentName(file), base64)
  return saved.path
}

/**
 * Upload plugin handler: converts pasted/dropped image files into image nodes.
 * The stored `src` is a vault-relative path; proxyDomURL renders it as a data URL.
 */
export function createUploader(getRoot: () => string | null): UploadOptions['uploader'] {
  return async (files, _schema, ctx: Ctx) => {
    const root = getRoot()
    if (!root) throw new Error('请先打开一个 Vault 再插入图片')
    const nodes = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const path = await persistAttachment(root, file)
      nodes.push(imageSchema.type(ctx).create({ src: path, alt: file.name }))
    }
    return nodes
  }
}

/**
 * Crepe ImageBlock proxy: turns `attachments/...` into a data URL so the
 * WebView can display it without granting an asset-protocol scope.
 */
export async function resolveAttachmentUrl(
  root: string | null,
  url: string
): Promise<string> {
  if (!root || !url) return url
  if (/^(data:|blob:|https?:|file:|asset:|#)/i.test(url)) return url
  const rel = url.replace(/^\.\//, '')
  if (!rel || rel.startsWith('/') || /^[a-z]+:/i.test(rel)) return url

  const key = `${root}\n${rel}`
  const cached = displayCache.get(key)
  if (cached) return cached

  const data = await readAttachment(root, rel)
  if (!data) return url
  const dataUrl = `data:${mimeOf(rel)};base64,${data}`
  displayCache.set(key, dataUrl)
  return dataUrl
}
