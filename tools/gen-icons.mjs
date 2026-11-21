// Generates placeholder app icons without any image dependency.
// Output: src-tauri/icons/*.png + icon.ico (PNG-compressed ICO entries).
// Replace with real brand assets later: `npx tauri icon path/to/logo.png`.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons')
mkdirSync(outDir, { recursive: true })

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function mix(a, b, t) {
  return a + (b - a) * t
}

// Draws an "M" mark on a rounded gradient tile.
function render(size) {
  const px = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const stroke = size * 0.072
  const segments = [
    [0.3, 0.74, 0.3, 0.3],
    [0.3, 0.3, 0.5, 0.56],
    [0.5, 0.56, 0.7, 0.3],
    [0.7, 0.3, 0.7, 0.74]
  ].map((s) => s.map((v) => v * size))

  const distToSegment = (x, y, [x1, y1, x2, y2]) => {
    const dx = x2 - x1
    const dy = y2 - y1
    const len2 = dx * dx + dy * dy || 1
    let t = ((x - x1) * dx + (y - y1) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
  }

  const insideRounded = (x, y) => {
    const cx = Math.max(radius, Math.min(size - radius, x))
    const cy = Math.max(radius, Math.min(size - radius, y))
    return Math.hypot(x - cx, y - cy) <= radius
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const t = (x / size) * 0.45 + (y / size) * 0.55
      const edge = insideRounded(x + 0.5, y + 0.5)
      if (!edge) {
        px[i + 3] = 0
        continue
      }
      px[i] = Math.round(mix(0x63, 0x3f, t))
      px[i + 1] = Math.round(mix(0x66, 0x33, t))
      px[i + 2] = Math.round(mix(0xf1, 0xb8, t))
      px[i + 3] = 255
      const onMark = segments.some((s) => distToSegment(x + 0.5, y + 0.5, s) <= stroke / 2)
      if (onMark) {
        px[i] = 255
        px[i + 1] = 255
        px[i + 2] = 255
      }
    }
  }
  return encodePng(size, px)
}

function encodeIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + 16 * count
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bpp
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

function encodeIcns(entries) {
  const chunks = entries.map(({ type, data }) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

const rendered = new Map()
const sizeOf = (size) => {
  if (!rendered.has(size)) rendered.set(size, render(size))
  return rendered.get(size)
}

for (const size of [32, 128, 256, 512]) {
  writeFileSync(join(outDir, `${size}x${size}.png`), sizeOf(size))
}
writeFileSync(join(outDir, '128x128@2x.png'), sizeOf(256))
writeFileSync(join(outDir, 'icon.png'), sizeOf(512))

const icoSizes = [16, 32, 48, 64, 128, 256].map((size) => ({ size, data: sizeOf(size) }))
writeFileSync(join(outDir, 'icon.ico'), encodeIco(icoSizes))

const icnsEntries = [
  { type: 'ic11', data: sizeOf(32) },
  { type: 'ic07', data: sizeOf(128) },
  { type: 'ic08', data: sizeOf(256) },
  { type: 'ic09', data: sizeOf(512) },
  { type: 'ic10', data: sizeOf(1024) }
]
writeFileSync(join(outDir, 'icon.icns'), encodeIcns(icnsEntries))
console.log(`icons written to ${outDir}`)
