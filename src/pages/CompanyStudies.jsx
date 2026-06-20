/**
 * CompanyStudies — /learn/companies
 *
 * Public index of Robin's Company Study series. Renders a grid of
 * cards for every row in `company_studies` where is_published = true
 * (RLS filters this server-side; the client-side query is just an
 * ordered SELECT). Each card links to /learn/company/:symbol.
 *
 * Language badge
 *   When a study has any non-null Malayalam / Hindi / Tamil column,
 *   show a small "ML/HI/TA" badge so users know a translation is
 *   available before they click through.
 *
 * Live stage badge
 *   Pulled in the same shape as the StockDetail page: latest
 *   price_data row keyed by company_id. Skipped silently if the
 *   row is missing — the rest of the card still renders.
 */
import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const LANG_KEYS = ['ml', 'hi', 'ta']
const STUDY_SECTIONS = ['what_they_do', 'how_they_make_money', 'who_built_it', 'similar_companies', 'what_to_watch']

function detectLanguages(study) {
  // A study "has" a language when any of the 5 sections OR the title
  // has a non-empty value in that language's _xx column.
  const tags = []
  for (const lang of LANG_KEYS) {
    const titleKey = `title_${lang}`
    const hasTitle = study[titleKey] && String(study[titleKey]).trim()
    const hasAnySection = STUDY_SECTIONS.some((s) => {
      const v = study[`${s}_${lang}`]
      return v && String(v).trim()
    })
    if (hasTitle || hasAnySection) tags.push(lang)
  }
  return tags
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.valueOf())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDuration(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  const mins = Math.round(n / 60)
  return `${mins} min`
}

export default function CompanyStudies() {
  const [rows, setRows] = useState([])
  const [companies, setCompanies] = useState({})  // symbol -> { id, name, sector }
  const [liveByCid, setLiveByCid] = useState({}) // company_id -> { stage }
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // 1) Published studies, newest first. RLS gates the SELECT to
        //    is_published = true for non-admins; the explicit eq below
        //    is belt-and-braces.
        const { data: studies, error } = await supabase
          .from('company_studies')
          .select('id, symbol, youtube_url, podcast_duration_seconds, published_at, ' +
                  STUDY_SECTIONS.flatMap((s) => LANG_KEYS.map((l) => `${s}_${l}`)).join(', ') + ', ' +
                  LANG_KEYS.map((l) => `title_${l}`).join(', '))
          .eq('is_published', true)
          .order('published_at', { ascending: false })
        if (cancelled) return
        if (error) throw error
        const list = studies || []
        setRows(list)

        if (list.length === 0) { setStatus('empty'); return }

        // 2) Companies — single in_ query keyed by symbol.
        const syms = list.map((r) => r.symbol)
        const { data: comps } = await supabase
          .from('companies')
          .select('id, symbol, name, sector')
          .in('symbol', syms)
        if (cancelled) return
        const cmap = {}
        for (const c of (comps || [])) cmap[c.symbol] = c
        setCompanies(cmap)

        // 3) Latest price_data per company — small fetch keyed by
        //    company_id. is_latest=true is one row per company.
        const cids = (comps || []).map((c) => c.id).filter(Boolean)
        if (cids.length) {
          const { data: liveRows } = await supabase
            .from('price_data')
            .select('company_id, stage')
            .in('company_id', cids)
            .eq('is_latest', true)
          if (cancelled) return
          const lmap = {}
          for (const r of (liveRows || [])) lmap[r.company_id] = r
          setLiveByCid(lmap)
        }
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[CompanyStudies] load failed:', e?.message || e)
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <Helmet>
        <title>Company Studies — PineX</title>
        <meta name="description" content="Long-form studies of individual NSE-listed companies — what they do, how they make money, and where they stand in the market cycle today." />
      </Helmet>
      <main style={pageBg}>
        <div style={pageInner}>
          <header>
            <p style={eyebrow}>Learn</p>
            <h1 style={h1}>Company Studies</h1>
            <p style={lead}>
              Short, plain-English deep dives — what each company actually does, how the money flows, and where they sit in the cycle today.
            </p>
          </header>

          {status === 'loading' && <p style={muted}>Loading…</p>}
          {status === 'error' && <p style={muted}>Could not load studies.</p>}
          {status === 'empty' && (
            <p style={muted}>No studies published yet. Check back soon.</p>
          )}

          {status === 'ready' && (
            <div style={grid}>
              {rows.map((r) => {
                const co = companies[r.symbol] || null
                const live = (co?.id ? liveByCid[co.id] : null) || null
                const langs = detectLanguages(r)
                const dur = fmtDuration(r.podcast_duration_seconds)
                return (
                  <Link
                    key={r.id}
                    to={`/learn/company/${r.symbol}`}
                    style={card}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#E2E8F0' }}>{r.symbol}</div>
                      {live?.stage && (
                        <div style={stagePill}>{live.stage}</div>
                      )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 13, color: '#CBD5E1' }}>
                      {co?.name || r.symbol}
                    </div>
                    {co?.sector && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#94A3B8' }}>
                        {co.sector}
                      </div>
                    )}
                    <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {dur && <span style={metaChip}>🎧 {dur}</span>}
                      {langs.length > 0 && (
                        <span style={metaChip}>{langs.map((l) => l.toUpperCase()).join(' · ')}</span>
                      )}
                      {r.published_at && (
                        <span style={dateChip}>{fmtDate(r.published_at)}</span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </>
  )
}

const pageBg = {
  minHeight: '100vh',
  width: '100%',
  background: '#0B0E11',
  color: '#E2E8F0',
  padding: '40px 20px 100px',
  fontFamily: 'DM Sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}
const pageInner = { maxWidth: 960, margin: '0 auto' }
const eyebrow = { margin: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }
const h1      = { margin: '6px 0 0', fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', color: '#E2E8F0' }
const lead    = { margin: '10px 0 24px', fontSize: 14, lineHeight: 1.6, color: '#94A3B8', maxWidth: 600 }
const muted   = { fontSize: 13, color: '#94A3B8' }
const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 14,
}
const card = {
  display: 'block',
  padding: 16,
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid #1E2530',
  borderRadius: 8,
  color: 'inherit',
  textDecoration: 'none',
}
const stagePill = {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 10,
  background: 'rgba(251, 191, 36, 0.10)',
  border: '1px solid rgba(251, 191, 36, 0.30)',
  color: '#FBBF24',
  fontSize: 10,
  fontWeight: 700,
}
const metaChip = {
  display: 'inline-block',
  padding: '2px 7px',
  borderRadius: 4,
  background: 'rgba(148, 163, 184, 0.08)',
  border: '1px solid rgba(148, 163, 184, 0.20)',
  color: '#CBD5E1',
  fontSize: 11,
  fontWeight: 600,
}
const dateChip = {
  display: 'inline-block',
  padding: '2px 7px',
  fontSize: 11,
  color: '#64748B',
}
