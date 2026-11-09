/**
 * In-browser resize + encode for study images.
 *
 * Widths 480 / 960 / 1600, never upscaled (an image narrower than 480 is
 * kept at its own width). Encodes WebP, plus AVIF when this browser's
 * canvas can encode it. If the browser cannot encode WebP (older Safari
 * silently returns PNG), it falls back to JPEG and says so.
 * The full-size original is never uploaded.
 */
export const TARGET_WIDTHS = [480, 960, 1600]
const QUALITY = { webp: 0.82, avif: 0.6, jpeg: 0.85 }
const MIME = { webp: 'image/webp', avif: 'image/avif', jpeg: 'image/jpeg' }
export const EXT = { webp: 'webp', avif: 'avif', jpeg: 'jpg' }

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob((b) => res(b), type, q))

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // fall through to <img> decode
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function plannedWidths(naturalWidth) {
  const ws = TARGET_WIDTHS.filter((w) => w <= naturalWidth)
  return ws.length ? ws : [naturalWidth]
}

/**
 * → { width, height, variants: [{ width, height, format, blob }], notes: [] }
 * width/height are the largest variant's (the original is not stored).
 */
export async function encodeVariants(file) {
  let src
  try {
    src = await decode(file)
  } catch {
    throw new Error("This browser can't read that image. Use a JPEG, PNG or WebP file.")
  }
  const W = src.width || src.naturalWidth
  const H = src.height || src.naturalHeight
  if (!W || !H) throw new Error("Couldn't read the image size.")
  const notes = []
  const variants = []
  let base = 'webp'
  let avif = true
  for (const w of plannedWidths(W)) {
    const h = Math.max(1, Math.round((H * w) / W))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, 0, 0, w, h)
    let b = await toBlob(canvas, MIME[base], QUALITY[base])
    if (base === 'webp' && b?.type !== MIME.webp) {
      base = 'jpeg'
      notes.push("This browser can't encode WebP, so JPEG was used instead.")
      b = await toBlob(canvas, MIME.jpeg, QUALITY.jpeg)
    }
    if (!b) throw new Error('Encoding the image failed.')
    variants.push({ width: w, height: h, format: base, blob: b })
    if (avif) {
      const a = await toBlob(canvas, MIME.avif, QUALITY.avif)
      if (a?.type === MIME.avif && a.size < b.size * 1.2) variants.push({ width: w, height: h, format: 'avif', blob: a })
      else if (a?.type !== MIME.avif) avif = false
    }
  }
  src.close?.()
  if (!avif) notes.push("This browser can't encode AVIF, so no AVIF versions were made.")
  const largest = variants.reduce((m, v) => (v.width > m.width ? v : m), variants[0])
  return { width: largest.width, height: largest.height, variants, notes }
}
