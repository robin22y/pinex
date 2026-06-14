import { useEffect, useRef, useState } from 'react'

// ── Theme tokens — hardcoded dark, never CSS variables ────────────────────
const CARD_BG      = '#F4ECD8'
const TEXT_PRIMARY = '#3A2A1F'
const TEXT_MUTED   = '#6B5A4A'
const TEXT_FAINT   = '#9D8B7A'
const DIVIDER      = '#D4C5A8'
const ACCENT_PINEX = '#1E1E1E'
const COLOR_GREEN  = '#15803D'
const COLOR_AMBER  = '#A16207'
const COLOR_RED    = '#991B1B'
// Muted charcoal-brown for neutral data (Basing / Topping etc.) so the
// bright COLOR_AMBER isn't competing with the truly directional signals.
const COLOR_NEUTRAL = '#4A3825'
// Sophisticated crimson for weakest sector pcts — softer than COLOR_RED,
// since a low % is "weak signal" not "negative return".
const COLOR_CRIMSON = '#8B3A3A'
const MONO         = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace"

const PULSE_COLOUR = {
  'Strong Breadth':    COLOR_GREEN,
  'Improving Breadth': COLOR_GREEN,
  'Mixed Breadth':     COLOR_AMBER,
  'Weakening Breadth': COLOR_AMBER,
  'Narrow Breadth':    COLOR_RED,
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch { return iso }
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toLocaleString('en-IN')
}

function fmtPct(n, digits = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return Number(n).toFixed(digits) + '%'
}

// ── Logo loader ────────────────────────────────────────────────────────────
const loadLogo = () => new Promise((resolve) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.crossOrigin = 'anonymous'
  img.src = '/favicon.svg'
})

