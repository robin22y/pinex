import StagePill from '../StagePill'

const SURFACE = '#0D1525'
const BORDER = '#1E2530'
const TEXT = '#E2E8F0'
const MUTED = '#64748B'
const GREEN = '#00C805'
const RED = '#FF3B30'
const BLUE = '#60A5FA'
const PURPLE = '#A78BFA'
const AMBER = '#FBBF24'

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function newsBadgeFromHeadline(headline) {
  const h = String(headline || '').toLowerCase()
  if (/\bquarter\b|\bresults?\b|\bq[1234]\b|\bearnings\b/.test(h))
    return { label: 'Earnings', bg: 'rgba(96,165,250,0.18)', border: BLUE, color: BLUE }
  if (/\bacquir|\bmerger|\btakeover\b/.test(h))
    return { label: 'Acquisition', bg: 'rgba(167,139,250,0.15)', border: PURPLE, color: '#C4B5FD' }
  if (/\bsebi\b|\brbi\b|\bpenalt(y|ies)\b|\bshow[\s-]?cause\b/.test(h))
    return { label: 'Regulatory', bg: 'rgba(255,59,48,0.12)', border: RED, color: '#FCA5A5' }
  if (/\bceo\b|\bmd\b|\bappoint|\bmanag(e|ement)\b/.test(h))
    return { label: 'Management', bg: 'rgba(251,191,36,0.14)', border: AMBER, color: '#FDE68A' }
  return { label: 'Update', bg: 'rgba(100,116,139,0.2)', border: MUTED, color: '#CBD5E1' }
}

