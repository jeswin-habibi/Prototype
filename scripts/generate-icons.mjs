// Generates the Double 5 Analytics PWA icons (teal gradient tile + 3-D package + sparkle).
// Pure Node, no native deps — renders per-pixel with 3× supersampling for smooth edges.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public')
mkdirSync(OUT, { recursive: true })

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(CRC(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

// ── icon artwork ──────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]

// convex-polygon hit test (consistent winding)
function inPoly(px, py, pts) {
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]
    const [bx, by] = pts[(i + 1) % pts.length]
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1
      if (sign === 0) sign = s
      else if (s !== sign) return false
    }
  }
  return true
}

const BG_TL = [45, 212, 191] // brand-light
const BG_BR = [12, 74, 69] // deep teal
const FACE_TOP = [240, 253, 250]
const FACE_LEFT = [110, 231, 211]
const FACE_RIGHT = [38, 166, 154]
const SEAM = [13, 95, 88]
const WHITE = [255, 255, 255]

function colorAt(fx, fy, size) {
  // diagonal teal gradient background
  const t = Math.min(1, Math.max(0, (fx * 0.7 + fy * 1.3) / (2 * size)))
  let col = mix(BG_TL, BG_BR, t)

  const cx = size * 0.5
  const cy = size * 0.55
  const R = size * 0.26
  const w = R * 0.866

  const T = [cx, cy - R]
  const Rg = [cx + w, cy - R / 2]
  const B = [cx, cy]
  const L = [cx - w, cy - R / 2]
  const Bb = [cx, cy + R]
  const Ll = [cx - w, cy + R / 2]
  const Rr = [cx + w, cy + R / 2]

  if (inPoly(fx, fy, [T, Rg, B, L])) col = FACE_TOP
  else if (inPoly(fx, fy, [L, B, Bb, Ll])) col = FACE_LEFT
  else if (inPoly(fx, fy, [Rg, Rr, Bb, B])) col = FACE_RIGHT

  // central seam line down the front edge (B → Bb) for a crisp box look
  const seamW = size * 0.012
  if (fy > cy && fy < Bb[1] && Math.abs(fx - cx) < seamW) col = SEAM

  // "smart" sparkle, top-right — tapered 4-point star
  const sx = size * 0.73
  const sy = size * 0.26
  const dx = fx - sx
  const dy = fy - sy
  const armL = size * 0.115
  const armW = size * 0.055
  const vert = Math.abs(dy) < armL && Math.abs(dx) < armW * (1 - Math.abs(dy) / armL)
  const horz = Math.abs(dx) < armL && Math.abs(dy) < armW * (1 - Math.abs(dx) / armL)
  if (vert || horz) col = WHITE

  return col
}

function png(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB

  const SS = 3 // supersample factor
  const n = SS * SS
  const rowLen = size * 3
  const raw = Buffer.alloc((rowLen + 1) * size)
  for (let y = 0; y < size; y++) {
    const off = y * (rowLen + 1)
    raw[off] = 0
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS, size)
          r += c[0]; g += c[1]; b += c[2]
        }
      }
      const p = off + 1 + x * 3
      raw[p] = Math.round(r / n)
      raw[p + 1] = Math.round(g / n)
      raw[p + 2] = Math.round(b / n)
    }
  }
  const idat = deflateSync(raw)
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size))
  console.log(`wrote public/icon-${size}.png`)
}