// ── Canvas draw function ───────────────────────────────────────────────────
async function drawCard(internals, sectors, marketPulse) {
  // Portrait — 1080×1500 (extra height to accommodate full breadth data)
  const W = 1080
  const H = 1500
  const S = 2

  const canvas = document.createElement('canvas')
  canvas.width  = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d')
  const p = (n) => Math.round(n * S)

  await Promise.all([
    `800 ${p(52)}px ${MONO}`,
    `700 ${p(36)}px ${MONO}`,
    `700 ${p(32)}px ${MONO}`,
    `600 ${p(18)}px ${MONO}`,
    `400 ${p(22)}px ${MONO}`,
    `700 ${p(22)}px ${MONO}`,
    `400 ${p(16)}px ${MONO}`,
  ].map(f => document.fonts.load(f).catch(() => {})))
  await document.fonts.ready

  const logo = await loadLogo()

  // Background
  ctx.fillStyle = CARD_BG
  ctx.fillRect(0, 0, W * S, H * S)

  // Top accent bar
  ctx.fillStyle = ACCENT_PINEX
  ctx.fillRect(0, 0, W * S, p(8))

  // Subtle dot grid
  ctx.fillStyle = '#E1D2B0'
  for (let x = 0; x < W * S; x += p(40)) {
    for (let y = 0; y < H * S; y += p(40)) {
      ctx.fillRect(x, y, S, S)
    }
  }

  const PX = p(56)              // horizontal padding
  const RIGHT_PAD = p(8)        // extra breathing room on right-aligned values
  const CW = W * S - PX * 2     // content width
  let Y = p(32)

  // Soft, translucent divider — much subtler than the solid tan line.
  const softDivider = (atY) => {
    ctx.fillStyle = 'rgba(58, 42, 31, 0.14)'
    ctx.fillRect(PX, atY, CW, S)
  }

  // A/D ratio — recompute from raw advances/declines (stored ad_ratio
  // is a clamped int on some historical rows and would mislead at "1.00").
  const advN = Number(internals?.advances)
  const decN = Number(internals?.declines)
  const adRatio = (Number.isFinite(advN) && Number.isFinite(decN) && decN > 0)
    ? advN / decN
    : Number(internals?.ad_ratio ?? NaN)
  const adRatioStr = Number.isFinite(adRatio) ? adRatio.toFixed(2) : '—'

  // ── HEADER ────────────────────────────────────────────────────────────
  if (logo) {
    ctx.drawImage(logo, PX, Y, p(44), p(42))
  }
  ctx.font = `700 ${p(36)}px ${MONO}`
  ctx.fillStyle = ACCENT_PINEX
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText('pinex.in', PX + p(logo ? 56 : 0), Y + p(4))

  ctx.font = `400 ${p(16)}px ${MONO}`
  ctx.fillStyle = TEXT_MUTED
  const ds = fmtDate(internals?.date)
  ctx.textAlign = 'right'
  ctx.fillText(ds, W * S - PX - RIGHT_PAD, Y + p(14))
  ctx.textAlign = 'left'
  Y += p(70)

  softDivider(Y)
  Y += p(28)

  // ── BREADTH READING ───────────────────────────────────────────────────
  ctx.font = `600 ${p(13)}px ${MONO}`
  ctx.fillStyle = TEXT_MUTED
  ctx.textBaseline = 'top'
  ctx.fillText('BREADTH READING', PX, Y)
  Y += p(20)

  ctx.font = `800 ${p(52)}px ${MONO}`
  ctx.fillStyle = PULSE_COLOUR[marketPulse] || COLOR_AMBER
  ctx.fillText(marketPulse || 'Mixed Breadth', PX, Y)
  Y += p(72)

  softDivider(Y)
  Y += p(24)

  // ── BIG THREE — 3-column headline metrics ─────────────────────────────
  // BREADTH 47.4% | ADVANCES 1,833 | DECLINES 273
  const BIG_GAP = p(20)
  const big_col_w = Math.round((CW - BIG_GAP * 2) / 3)
  const bigCols = [
    { label: 'BREADTH',  value: fmtPct(internals?.above_ma30w_pct), color: TEXT_PRIMARY },
    { label: 'ADVANCES', value: fmtInt(internals?.advances),         color: COLOR_GREEN  },
    { label: 'DECLINES', value: fmtInt(internals?.declines),         color: COLOR_RED    },
  ]
  bigCols.forEach((c, i) => {
    const cx = PX + (big_col_w + BIG_GAP) * i + big_col_w / 2

    ctx.font = `600 ${p(13)}px ${MONO}`
    ctx.fillStyle = TEXT_MUTED
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(c.label, cx, Y)

    ctx.font = `800 ${p(44)}px ${MONO}`
    ctx.fillStyle = c.color
    ctx.fillText(c.value, cx, Y + p(24))
  })
  ctx.textAlign = 'left'
  Y += p(94)

  softDivider(Y)
  Y += p(20)

  // ── SECONDARY METRICS — single inline row ─────────────────────────────
  // "A/D Ratio 6.71   ·   VIX 14.7   ·   52W H/L 0 / 0"
  const sec = [
    { label: 'A/D RATIO', value: adRatioStr },
    { label: 'VIX',       value: Number(internals?.india_vix ?? NaN).toFixed(1) },
    { label: '52W H/L',   value: `${fmtInt(internals?.new_52w_highs)} / ${fmtInt(internals?.new_52w_lows)}` },
  ]
  // Build segment widths then center the whole row.
  ctx.font = `400 ${p(18)}px ${MONO}`
  const sepW = ctx.measureText('  ·  ').width
  const segW = sec.map(s => {
    ctx.font = `600 ${p(15)}px ${MONO}`
    const lw = ctx.measureText(s.label).width
    ctx.font = `700 ${p(20)}px ${MONO}`
    const vw = ctx.measureText(s.value).width
    return { lw, vw, total: lw + p(10) + vw }
  })
  const rowW = segW.reduce((a, b) => a + b.total, 0) + sepW * (sec.length - 1)
  let cursor = Math.round(W * S / 2 - rowW / 2)
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const midY = Y + p(20)
  sec.forEach((s, i) => {
    ctx.font = `600 ${p(15)}px ${MONO}`
    ctx.fillStyle = TEXT_MUTED
    ctx.fillText(s.label, cursor, midY)
    cursor += segW[i].lw + p(10)

    ctx.font = `700 ${p(20)}px ${MONO}`
    ctx.fillStyle = TEXT_PRIMARY
    ctx.fillText(s.value, cursor, midY)
    cursor += segW[i].vw

    if (i < sec.length - 1) {
      ctx.font = `400 ${p(18)}px ${MONO}`
      ctx.fillStyle = TEXT_FAINT
      ctx.fillText('  ·  ', cursor, midY)
      cursor += sepW
    }
  })
  Y += p(52)

  softDivider(Y)
  Y += p(24)

  // ── INTERNAL MARKET DYNAMICS — 4-column sub-grid ──────────────────────
  // Advancing | Basing | Topping | Declining
  // Bright colors only for Advancing / Declining (real directional signals);
  // Basing & Topping use muted COLOR_NEUTRAL so they don't visually compete.
  const dynCols = [
    { label: 'ADVANCING', value: fmtInt(internals?.stage2_count), color: COLOR_GREEN   },
    { label: 'BASING',    value: fmtInt(internals?.stage1_count), color: COLOR_NEUTRAL },
    { label: 'TOPPING',   value: fmtInt(internals?.stage3_count), color: COLOR_NEUTRAL },
    { label: 'DECLINING', value: fmtInt(internals?.stage4_count), color: COLOR_RED     },
  ]
  const DYN_GAP = p(16)
  const dyn_col_w = Math.round((CW - DYN_GAP * 3) / 4)
  dynCols.forEach((c, i) => {
    const cx = PX + (dyn_col_w + DYN_GAP) * i + dyn_col_w / 2

    ctx.font = `600 ${p(12)}px ${MONO}`
    ctx.fillStyle = TEXT_MUTED
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(c.label, cx, Y)

    ctx.font = `700 ${p(28)}px ${MONO}`
    ctx.fillStyle = c.color
    ctx.fillText(c.value, cx, Y + p(20))
  })
  ctx.textAlign = 'left'
  Y += p(72)

  softDivider(Y)
  Y += p(24)

  // ── SECTORS — side by side (Strongest | Weakest) ──────────────────────
  const strongest = (sectors || []).slice(0, 3)
  const weakest   = [...(sectors || [])].reverse().slice(0, 3)
  const hasSectors = strongest.length > 0

  const SEC_GAP = p(32)
  const sec_col_w = Math.round((CW - SEC_GAP) / 2)
  const drawSectorColumn = (label, sRows, color, colX) => {
    const colRight = colX + sec_col_w

    ctx.font = `600 ${p(13)}px ${MONO}`
    ctx.fillStyle = TEXT_MUTED
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(label, colX, Y)

    let innerY = Y + p(28)

    if (!hasSectors) {
      ctx.font = `400 ${p(15)}px ${MONO}`
      ctx.fillStyle = TEXT_FAINT
      ctx.fillText('Updates after close', colX, innerY)
      return Y + p(28) + p(28)
    }

    sRows.forEach((r, i) => {
      const name = r.display_name || r.name || '—'
      const pct  = fmtPct(r.stage2_pct, 1)
      const ry   = innerY + p(16)

      ctx.font = `400 ${p(18)}px ${MONO}`
      ctx.fillStyle = TEXT_PRIMARY
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      // Truncate names that would collide with the pct
      ctx.font = `700 ${p(18)}px ${MONO}`
      const pctW = ctx.measureText(pct).width
      const nameMaxX = colRight - pctW - p(12)

      ctx.font = `400 ${p(18)}px ${MONO}`
      let displayName = name
      while (ctx.measureText(displayName).width + colX > nameMaxX && displayName.length > 3) {
        displayName = displayName.slice(0, -1)
      }
      if (displayName !== name) displayName += '…'
      ctx.fillText(displayName, colX, ry)

      ctx.font = `700 ${p(18)}px ${MONO}`
      ctx.fillStyle = color
      ctx.textAlign = 'right'
      ctx.fillText(pct, colRight, ry)
      ctx.textAlign = 'left'

      if (i < sRows.length - 1) {
        ctx.fillStyle = 'rgba(58, 42, 31, 0.10)'
        ctx.fillRect(colX, ry + p(15), sec_col_w, S)
      }
      innerY += p(34)
    })
    return innerY + p(4)
  }

  const leftBottomY  = drawSectorColumn('STRONGEST SECTORS', strongest, COLOR_GREEN,   PX)
  const rightBottomY = drawSectorColumn('WEAKEST SECTORS',   weakest,   COLOR_CRIMSON, PX + sec_col_w + SEC_GAP)
  Y = Math.max(leftBottomY, rightBottomY)

  // ── FOOTER — centered tiny disclaimer only (no second pinex.in) ───────
  Y += p(28)
  softDivider(Y)
  Y += p(24)

  ctx.font = `400 ${p(12)}px ${MONO}`
  ctx.fillStyle = TEXT_FAINT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('Data only  ·  Not investment advice  ·  Not SEBI registered', W * S / 2, Y)

  // "Visit www.pinex.in" — rendered in normal-weight letters under the
  // disclaimer (not the brand-accent dark used in the header) so the
  // URL reads as a plain call-back, not a logo repeat.
  ctx.font = `400 ${p(13)}px ${MONO}`
  ctx.fillStyle = TEXT_MUTED
  ctx.fillText('Visit www.pinex.in', W * S / 2, Y + p(22))
  ctx.textAlign = 'left'

  // Bottom accent bar — push the trim height down enough to clear the
  // new disclaimer + visit-url line plus a small gap before the bar.
  const finalH = Y + p(72)
  ctx.fillStyle = ACCENT_PINEX
  ctx.fillRect(0, finalH - p(8), W * S, p(8))

  // Trim canvas to actual content height
  const trimmed = document.createElement('canvas')
  trimmed.width  = W * S
  trimmed.height = finalH
  trimmed.getContext('2d').drawImage(canvas, 0, 0)

  return trimmed
}