function formatNewsDate(pub) {
  if (pub == null || pub === '') return '—'
  const d = new Date(pub)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function timeAgo(pub) {
  if (pub == null || pub === '') return '—'
  const d = new Date(pub)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDescriptionMobile(text) {
  if (!text) return []
  return text
    .split(/\.\s+/)
    .filter((s) => s.length > 30)
    .slice(0, 4)
    .map((s) => `${s.trim()}.`)
}

export default function StockDetailRightRail({
  stage,
  deliveryPct,
  pledgePct,
  companyDescription,
  descriptionPending,
  shareAiInsight,
  deliveryAiInsight,
  articles,
}) {
  const del = deliveryPct
  let deliveryTone = null
  if (del != null && Number.isFinite(Number(del))) {
    const dv = Number(del)
    deliveryTone =
      dv > 45 ? { label: `${dv.toFixed(1)}%`, bg: 'rgba(0,200,5,0.12)', border: GREEN, color: GREEN }
      : dv < 25
        ? { label: `${dv.toFixed(1)}%`, bg: 'rgba(255,59,48,0.12)', border: RED, color: '#FCA5A5' }
        : {
            label: `${dv.toFixed(1)}%`,
            bg: 'rgba(100,116,139,0.15)',
            border: MUTED,
            color: TEXT,
          }
  }

  const pledge = pledgePct != null ? valueNum(pledgePct) : null
  const pledgeTone =
    pledge != null && pledge > 0
      ? { label: `${pledge.toFixed(2)}% pledged`, bg: 'rgba(255,59,48,0.12)', border: RED, color: '#FCA5A5' }
      : pledge === 0
        ? { label: 'No pledge', bg: 'rgba(0,200,5,0.12)', border: GREEN, color: GREEN }
        : null

  const list = Array.isArray(articles) ? articles : []
  const mobileDescription = formatDescriptionMobile(companyDescription)

  return (
    <div
      className="p-3 md:p-0"
      style={{
        position: 'sticky',
        top: 72,
        alignSelf: 'start',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        minWidth: 0,
      }}
    >
      <div className="hidden md:flex md:flex-col md:gap-2.5">
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED }}>Verdict</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <StagePill stage={stage} className="rounded-lg px-3 py-2 text-[13px] font-bold uppercase tracking-wide" />
          {deliveryTone ? (
            <span
              className="font-data shrink-0 rounded-md border border-solid px-2.5 py-1 text-[13px] font-semibold tabular-nums leading-tight"
              style={{
                borderColor: deliveryTone.border,
                background: deliveryTone.bg,
                color: deliveryTone.color,
              }}
            >
              Del {deliveryTone.label}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: MUTED }}>Del —</span>
          )}
          {pledgeTone ? (
            <span
              className="rounded-md border border-solid px-2.5 py-1 text-[12px] font-semibold uppercase tracking-wide leading-tight"
              style={{
                borderColor: pledgeTone.border,
                background: pledgeTone.bg,
                color: pledgeTone.color,
              }}
            >
              Pledge · {pledgeTone.label}
            </span>
          ) : (
            <span style={{ fontSize: 13, color: MUTED }}>Pledge —</span>
          )}
        </div>
      </div>

      <div
        className="p-3 md:p-[12px_14px]"
        style={{
          background: SURFACE,
          border: `1px solid ${BORDER}`,
          borderLeftWidth: 2,
          borderLeftStyle: 'solid',
          borderLeftColor: GREEN,
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: MUTED, marginBottom: 10 }}>
          AI intelligence
        </div>
        <ul
          className="md:hidden"
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {(mobileDescription.length ? mobileDescription : [companyDescription || 'Description will appear once generated.']).map(
            (point, i) => (
              <li
                key={`${i}-${point.slice(0, 24)}`}
                style={{ display: 'flex', gap: 10, lineHeight: 1.6, fontSize: 13, color: '#94A3B8' }}
              >
                <span style={{ color: GREEN, flexShrink: 0, marginTop: 2 }}>›</span>
                {point}
              </li>
            ),
          )}
        </ul>
        <p className="hidden md:block" style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: '#94A3B8' }}>
          {companyDescription || 'Description will appear once generated.'}
        </p>
        {descriptionPending ? (
          <p style={{ margin: '8px 0 0', fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            AI-generated description — under human review
          </p>
        ) : null}

        {shareAiInsight ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Shareholding</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#CBD5E1' }}>{shareAiInsight}</p>
          </div>
        ) : null}

        {deliveryAiInsight ? (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 6 }}>Delivery</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: '#CBD5E1' }}>{deliveryAiInsight}</p>
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>EOD news</div>
        <div
          style={{
            maxHeight: 300,
            overflowY: 'auto',
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            background: '#0F1217',
          }}
        >
          {!list.length ? (
            <p style={{ margin: 0, padding: 12, fontSize: 13, color: MUTED }}>No news yet. Updates run after hours.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {list.map((article, idx) => {
                const titleLine = article?.title || '—'
                const pub = article?.published_at ?? article?.fetched_date ?? ''
                const badge = newsBadgeFromHeadline(titleLine)
                return (
                  <li key={`${article?.url || titleLine}-${idx}`}>
                    <button
                      type="button"
                      className="w-full border-0 bg-transparent p-0 text-left md:hidden"
                      style={{
                        padding: '10px 0',
                        borderBottom: `1px solid ${BORDER}`,
                        cursor: article?.url ? 'pointer' : 'default',
                        color: TEXT,
                        minHeight: 44,
                      }}
                      onClick={() => {
                        const u = article?.url
                        if (u) window.open(u, '_blank', 'noopener,noreferrer')
                      }}
                    >
                      <div style={{ fontSize: 10, color: '#475569', marginBottom: 4 }}>
                        {timeAgo(pub)} · {article?.source || 'News'}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: TEXT,
                          lineHeight: 1.4,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {titleLine}
                      </div>
                    </button>
                    <button
                      type="button"
                      className="hidden w-full border-0 bg-transparent p-0 text-left md:block"
                      style={{
                        cursor: article?.url ? 'pointer' : 'default',
                        color: TEXT,
                        padding: '10px 4px',
                        borderBottom: idx < list.length - 1 ? `1px solid ${BORDER}` : 'none',
                      }}
                      onClick={() => {
                        const u = article?.url
                        if (u) window.open(u, '_blank', 'noopener,noreferrer')
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, rowGap: 4 }}>
                        <span className="font-data tabular-nums" style={{ fontSize: 11, color: MUTED }}>
                          {formatNewsDate(pub)}
                        </span>
                        <span
                          className="shrink-0 rounded border border-solid px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide leading-none"
                          style={{
                            borderColor: badge.border,
                            background: badge.bg,
                            color: badge.color,
                          }}
                        >
                          {badge.label}
                        </span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 13, fontWeight: 500, lineHeight: 1.35, color: TEXT }}>{titleLine}</div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
