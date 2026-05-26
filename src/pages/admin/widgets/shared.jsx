// Shared palette, helpers and UI primitives used by AdminDashboard and its widgets.
// Extracted from AdminDashboard.jsx — keep behaviour identical.

export const C = {
  bg: '#05070A', surface: '#0B0F18', card: '#111620',
  border: 'var(--border)', text: 'var(--text-primary)', muted: 'var(--text-muted)', faint: '#3D4F63',
  green: '#34D399', greenDim: 'rgba(52,211,153,0.1)',
  red: '#F87171', redDim: 'rgba(248,113,113,0.1)',
  amber: 'var(--warning)', amberDim: 'rgba(251,191,36,0.1)',
  blue: '#38BDF8', blueDim: 'rgba(56,189,248,0.08)',
}
export const HOVER = 'var(--bg-elevated)'
export const INDIAN_API_CAP = 500

export function parseMeta(meta) {
  if (meta == null) return {}
  if (typeof meta === 'object') return meta
  if (typeof meta === 'string') { try { return JSON.parse(meta) } catch { return {} } }
  return {}
}

export function istCalendarDateParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = f.formatToParts(d)
  const pick = (t) => parts.find((p) => p.type === t)?.value || ''
  return { y: pick('year'), m: pick('month'), day: pick('day') }
}
export function istTodayStartISO() {
  const { y, m, day } = istCalendarDateParts()
  return `${y}-${m}-${day}T00:00:00+05:30`
}
export function istLastNDatesStrings(nDays) {
  const out = []
  for (let i = 0; i < nDays; i++) {
    const { y, m, day } = istCalendarDateParts(new Date(Date.now() - i * 86400000))
    out.push(`${y}-${m}-${day}`)
  }
  return out
}
export function formatISTLine(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(d)
  return `${time} IST, ${date}`
}
export function pickLatestRow(usageRow, adminRow, parseUsageMeta, parseAdminValue) {
  const uT = usageRow?.created_at ? new Date(usageRow.created_at).getTime() : 0
  const aT = adminRow?.created_at ? new Date(adminRow.created_at).getTime() : 0
  if (!uT && !aT) return null
  if (uT >= aT) return { source: 'usage_events', created_at: usageRow.created_at, meta: parseUsageMeta(usageRow) }
  return { source: 'admin_log', created_at: adminRow.created_at, meta: parseAdminValue(adminRow?.new_value) }
}
export function isOverrideActive(row) {
  if (!row?.stage_override) return false
  const exp = row.stage_override_expires_at
  if (!exp) return true
  const t = new Date(exp).getTime()
  return Number.isFinite(t) && t > Date.now()
}
export function fmtIntTotal(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) }
export function failureScriptFromType(t) {
  const s = String(t || '')
  if (s.includes('price_data')) return 'fetch_price_data.py'
  if (s.includes('indianapi')) return 'fetch_indianapi.py'
  return s || '—'
}

// ── UI primitives ──────────────────────────────────────────────────

export function SectionHeading({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 14, color: C.muted }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.muted }}>
        {title}
      </span>
    </div>
  )
}

export function Card({ children, style }) {
  return (
    <div style={{ background: C.card, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', ...style }}>
      {children}
    </div>
  )
}

export function StatCard({ icon, label, value, color, dim }) {
  return (
    <Card>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.muted, margin: 0 }}>{label}</p>
          {icon && (
            <span style={{ width: 28, height: 28, borderRadius: 6, background: dim || C.surface, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`ti ${icon}`} style={{ fontSize: 13, color: color || C.muted }} />
            </span>
          )}
        </div>
        <p style={{ fontSize: 24, fontWeight: 700, color: color || C.text, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      </div>
    </Card>
  )
}

export function StatusDot({ ok }) {
  const color = ok === true ? C.green : ok === false ? C.red : C.muted
  const dim   = ok === true ? C.greenDim : ok === false ? C.redDim : 'transparent'
  return (
    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}`, display: 'inline-block', flexShrink: 0 }} />
  )
}
