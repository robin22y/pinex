/**
 * DistributionDaysCard — "Market Health: Distribution Days"
 *
 * O'Neil / Minervini institutional-selling gauge on a rolling
 * 25-trading-day window. All maths lives in src/lib/distributionDays.js
 * (pure + unit-tested); this file is display + data-fetch only.
 *
 * DATA
 *   Reads ~60 sessions of OHLCV for the index volume proxy from
 *   price_data. NSE doesn't publish index volume, so NIFTYBEES stands
 *   in — it's seeded as a companies row with is_index_proxy = true by
 *   scripts/sql/add_index_proxy_etfs.sql and populated nightly by the
 *   existing fetch_bhav_daily pipeline.
 *
 *   Self-gates to null when the proxy has no usable history, so the
 *   card simply doesn't render until the migration + one pipeline run
 *   have happened. No error state shouted at the user for a data
 *   dependency they can't act on.
 *
 * LANGUAGE
 *   Per the PineX philosophy doc this describes CONDITIONS, never
 *   predictions. "Distribution days measure institutional selling" is
 *   an observation; the action column is risk posture, not a call.
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { C } from '../../styles/tokens'
import {
  CONDITION_BANDS,
  RALLY_EXPIRY_PCT,
  WINDOW_DAYS,
  combineIndexReads,
  computeDistributionDays,
} from '../../lib/distributionDays'

/** Volume proxy per index. Both point at NIFTYBEES for the MVP. */
const PROXY_SYMBOL = 'NIFTYBEES'

/** Sessions to pull — 25-day window + headroom for the rally-expiry scan. */
const HISTORY_SESSIONS = 60

/** tone key from the calc module -> concrete token + dot colour. */
const TONE = {
  green:    { fg: C.green, bg: C.greenBg, border: C.greenBorder },
  amber:    { fg: C.amber, bg: C.amberBg, border: C.amberBorder },
  orange:   { fg: C.amber, bg: C.amberBg, border: C.amberBorder },
  red:      { fg: C.red,   bg: C.redBg,   border: C.redBorder },
  deep_red: { fg: C.red,   bg: C.redBg,   border: C.redBorder },
}

function toneOf(band) {
  return TONE[band?.tone] || TONE.green
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * 'YYYY-MM-DD' -> '27 Jul 2026'.
 *
 * Parses the parts by hand rather than via `new Date(iso)`: that
 * constructor reads a bare date string as UTC midnight, so any viewer
 * west of Greenwich would see the previous day. The session date is a
 * calendar fact from NSE, not an instant — no timezone should touch it.
 * Returns '' on anything unparseable so the caller renders nothing.
 */
function formatSessionDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10))
  if (!m) return ''
  const [, y, mo, d] = m
  const name = MONTHS[Number(mo) - 1]
  if (!name) return ''
  return `${Number(d)} ${name} ${y}`
}

export default function DistributionDaysCard() {
  const [read, setRead] = useState(null)
  const [status, setStatus] = useState('loading')
  const [infoOpen, setInfoOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: proxy } = await supabase
          .from('companies')
          .select('id,symbol')
          .eq('symbol', PROXY_SYMBOL)
          .maybeSingle()
        if (cancelled) return
        if (!proxy?.id) { setStatus('unavailable'); return }

        const { data: rows } = await supabase
          .from('price_data')
          .select('date,open,high,low,close,volume')
          .eq('company_id', proxy.id)
          .order('date', { ascending: false })
          .limit(HISTORY_SESSIONS)
        if (cancelled) return

        // Need at least a couple of sessions before the calc says
        // anything meaningful.
        if (!rows || rows.length < 2) { setStatus('unavailable'); return }

        // Both reads share the proxy for now (see PROXY_SYMBOL note).
        // combineIndexReads still gives us the right shape so swapping
        // in a real 500 proxy later is a one-line change.
        const primary = computeDistributionDays(rows)
        setRead(combineIndexReads(primary, null))
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('unavailable')
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Silent until there's something real to say.
  if (status !== 'ready' || !read) return null

  const tone = toneOf(read.band)

  return (
    <>
      <div
        style={{
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '14px 16px',
        }}
      >
        {/* Title row + info affordance */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, color: C.textMuted,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>
            Market health · Distribution days
          </span>
          <button
            type="button"
            aria-label="How distribution days work"
            onClick={() => setInfoOpen(true)}
            style={{
              width: 18, height: 18, borderRadius: 999,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 11, lineHeight: 1,
              cursor: 'pointer', padding: 0, flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            i
          </button>
          {/* Latest session in the window — the card is computed from
              EOD data, so without a date a stale pipeline day would be
              indistinguishable from a fresh one. Pushed right with
              margin-left:auto so it sits opposite the title. */}
          {read.windowEnd && (
            <span
              title={`Latest session in the ${WINDOW_DAYS}-day window`}
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                color: C.textFaint,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {formatSessionDate(read.windowEnd)}
            </span>
          )}
        </div>

        {/* Count + condition */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span className="num" style={{
            fontSize: 40, fontWeight: 700, lineHeight: 1,
            color: tone.fg, letterSpacing: '-0.02em',
          }}>
            {read.count}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, color: tone.fg,
            background: tone.bg, border: `1px solid ${tone.border}`,
            borderRadius: 6, padding: '3px 9px',
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            {read.band.label}
          </span>
        </div>

        <p style={{ margin: '8px 0 0', fontSize: 13, color: C.text, lineHeight: 1.5 }}>
          {read.band.action}
        </p>

        <p style={{ margin: '4px 0 0', fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
          {read.count === 0
            ? `No distribution days in the last ${read.sessionsAnalysed} sessions.`
            : `Over the last ${read.sessionsAnalysed} sessions` +
              (read.strongCount > 0 ? ` · ${read.strongCount} heavy` : '')}
        </p>

        {/* Session dot strip */}
        {read.timeline?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
              {read.timeline.map((t) => {
                const isDist   = t.kind === 'distribution'
                const isStrong = t.kind === 'strong'
                return (
                  <span
                    key={t.date}
                    title={
                      isStrong ? `${t.date} — heavy distribution`
                      : isDist ? `${t.date} — distribution`
                      : t.kind === 'expired' ? `${t.date} — expired by rally`
                      : t.date
                    }
                    style={{
                      width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                      background: isStrong ? tone.fg
                        : isDist ? tone.bg
                        : C.surface2,
                      border: `1px solid ${isStrong || isDist ? tone.border : C.border}`,
                    }}
                  />
                )
              })}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 10, color: C.textFaint }}>
              Oldest → newest · filled = distribution, solid = heavy
            </p>
          </div>
        )}

        {/* Both-index note. Renders only once a real second index is
            wired; with a single proxy sharedDates is always empty. */}
        {read.sharedDates?.length > 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: tone.fg, lineHeight: 1.5 }}>
            {read.sharedDates.length} session{read.sharedDates.length === 1 ? '' : 's'} where
            both Nifty 50 and Nifty 500 distributed — higher significance.
          </p>
        )}
      </div>

      {infoOpen && <MethodologyModal onClose={() => setInfoOpen(false)} />}
    </>
  )
}