// ── Modal component ────────────────────────────────────────────────────────
export default function PulseShareCard({ internals, sectors, marketPulse, onClose }) {
  const previewRef = useRef(null)
  const [busy, setBusy]       = useState(false)
  const [preview, setPreview] = useState(null) // data URL for preview img

  // Generate preview on mount
  useEffect(() => {
    let cancelled = false
    drawCard(internals, sectors, marketPulse).then(canvas => {
      if (!cancelled) setPreview(canvas.toDataURL('image/png'))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [internals, sectors, marketPulse])

  // Esc to close
  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  async function captureCanvas() {
    return drawCard(internals, sectors, marketPulse)
  }

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    try {
      const canvas = await captureCanvas()
      const link = document.createElement('a')
      link.download = `pinex-pulse-${internals?.date || 'today'}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    if (busy) return
    setBusy(true)
    try {
      const canvas = await captureCanvas()
      canvas.toBlob(async (blob) => {
        if (!blob) { setBusy(false); return }
        const file = new File(
          [blob],
          `pinex-pulse-${internals?.date || 'today'}.png`,
          { type: 'image/png' }
        )
        try {
          if (navigator.share && navigator.canShare?.({ files: [file] })) {
            await navigator.share({
              title: 'PineX Market Pulse',
              text: `NSE Market Breadth: ${internals?.above_ma30w_pct}% | pinex.in/pulse`,
              files: [file],
            })
          } else {
            const link = document.createElement('a')
            link.download = `pinex-pulse-${internals?.date || 'today'}.png`
            link.href = canvas.toDataURL('image/png')
            link.click()
          }
        } catch { /* user cancelled */ }
        finally { setBusy(false) }
      }, 'image/png')
    } catch { setBusy(false) }
  }

  // -64 = modal's 16+16 padding + ~32 buffer so the preview frame can't
  // ever exceed modal's inner content width (mobile overflow bug fix).
  const previewW = Math.min(
    typeof window !== 'undefined' ? window.innerWidth - 64 : 360,
    400
  )
  // Aspect ratio 1080:1500 (matches canvas max H)
  const previewH = Math.round(previewW * (1500 / 1080))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Share Market Pulse"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflow: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#F4ECD8',
          border: '1px solid #D4C5A8',
          borderRadius: 8,
          padding: 16,
          maxWidth: 'calc(100vw - 32px)',
          width: previewW + 32,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 12,
        }}>
          <strong style={{ fontSize: 14, color: '#3A2A1F', fontFamily: 'inherit' }}>
            Share Market Pulse
          </strong>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#3A2A1F',
              fontSize: 22,
              lineHeight: 1,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Preview */}
        <div style={{
          width: previewW,
          height: previewH,
          boxSizing: 'border-box',
          background: '#F4ECD8',
          border: '1px solid #D4C5A8',
          borderRadius: 4,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {preview
            ? <img
                src={preview}
                alt="Market Pulse card preview"
                style={{ width: previewW, height: previewH, display: 'block' }}
              />
            : <div style={{ color: '#9D8B7A', fontSize: 13, fontFamily: 'inherit' }}>
                Generating card…
              </div>
          }
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy || !preview}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: '#EAD9B5',
              border: '1px solid #D4C5A8',
              borderRadius: 6,
              color: '#3A2A1F',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Working…' : 'Download PNG'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            disabled={busy || !preview}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: '#863bff',
              border: 'none',
              borderRadius: 6,
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
              fontFamily: 'inherit',
            }}
          >
            {busy ? 'Working…' : 'Share'}
          </button>
        </div>
      </div>
    </div>
  )
}
