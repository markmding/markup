let sequence = 0

/**
 * Mermaid's renderer is not safe for concurrent calls with the same global
 * config, and CodeMirror previews can fire several updates quickly. Serialize
 * renders and cache by (theme, source) so repeated previews reuse the SVG.
 */
const cache = new Map<string, Promise<string>>()
let queue: Promise<unknown> = Promise.resolve()

async function renderNow(source: string, dark: boolean): Promise<string> {
  const mermaid = (await import('mermaid')).default
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default'
  })
  sequence += 1
  const id = `markup-mermaid-${Date.now()}-${sequence}`
  const { svg } = await mermaid.render(id, source)
  return svg
}

export function renderMermaidSvg(source: string, dark = false): Promise<string> {
  const key = `${dark ? 'dark' : 'light'}\n${source}`
  const cached = cache.get(key)
  if (cached) return cached

  const job = queue.catch(() => undefined).then(() => renderNow(source, dark))
  cache.set(key, job)
  queue = job.catch(() => undefined)

  job.catch(() => {
    if (cache.get(key) === job) cache.delete(key)
  })

  if (cache.size > 100) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  return job
}