// ── Info modal ──────────────────────────────────────────────────────

function MethodologyModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const h = { fontSize: 13, fontWeight: 700, color: C.text, margin: '18px 0 6px' }
  const p = { fontSize: 12, color: C.textMuted, lineHeight: 1.6, margin: '0 0 4px' }
  const li = { fontSize: 12, color: C.textMuted, lineHeight: 1.6, marginBottom: 3 }
  const ul = { margin: '0 0 4px', paddingLeft: 18 }

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9600,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="How distribution days work"
        style={{
          width: '100%', maxWidth: 520, maxHeight: '86vh', overflowY: 'auto',
          background: C.surfaceCard, border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '20px 22px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0, lineHeight: 1.3 }}>
            How distribution days work
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', color: C.textMuted,
              fontSize: 20, cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <h3 style={h}>1. Distribution day definition</h3>
        <ul style={ul}>
          <li style={li}>Major index (Nifty 50 / Nifty 500) closes LOWER than the previous day</li>
          <li style={li}>Volume is HIGHER than the previous day</li>
          <li style={li}>Selling is broad across leading stocks</li>
        </ul>
        <p style={p}>If those hold, the session counts as one distribution day.</p>

        <h3 style={h}>2. Count over a rolling {WINDOW_DAYS} trading days</h3>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', marginTop: 6 }}>
          {CONDITION_BANDS.map((b, i) => {
            const t = toneOf(b)
            const range = b.max === Infinity ? `${b.min}+`
              : b.min === b.max ? `${b.min}`
              : `${b.min}–${b.max}`
            return (
              <div
                key={b.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr 1fr',
                  gap: 8,
                  padding: '8px 10px',
                  fontSize: 11,
                  alignItems: 'center',
                  borderTop: i === 0 ? 'none' : `1px solid ${C.border}`,
                }}
              >
                <span className="num" style={{ fontWeight: 700, color: t.fg }}>{range}</span>
                <span style={{ color: C.text }}>{b.label}</span>
                <span style={{ color: C.textMuted }}>{b.action}</span>
              </div>
            )
          })}
        </div>

        <h3 style={h}>3. Strong distribution day</h3>
        <ul style={ul}>
          <li style={li}>Index falls more than 1%</li>
          <li style={li}>Volume significantly above the previous day</li>
          <li style={li}>Index closes near the day&rsquo;s low</li>
          <li style={li}>Both Nifty 50 and Nifty 500 show distribution</li>
          <li style={li}>Leading growth stocks fall on heavy volume</li>
        </ul>

        <h3 style={h}>4. Do NOT count if</h3>
        <ul style={ul}>
          <li style={li}>The day is more than {WINDOW_DAYS} trading days old</li>
          <li style={li}>The index has rallied ~{RALLY_EXPIRY_PCT}–6% above that day&rsquo;s close</li>
          <li style={li}>The decline occurred on lighter volume than the previous day</li>
        </ul>

        <h3 style={h}>5. Confirm with other evidence</h3>
        <ul style={ul}>
          <li style={li}>Failed breakouts increasing</li>
          <li style={li}>Leading stocks breaking below the 50 DMA</li>
          <li style={li}>New lows increasing / breadth weakening</li>
          <li style={li}>Leading sectors losing strength</li>
          <li style={li}>More stocks hitting stops</li>
        </ul>

        <div style={{
          marginTop: 18, padding: '10px 12px',
          background: C.amberBg, border: `1px solid ${C.amberBorder}`,
          borderRadius: 8,
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.amber, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Golden rule
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: C.text, lineHeight: 1.6 }}>
            Distribution days measure institutional selling. Never use them in
            isolation — always combine with market breadth, leadership and price action.
          </p>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 10, color: C.textFaint, lineHeight: 1.6 }}>
          NSE does not publish index-level volume. PineX uses {PROXY_SYMBOL} — a liquid
          Nifty 50 ETF — as the volume proxy. Observational data only; past conditions
          do not guarantee future outcomes.
        </p>
      </div>
    </div>,
    document.body,
  )
}
