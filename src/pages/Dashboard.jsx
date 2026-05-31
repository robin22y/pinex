import { useEffect, useMemo, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useLocation, useNavigate } from 'react-router-dom'
import Skeleton from '../components/ui/Skeleton'
import { C } from '../styles/tokens'
import { useAuth } from '../context'
import { hasSupabaseEnv, supabase } from '../lib/supabase'
import { loadUserWatchlist, deleteWatchlistRow } from '../lib/watchlistTable'
import { getMyInviteCode, getMyInvites } from '../lib/invites'
import FactsOnlyDisclaimer from '../components/FactsOnlyDisclaimer'
import ObservationQuestion from '../components/ObservationQuestion'
import PineXMark from '../components/PineXMark'
import { stageBadge, stageDisplayName, canonicalStageForBadge } from '../lib/stageUi'
import { fetchPhaseHistory, sessionsInCurrentPhase, formatPhaseAge } from '../lib/phaseHelpers'

const TOAST_KEY = 'stockiq_toast'
const BORDER = 'var(--border)'
const HOVER_ROW = 'var(--bg-elevated)'
const TEXT = 'var(--text-primary)'
const MUTED = 'var(--text-muted)'
const AMBER = 'var(--warning)'
const GREEN = 'var(--positive)'
const RED = 'var(--negative)'

const WL_SUBSTAGE_CFG = {
  '2A+': { bg: 'var(--stage2-bg)', color: 'var(--stage2-color)', border: 'var(--stage2-border)', label: 'S2 A+' },
  '2A-': { bg: 'var(--stage2-bg)', color: 'var(--positive-soft)', border: 'var(--stage2-border)', label: 'S2 A-' },
  '2B+': { bg: 'var(--stage3-bg)', color: 'var(--stage3-color)', border: 'var(--stage3-border)', label: 'S2 B+' },
  '2B-': { bg: 'var(--stage3-bg)', color: 'var(--warning)',      border: 'var(--stage3-border)', label: 'S2 B-' },
}
const WL_STAGE_CFG = {
  'Stage 2': { bg: 'var(--stage2-bg)', color: 'var(--stage2-color)', border: 'var(--stage2-border)', label: 'S2' },
  'Stage 1': { bg: 'var(--stage1-bg)', color: 'var(--stage1-color)', border: 'var(--stage1-border)', label: 'S1' },
  'Stage 3': { bg: 'var(--stage3-bg)', color: 'var(--stage3-color)', border: 'var(--stage3-border)', label: 'S3' },
  'Stage 4': { bg: 'var(--stage4-bg)', color: 'var(--stage4-color)', border: 'var(--stage4-border)', label: 'S4' },
}
const WL_BADGE_STYLE = { display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.05em', flexShrink: 0 }
function getWlStageBadge(row, className = '') {
  const sub = row?.weinstein_substage
  const stage = row?.stage
  if (!stage && !sub) return null
  const cfg = (sub && WL_SUBSTAGE_CFG[sub]) || WL_STAGE_CFG[stage]
  if (!cfg) return null
  return <span style={{ ...WL_BADGE_STYLE, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }} className={className}>{cfg.label}</span>
}

function watchlistReferencePrice(entry) {
  for (const k of ['reference_price', 'price_at_add']) {
    const n = Number(entry?.[k])
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

/**
 * formatWatchDate — relative-time helper used by the "Since X ago"
 * label on every watchlist row.
 *
 * Returns:
 *   "today"        if the date is the same calendar day
 *   "yesterday"    one day ago
 *   "Nd ago"       1–29 days ago
 *   "Nmo ago"      1–11 months ago
 *   "DD MMM YY"    anything older
 *
 * Falls back to "—" when the input is null / unparseable.
 */
function formatWatchDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) {
    const months = Math.floor(days / 30)
    return `${months}mo ago`
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
}

function formatInr(n) {
  const x = Number(n)
  if (!Number.isFinite(x)) return '—'
  return `₹${x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function gainCellStyle(gainPct) {
  if (gainPct == null || !Number.isFinite(gainPct)) return { pctColor: MUTED, pctWeight: 400 }
  if (gainPct > 10) return { pctColor: 'var(--accent)', pctWeight: 700 }
  if (gainPct > 5) return { pctColor: 'var(--positive-soft)', pctWeight: 500 }
  if (gainPct > 0) return { pctColor: 'var(--text-muted)', pctWeight: 400 }
  if (gainPct >= -5) return { pctColor: 'var(--negative-soft)', pctWeight: 400 }
  return { pctColor: 'var(--negative)', pctWeight: 700 }
}

function pctFromMaColor(pct) {
  if (pct == null || !Number.isFinite(pct)) return MUTED
  if (pct > 5) return GREEN
  if (pct >= -2) return AMBER
  if (pct < -5) return RED
  return 'var(--negative-soft)'
}

function embeddedCompany(entry) {
  const c = entry?.company ?? entry?.companies
  if (!c) return null
  return Array.isArray(c) ? c[0] : c
}

function defaultWatchlistGroup(row) {
  // WHY: The DB schema settled on a single
  // `group_name` column. Legacy fallbacks
  // (`watchlist_group`, `group`) removed —
  // any stray rows missing the column default
  // to 'My Watchlist' below.
  const g = row?.group_name
  if (typeof g === 'string' && g.trim()) return g.trim()
  return 'My Watchlist'
}

function firstRowPerCompany(rows, idKey = 'company_id') {
  const m = {}
  for (const r of rows || []) {
    const id = r?.[idKey]
    if (!id || m[id]) continue
    m[id] = r
  }
  return m
}

const TH = {
  textAlign: 'left', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: MUTED, padding: '0 10px', height: 36,
  borderBottom: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
}
const TD = {
  padding: '0 10px', height: 46, fontSize: 13,
  color: TEXT, borderBottom: `1px solid ${BORDER}`, verticalAlign: 'middle',
}

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: `1px solid ${BORDER}`,
      borderRadius: 12, overflow: 'hidden', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionHeading({ icon, title, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <i className={`ti ${icon}`} style={{ fontSize: 15, color: MUTED }} />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED }}>
        {title}
      </span>
      {count != null && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
          background: 'var(--bg-elevated)', color: MUTED, border: `1px solid ${BORDER}`,
        }}>
          {count}
        </span>
      )}
    </div>
  )
}

function InviteSection() {
  const { user } = useAuth()
  // WHY: Three distinct states — loading (null), loaded (object), refreshing
  // (object + isFetching). We never collapse to "return null", because that
  // is what made the entire referral card disappear before.
  const [inviteData, setInviteData] = useState(null)
  const [myInvites, setMyInvites] = useState([])
  const [copied, setCopied] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    getMyInviteCode().then((d) => { if (!cancelled) setInviteData(d) })
    getMyInvites().then((d) => { if (!cancelled) setMyInvites(d) })
    return () => { cancelled = true }
  }, [user, reloadKey])

  // Loading: still always render the card frame so the user sees the
  // referral feature exists. Only the inner content swaps out.
  const isLoading = inviteData === null
  const hasError = !!(inviteData && inviteData.error)
  const code = inviteData?.invite_code || null
  const credits = inviteData?.invite_credits ?? 0
  const inviteLink = code ? `https://pinex.in/invite/${code}` : null

  const handleCopy = () => {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ margin: '16px 16px 0', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Invite a friend</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: credits > 0 ? 'var(--accent)' : 'var(--text-disabled)', textTransform: 'none', letterSpacing: 0 }}>
          {isLoading ? '…' : `${credits} invite${credits !== 1 ? 's' : ''} remaining`}
        </span>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
            Loading your invite link…
          </div>
        ) : hasError ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--negative)', textAlign: 'center', padding: '4px 0 10px', lineHeight: 1.5 }}>
              Couldn’t load your invite info. {inviteData.error === 'not_signed_in' ? 'Please sign in again.' : ''}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => { setInviteData(null); setReloadKey((k) => k + 1) }}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                <i className="ti ti-refresh" style={{ marginRight: 4 }} /> Retry
              </button>
            </div>
          </>
        ) : credits > 0 && code ? (
          <>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
              Friends who join using your link get immediate access — no waitlist.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, padding: '8px 12px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                pinex.in/invite/{code}
              </div>
              <button
                onClick={handleCopy}
                style={{ padding: '8px 14px', borderRadius: 6, border: `1px solid ${copied ? 'var(--accent)' : 'var(--border)'}`, background: copied ? 'var(--accent)' : 'var(--bg-elevated)', color: copied ? '#000' : 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s' }}
              >
                {copied ? '✓ Copied!' : 'Copy link'}
              </button>
            </div>
          </>
        ) : !code ? (
          // Logged-in user whose profile has no invite_code yet (e.g. older
          // account from before the invite system shipped). The whole row
          // was previously hidden entirely. Now we keep the card visible
          // and tell the user how to get one.
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0', lineHeight: 1.5 }}>
            Your referral link is not set up yet. Contact support to enable it for your account.
          </div>
        ) : (
          // credits === 0: per spec, hide the link and show "Out of credits"
          <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
            No invite credits remaining. Contact support for more.
          </div>
        )}

        {myInvites.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, color: 'var(--text-hint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Sent invites
            </div>
            {myInvites.slice(0, 3).map((inv, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>{inv.invitee_email}</span>
                <span style={{ color: inv.status === 'accepted' ? 'var(--positive)' : 'var(--text-disabled)' }}>
                  {inv.status === 'accepted' ? 'joined ✓' : 'pending'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  // WHY: React Router's <ScrollRestoration> keys by pathname, so
  // hash navigations like /dashboard#invite-section don't scroll
  // on their own. This effect runs on mount and on every hash
  // change, scrolls the matching element into view, then clears
  // the hash so refreshing the tab doesn't re-trigger the jump.
  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    // Wait one frame so React has time to render the target.
    requestAnimationFrame(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [location.hash])
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [watchRows, setWatchRows] = useState([])
  const [portfolio, setPortfolio] = useState([])
  const [calendar, setCalendar] = useState([])
  const [activity, setActivity] = useState([])
  const [hoveredRow, setHoveredRow] = useState(null)
  const [watchlistFetchError, setWatchlistFetchError] = useState(false)
  // Phase-age per company_id. Populated after the watchlist
  // loads — see the dedicated useEffect below. Null entries render
  // as "—" so the column degrades gracefully before fetch finishes.
  const [phaseAgeMap, setPhaseAgeMap] = useState({})
  // Latest `market_internals.above_ma30w_pct` — used in Watchlist
  // Health's breadth alignment observation. Null until fetched.
  const [marketBreadth, setMarketBreadth] = useState(null)
  // Watchlist Health collapsible state. Default open so the
  // observation question is visible without an extra click.
  const [healthOpen, setHealthOpen] = useState(true)
  // Sort key for the watchlist. Defaults to 'phase' — Advancing
  // names come first so the reader sees their strongest cycle
  // positions at the top without having to scroll past Declining
  // rows. See SORT_OPTIONS and the sortedWatchRows memo below for
  // the available keys and tie-breaker logic.
  const [sortBy, setSortBy] = useState('phase')
  // "Changes since yesterday" banner — fetches the most recent
  // PRIOR trading day per company and diffs today's stage + RS to
  // produce a tight list of moves the reader hasn't seen yet.
  const [changes, setChanges] = useState([])
  const [changesLoading, setChangesLoading] = useState(true)
  // Holds the wlId of the watchlist row currently being edited
  // via the date/price bottom sheet. null = sheet closed.
  const [editingDate, setEditingDate] = useState(null)
  const [isSepiaMode, setIsSepiaMode] = useState(
    document.documentElement.getAttribute('data-theme') === 'sepia'
  )

  useEffect(() => {
    const sync = () => {
      setIsSepiaMode(document.documentElement.getAttribute('data-theme') === 'sepia')
    }
    window.addEventListener('pinex-theme-change', sync)
    return () => window.removeEventListener('pinex-theme-change', sync)
  }, [])

  useEffect(() => {
    const message = sessionStorage.getItem(TOAST_KEY)
    if (!message) return
    sessionStorage.removeItem(TOAST_KEY)
    queueMicrotask(() => setToast(message))
    const id = window.setTimeout(() => setToast(''), 4500)
    return () => window.clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!user?.id || !hasSupabaseEnv) {
      queueMicrotask(() => { setWatchRows([]); setWatchlistFetchError(false); setLoading(false) })
      return
    }
    let active = true
    const userId = user.id

    async function runLoad() {
      setLoading(true)
      setWatchlistFetchError(false)

      const { data: watchlistData, sourceTable, error: wlFetchErr } = await loadUserWatchlist(userId)

      const companyIdsForPrices = [
        ...new Set(
          (watchlistData || []).map((w) => {
            const co = embeddedCompany(w)
            return w.company_id ?? co?.id ?? null
          }).filter(Boolean),
        ),
      ]

      let prices = []
      if (companyIdsForPrices.length > 0) {
        const pr = await supabase
          .from('price_data')
          .select('company_id, close, stage, ma30w, rs_vs_nifty, rsi, obv_slope')
          .eq('is_latest', true)
          .in('company_id', companyIdsForPrices)
        prices = pr.data || []
      }

      const priceMap = {}
      prices.forEach((p) => { priceMap[p.company_id] = p })

      const mergedBase = (watchlistData || []).map((w) => {
        const co = embeddedCompany(w)
        const cid = w.company_id ?? co?.id ?? null
        const price = cid ? priceMap[cid] || {} : {}

        const refFromFields = watchlistReferencePrice(w)
        const refPrice = refFromFields != null && Number.isFinite(refFromFields) && refFromFields > 0 ? refFromFields : null
        const currentPrice = price.close != null && Number.isFinite(Number(price.close)) ? Number(price.close) : null

        let gainPct = null, gainAbs = null
        if (refPrice != null && refPrice !== 0 && currentPrice != null) {
          gainPct = ((currentPrice - refPrice) / refPrice) * 100
          gainAbs = currentPrice - refPrice
        }

        let pctFromMa = null
        const pClose = Number(price.close), ma30w = Number(price.ma30w)
        if (Number.isFinite(pClose) && Number.isFinite(ma30w) && ma30w !== 0) {
          pctFromMa = ((pClose - ma30w) / ma30w) * 100
        }

        const addedIso = w.added_at ?? w.created_at
        const daysSince = addedIso ? Math.floor((Date.now() - new Date(addedIso).getTime()) / 86400000) : null
        const sym = String(w.symbol || '').trim().toUpperCase()

        return {
          wlId: w.id, _sourceTable: sourceTable,
          rowKey: `${w.id ?? sym}-${addedIso}`, symbol: sym || w.symbol,
          company_id: cid, groupName: defaultWatchlistGroup(w),
          name: co?.name || sym || w.symbol,
          sector: (co?.sector && String(co.sector).trim()) || '',
          industry: (co?.industry && String(co.industry).trim()) || '',
          addedIso, daysSince, referencePrice: refPrice, currentPrice,
          // referenceDate — user-set "watching since" date. Falls
          // back to addedIso in the renderers when null. Carried
          // through here so EditDateSheet has a starting value.
          referenceDate: w.reference_date || null,
          ma30w: price.ma30w ?? null, gainPct, gainAbs, pctFromMa,
          stage: price.stage ?? null, weinstein_substage: price.weinstein_substage ?? null, rs: price.rs_vs_nifty,
        }
      })

      if (!active) return
      setWatchlistFetchError(!!(wlFetchErr && !(watchlistData && watchlistData.length)))

      const mergedCompanyIds = [...new Set(mergedBase.map((m) => m.company_id).filter(Boolean))]

      const [sigRes, holdingsRes, swingDateRes, swingsRes, changesRes] = await Promise.all([
        mergedCompanyIds.length
          ? supabase.from('delivery_signals').select('company_id,avg_delivery_30d,date')
              .in('company_id', mergedCompanyIds).order('date', { ascending: false }).limit(4000)
          : Promise.resolve({ data: [] }),
        supabase.from('portfolio').select('*').eq('user_id', userId).limit(200),
        supabase.from('swing_conditions').select('date').order('date', { ascending: false }).limit(1),
        mergedCompanyIds.length
          ? supabase.from('swing_conditions').select('company_id,conditions_met,date')
              .order('date', { ascending: false }).limit(3000)
          : Promise.resolve({ data: [] }),
        mergedCompanyIds.length
          ? supabase.from('quarterly_changes')
              .select('company_id,headline_change,watch_next,ai_summary,created_at')
              .in('company_id', mergedCompanyIds).order('created_at', { ascending: false }).limit(5000)
          : Promise.resolve({ data: [] }),
      ])

      if (!active) return

      const sigByCompany = firstRowPerCompany(sigRes.data || [])
      const latestSwingDate = swingDateRes.data?.[0]?.date
      const latestSwingByCompany = {}
      for (const s of swingsRes.data || []) {
        if (!s?.company_id) continue
        if (latestSwingDate && s.date !== latestSwingDate) continue
        if (!latestSwingByCompany[s.company_id]) latestSwingByCompany[s.company_id] = s
      }

      const changesByCompany = {}
      for (const c of changesRes.data || []) {
        if (!c?.company_id || changesByCompany[c.company_id]) continue
        changesByCompany[c.company_id] = c
      }

      const built = mergedBase.map((row) => {
        const id = row.company_id
        const pd = id ? priceMap[id] : null
        const changes = id ? changesByCompany[id] : {}
        return {
          ...row,
          close: row.currentPrice ?? (pd?.close != null ? Number(pd.close) : null),
          pctMa: row.pctFromMa, gainSinceAddPct: row.gainPct,
          rsVsNifty: pd?.rs_vs_nifty != null && pd.rs_vs_nifty !== '' ? Number(pd.rs_vs_nifty) : null,
          avgDelivery30d: sigByCompany[id]?.avg_delivery_30d != null ? Number(sigByCompany[id].avg_delivery_30d) : null,
          headline: changes?.headline_change || changes?.ai_summary || 'No major recent change',
          conditionsMet: Number(latestSwingByCompany[id]?.conditions_met) || 0,
          updatedAt: changes?.created_at || null, watchNext: changes?.watch_next || null,
        }
      })

      const portfolioData = (holdingsRes.data || []).map((h) => ({
        symbol: h.symbol || h.ticker || '',
        name: h.name || h.company_name || h.symbol || 'Holding',
        invested: Number(h.invested_amount || h.total_invested || (h.quantity || 0) * (h.avg_price || 0) || 0),
        gainLossPct: Number(h.gain_loss_pct || h.pnl_pct || 0),
      }))

      setWatchRows(built)
      setPortfolio(portfolioData)
      setCalendar(built.filter((w) => w.watchNext).slice(0, 30).map((w) => ({ symbol: w.symbol, watchNext: w.watchNext })))
      setActivity(built.filter((w) => w.updatedAt).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 30))
      setLoading(false)
    }

    void runLoad()
    return () => { active = false }
  }, [user?.id])

  // Phase-age + market breadth fetch — derives the "how long has
  // each watchlist name been in its current phase" badge and the
  // market-vs-watchlist breadth comparison used by Watchlist Health.
  // Lives in its own effect so it re-runs whenever the watchlist
  // contents change, not just on auth.
  useEffect(() => {
    if (!watchRows.length) {
      setPhaseAgeMap({})
      return
    }
    let cancelled = false
    const ids = [...new Set(watchRows.map((r) => r.company_id).filter(Boolean))]
    if (!ids.length) {
      setPhaseAgeMap({})
      return
    }
    fetchPhaseHistory(ids, 180).then((grouped) => {
      if (cancelled) return
      const next = {}
      for (const cid of Object.keys(grouped || {})) {
        next[cid] = sessionsInCurrentPhase(grouped[cid])
      }
      setPhaseAgeMap(next)
    })
    return () => { cancelled = true }
  }, [watchRows])

  useEffect(() => {
    if (!hasSupabaseEnv) return
    let cancelled = false
    supabase
      .from('market_internals')
      .select('above_ma30w_pct,date')
      .gt('above_ma30w_pct', 0)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const v = data?.above_ma30w_pct
        if (v != null && Number.isFinite(Number(v))) {
          setMarketBreadth(Number(v))
        }
      })
    return () => { cancelled = true }
  }, [])

  // "Changes since yesterday" — fetches the most recent PRIOR
  // trading day's stage + RS for each watchlist company and diffs
  // against today's values to surface phase transitions and large
  // RS moves. We look at a 7-day calendar window rather than
  // literal `today - 1` because the prior trading day on a Monday
  // is Friday, and NSE holidays push it further back. Whatever
  // turns out to be the latest pre-today row per company is what
  // the reader cares about.
  useEffect(() => {
    if (!hasSupabaseEnv || !watchRows.length) {
      setChanges([])
      setChangesLoading(false)
      return
    }
    let cancelled = false
    const companyIds = [...new Set(watchRows.map((r) => r.company_id).filter(Boolean))]
    if (!companyIds.length) {
      setChanges([])
      setChangesLoading(false)
      return
    }

    setChangesLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const startDate = sevenDaysAgo.toISOString().slice(0, 10)

    supabase
      .from('price_data')
      .select('company_id, stage, rs_vs_nifty, close, date')
      .in('company_id', companyIds)
      .gte('date', startDate)
      .lt('date', today)
      .order('date', { ascending: false })
      .then(({ data }) => {
        if (cancelled) return
        // First row per company == latest pre-today snapshot
        const ydMap = {}
        for (const r of data || []) {
          if (!r.company_id) continue
          if (!ydMap[r.company_id]) ydMap[r.company_id] = r
        }

        const STAGE2_VALUES = new Set(['Stage 2', 'Advancing'])
        const found = []
        for (const w of watchRows) {
          const yd = ydMap[w.company_id]
          if (!yd) continue

          // Phase change — both stages present and different.
          const todayStage = w.stage
          const ydStage = yd.stage
          if (todayStage && ydStage && todayStage !== ydStage) {
            // "positive" if the move lands in Advancing from
            // anywhere else (the only phase cycle analysis treats
            // as buyable). We never label moves as good/bad —
            // this flag drives the up/down arrow chevron only.
            const positive = STAGE2_VALUES.has(todayStage) && !STAGE2_VALUES.has(ydStage)
            found.push({
              symbol: w.symbol,
              type: 'phase_change',
              from: ydStage,
              to: todayStage,
              positive,
            })
          }

          // Big RS move — ≥5 percentage-point swing in a single
          // session. RS is stored as `rsVsNifty` on the merged
          // watch-row, but the DB row uses `rs_vs_nifty`.
          const todayRs = Number(w.rsVsNifty) || 0
          const ydRs = Number(yd.rs_vs_nifty) || 0
          const diff = todayRs - ydRs
          if (Math.abs(diff) >= 5) {
            found.push({
              symbol: w.symbol,
              type: 'rs_move',
              value: diff,
              positive: diff > 0,
            })
          }
        }
        setChanges(found)
        setChangesLoading(false)
      })

    return () => { cancelled = true }
  }, [watchRows])

  // Phase-order map. Lower number = surfaces first. Accepts both
  // the DB strings ("Stage 2") and the PineX display labels
  // ("Advancing") so the sort is correct regardless of which form
  // the row carries. Anything unknown lands at the bottom (9).
  const PHASE_ORDER = {
    'Stage 2': 0, Advancing: 0,
    'Stage 1+': 1, // Emerging — between Advancing and Basing
    'Stage 1': 2, Basing: 2,
    'Stage 3': 3, Topping: 3,
    'Stage 4': 4, Declining: 4,
  }

  const sortedWatchRows = useMemo(() => {
    if (!watchRows.length) return watchRows
    const arr = [...watchRows]
    arr.sort((a, b) => {
      switch (sortBy) {
        case 'phase': {
          const pa = PHASE_ORDER[a.stage] ?? 9
          const pb = PHASE_ORDER[b.stage] ?? 9
          if (pa !== pb) return pa - pb
          // Tie-break: RS descending so the strongest names rise
          // within each phase bucket.
          return (Number(b.rsVsNifty) || 0) - (Number(a.rsVsNifty) || 0)
        }
        case 'rs':
          return (Number(b.rsVsNifty) || 0) - (Number(a.rsVsNifty) || 0)
        case 'ma': {
          // pctFromMa already exists on the row (price.close vs
          // ma30w). Ascending so rows closest to the trend line
          // come first — those are the least-extended setups.
          const ma = a.pctFromMa
          const mb = b.pctFromMa
          const va = ma == null || !Number.isFinite(Number(ma)) ? Infinity : Number(ma)
          const vb = mb == null || !Number.isFinite(Number(mb)) ? Infinity : Number(mb)
          return va - vb
        }
        case 'days': {
          // Pull from phaseAgeMap (sessions in current phase).
          // Descending — oldest phases first so the reader sees
          // their most-established positions at the top.
          const da = a.company_id ? (phaseAgeMap[a.company_id] || 0) : 0
          const db = b.company_id ? (phaseAgeMap[b.company_id] || 0) : 0
          return db - da
        }
        case 'added': {
          // Newest-first by added timestamp. The row carries
          // addedIso (ISO 8601) — fall back to 0 when missing.
          const ta = a.addedIso ? new Date(a.addedIso).getTime() : 0
          const tb = b.addedIso ? new Date(b.addedIso).getTime() : 0
          return tb - ta
        }
        default:
          return 0
      }
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchRows, sortBy, phaseAgeMap])

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sortedWatchRows
    return sortedWatchRows.filter((w) =>
      w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q) || w.sector.toLowerCase().includes(q)
    )
  }, [query, sortedWatchRows])

  const groupedFiltered = useMemo(() => {
    const m = {}
    for (const r of filteredRows) {
      const g = r.groupName || 'My Watchlist'
      if (!m[g]) m[g] = []
      m[g].push(r)
    }
    const keys = Object.keys(m).sort((a, b) => {
      if (a === 'My Watchlist') return -1
      if (b === 'My Watchlist') return 1
      return a.localeCompare(b)
    })
    return keys.map((name) => ({ name, rows: m[name] }))
  }, [filteredRows])

  // Watchlist Health — phase distribution, sector distribution, and
  // breadth alignment. Derived from the loaded watchlist; we choose
  // the single most notable observation by the priority order in
  // the spec so the close-out question only fires on the strongest
  // signal at any given moment.
  const watchlistHealth = useMemo(() => {
    if (!watchRows.length) return null
    const total = watchRows.length

    const phaseCounts = { 'Stage 1': 0, 'Stage 1+': 0, 'Stage 2': 0, 'Stage 3': 0, 'Stage 4': 0 }
    let unclassified = 0
    for (const r of watchRows) {
      const canon = canonicalStageForBadge(r.stage)
      if (canon in phaseCounts) phaseCounts[canon] += 1
      else unclassified += 1
    }

    const sectorMap = new Map()
    for (const r of watchRows) {
      const s = (r.sector || '').trim()
      if (!s) continue
      sectorMap.set(s, (sectorMap.get(s) || 0) + 1)
    }
    const topSectors = [...sectorMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }))
    const sectorCount = sectorMap.size

    const advancing = phaseCounts['Stage 2']
    const declining = phaseCounts['Stage 4']
    const advancingSharePct = total > 0 ? (advancing / total) * 100 : 0

    // Single observation by priority order (spec-driven).
    let observation = null
    let question = null
    if (marketBreadth != null && Math.abs(advancingSharePct - marketBreadth) > 20) {
      const direction = advancingSharePct > marketBreadth ? 'larger' : 'smaller'
      observation = `Your watchlist's Advancing share (${advancingSharePct.toFixed(0)}%) is ${direction} than market breadth (${marketBreadth.toFixed(0)}%).`
      question = 'Does that gap line up with what you’re tracking?'
    } else {
      const topSector = topSectors[0]
      const topSectorPct = topSector ? (topSector.count / total) * 100 : 0
      if (topSector && topSectorPct > 40) {
        observation = `${topSector.name} accounts for ${topSectorPct.toFixed(0)}% of your watchlist.`
        question = 'Is that concentration intentional?'
      } else if (declining > advancing) {
        observation = 'Cycle analysis shows more names in Declining phase than Advancing in your watchlist right now.'
        question = 'How does that compare to what you expected?'
      } else {
        observation = `Your watchlist spans ${total} ${total === 1 ? 'stock' : 'stocks'} across ${sectorCount} ${sectorCount === 1 ? 'sector' : 'sectors'}.`
        question = 'Which name do you want to look at first?'
      }
    }

    return {
      total,
      phaseCounts,
      unclassified,
      topSectors,
      sectorCount,
      advancingSharePct,
      observation,
      question,
    }
  }, [watchRows, marketBreadth])

  const stats = useMemo(() => {
    const gains = watchRows.map((r) => r.gainPct).filter((g) => g != null && Number.isFinite(g))
    const avg = gains.length ? gains.reduce((s, g) => s + g, 0) / gains.length : null
    const best = gains.length ? Math.max(...gains) : null
    const bestRow = watchRows.find((r) => r.gainPct === best)
    const winners = gains.filter((g) => g > 0).length
    return { total: watchRows.length, avg, best, bestSymbol: bestRow?.symbol, winners }
  }, [watchRows])

  function recalcGains(referencePrice, currentPrice) {
    if (!(referencePrice > 0) || !(currentPrice != null && Number.isFinite(currentPrice))) return { gainPct: null, gainAbs: null }
    return { gainPct: ((currentPrice - referencePrice) / referencePrice) * 100, gainAbs: currentPrice - referencePrice }
  }

  /**
   * patchReferenceDateAndPrice — saves the "watching since" date
   * plus an optional reference price. If `price` is null we look
   * up the closing price for that date in price_data and use it.
   *
   * The mutator also optimistically updates the in-memory
   * watchRows so the row reflects the new values without waiting
   * for a full re-fetch.
   */
  async function patchReferenceDateAndPrice(row, dateIso, priceMaybe) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return { ok: false }
    let refPrice = (priceMaybe != null && Number.isFinite(Number(priceMaybe)) && Number(priceMaybe) > 0)
      ? Number(priceMaybe) : null

    // Auto-fetch close from price_data when the user didn't enter
    // an explicit price.
    if (!refPrice && row.company_id && dateIso) {
      try {
        const { data } = await supabase
          .from('price_data')
          .select('close')
          .eq('company_id', row.company_id)
          .eq('date', dateIso)
          .maybeSingle()
        if (data?.close != null && Number.isFinite(Number(data.close))) {
          refPrice = Number(data.close)
        }
      } catch (e) {
        console.warn('[watchlist] auto-fetch close failed:', e)
      }
    }

    const payload = { reference_date: dateIso }
    if (refPrice != null) payload.reference_price = refPrice

    const { error } = await supabase
      .from(row._sourceTable || 'watchlists')
      .update(payload)
      .eq('id', row.wlId)
      .eq('user_id', user.id)
    if (error) {
      console.error('[watchlist] patch ref date failed:', error)
      return { ok: false, error }
    }

    // Optimistic row update
    setWatchRows((prev) =>
      prev.map((r) => {
        if (r.rowKey !== row.rowKey) return r
        const newRef = refPrice != null ? refPrice : r.referencePrice
        const { gainPct, gainAbs } = recalcGains(newRef, r.currentPrice)
        return {
          ...r,
          referenceDate: dateIso,
          referencePrice: newRef,
          gainPct,
          gainAbs,
        }
      })
    )
    return { ok: true, refPrice }
  }

  async function patchReferencePrice(row) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return
    const hint = row.referencePrice != null ? String(row.referencePrice) : ''
    const next = window.prompt('Reference price (₹)', hint)
    if (next === null) return
    const val = Number(String(next).trim().replace(/,/g, ''))
    if (!Number.isFinite(val) || val <= 0) return
    const { error } = await supabase
      .from(row._sourceTable || 'watchlists')
      .update({ reference_price: val, price_at_add: val })
      .eq('id', row.wlId).eq('user_id', user.id)
    if (!error) {
      const { gainPct, gainAbs } = recalcGains(val, row.currentPrice)
      setWatchRows((prev) =>
        prev.map((r) => r.rowKey === row.rowKey ? { ...r, referencePrice: val, gainPct, gainAbs, gainSinceAddPct: gainPct } : r)
      )
    }
  }

  async function removeFromWatchlistRow(row) {
    if (!user?.id || !hasSupabaseEnv || row?.wlId == null) return
    if (!window.confirm(`Remove ${row.symbol} from your watchlist?`)) return
    // deleteWatchlistRow dispatches to localStorage
    // in dev bypass and Supabase otherwise, keeping
    // both modes consistent with StockDetail.
    const { error } = await deleteWatchlistRow(user.id, row.wlId)
    if (!error) setWatchRows((prev) => prev.filter((r) => r.rowKey !== row.rowKey))
  }

  function fmtPct(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
    return `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`
  }

  function renderMobileCard(w) {
    const pctMa = w.pctFromMa
    const pctColor = pctFromMaColor(pctMa)
    const gStyle = gainCellStyle(w.gainPct)
    const gainStr = fmtPct(w.gainPct)
    const maStr = pctMa != null && Number.isFinite(pctMa)
      ? `${pctMa >= 0 ? '+' : ''}${pctMa.toFixed(1)}% vs MA`
      : '—'
    const phaseSessions = w.company_id ? phaseAgeMap[w.company_id] : null
    const phaseAgeLabel = phaseSessions == null ? '—' : formatPhaseAge(phaseSessions)
    // Bar width as a fraction of a 12-month window. Capped at 100%.
    const phaseBarFrac = phaseSessions == null
      ? 0
      : Math.min(1, phaseSessions / 252)

    // Format the date added — short month abbreviation
    // ("12 May") with "Today" / "Nd ago" fallback so
    // recent adds feel concrete.
    let addedLabel = ''
    if (w.addedIso) {
      const d = new Date(w.addedIso)
      if (!Number.isNaN(d.getTime())) {
        addedLabel =
          typeof w.daysSince === 'number' && w.daysSince <= 6
            ? w.daysSince === 0
              ? 'Today'
              : `${w.daysSince}d ago`
            : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      }
    }

    return (
      <div
        key={w.rowKey}
        onClick={() => navigate(`/stock/${w.symbol}`)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', cursor: 'pointer',
          borderBottom: `1px solid ${BORDER}`,
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {/* Left: symbol + stage + name + %-vs-MA */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: TEXT }}>{w.symbol}</span>
            {getWlStageBadge(w, 'rounded px-1.5 py-0.5 text-[9px]')}
          </div>
          <p style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '52vw' }}>
            {w.name || w.sector || '—'}
          </p>
          {/* Watching-since line — relative-time label + pencil
              that opens the date/price edit sheet. Falls back to
              addedIso when the user hasn't manually set a date. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span style={{ fontSize: 10, color: MUTED }}>
              Since {formatWatchDate(w.referenceDate || w.addedIso)}
            </span>
            <button
              type="button"
              onClick={(e) => {
                // Stop the click bubbling to the row's
                // navigate-to-stock handler.
                e.stopPropagation()
                setEditingDate(w.wlId)
              }}
              aria-label="Edit watching-since date"
              style={{
                background: 'none',
                border: 'none',
                color: MUTED,
                cursor: 'pointer',
                fontSize: 11,
                padding: '0 4px',
                opacity: 0.6,
                lineHeight: 1,
              }}
            >
              ✎
            </button>
          </div>
          <p style={{ fontSize: 10, color: pctColor, marginTop: 2 }}>{maStr}</p>
          {/* Phase age — neutral bar, duration only, no traffic
              light coding so the reader decides what "long" means. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div
              style={{
                flex: '1 1 auto',
                maxWidth: 120,
                height: 4,
                background: 'var(--text-muted)',
                opacity: 0.25,
                borderRadius: 2,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: `${phaseBarFrac * 100}%`,
                  height: '100%',
                  background: 'var(--text-primary)',
                  borderRadius: 2,
                }}
              />
            </div>
            <span style={{ fontSize: 10, color: 'var(--text-hint)', whiteSpace: 'nowrap' }}>{phaseAgeLabel}</span>
          </div>
        </div>

        {/* Right: price + gain-since-added + date */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 14, color: TEXT, marginBottom: 2 }}>{formatInr(w.currentPrice)}</p>
          <p style={{ fontSize: 12, color: gStyle.pctColor, fontWeight: gStyle.pctWeight, lineHeight: 1.2 }}>
            {gainStr}
          </p>
          {w.gainPct != null && (
            <p style={{ fontSize: 9, color: 'var(--text-hint)', marginTop: 1 }}>since added</p>
          )}
          {addedLabel && (
            <p style={{ fontSize: 9, color: 'var(--text-hint)', marginTop: 2 }}>
              📌 {addedLabel}
            </p>
          )}
        </div>
      </div>
    )
  }

  function renderDesktopTable(rows) {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              {['Stock', 'Added', 'Ref price', 'CMP', 'Gain', '% vs 30W Trend Line', 'Stage', 'Phase age', ''].map((h, i) => (
                <th key={h || i} style={{ ...TH, textAlign: i >= 2 && i <= 5 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const hover = hoveredRow === w.rowKey
              const pctMa = w.pctFromMa
              const pctColor = pctFromMaColor(pctMa)
              const pctStr = pctMa != null && Number.isFinite(pctMa) ? `${pctMa >= 0 ? '+' : ''}${pctMa.toFixed(2)}%` : '—'
              const gStyle = gainCellStyle(w.gainPct)
              const gainStr = fmtPct(w.gainPct)
              const absStr = w.gainAbs != null && Number.isFinite(w.gainAbs)
                ? `${w.gainAbs >= 0 ? '+' : '−'}${formatInr(Math.abs(w.gainAbs))}`
                : '—'

              let dateLine = '—', daysLine = ''
              if (w.addedIso) {
                const d = new Date(w.addedIso)
                if (!Number.isNaN(d.getTime())) {
                  dateLine = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
                  daysLine = typeof w.daysSince === 'number'
                    ? (w.daysSince === 0 ? 'Today' : `${w.daysSince}d ago`)
                    : ''
                }
              }

              return (
                <tr
                  key={w.rowKey}
                  onClick={() => navigate(`/stock/${w.symbol}`)}
                  onMouseEnter={() => setHoveredRow(w.rowKey)}
                  onMouseLeave={() => setHoveredRow(null)}
                  style={{ cursor: 'pointer', background: hover ? HOVER_ROW : 'transparent', transition: 'background 0.1s' }}
                >
                  <td style={TD}>
                    <p style={{ fontWeight: 700, fontSize: 13, color: TEXT }}>{w.symbol}</p>
                    <p style={{ fontSize: 10, color: MUTED, marginTop: 1 }}>{w.name || '—'}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-hint)' }}>{w.sector || '—'}</p>
                  </td>
                  <td style={TD}>
                    <p style={{ fontSize: 11, color: MUTED }}>{dateLine}</p>
                    {daysLine && <p style={{ fontSize: 10, color: 'var(--text-hint)' }}>{daysLine}</p>}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInr(w.referencePrice)}</span>
                      <button
                        type="button"
                        onClick={() => void patchReferencePrice(w)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: MUTED, lineHeight: 1 }}
                        title="Edit reference price"
                      >
                        <i className="ti ti-pencil" style={{ fontSize: 12 }} />
                      </button>
                    </div>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {formatInr(w.currentPrice)}
                  </td>
                  <td style={{ ...TD, textAlign: 'right' }}>
                    <p style={{ color: gStyle.pctColor, fontWeight: gStyle.pctWeight, fontVariantNumeric: 'tabular-nums' }}>{gainStr}</p>
                    <p style={{ fontSize: 11, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{absStr}</p>
                  </td>
                  <td style={{ ...TD, textAlign: 'right', color: pctColor, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {pctStr}
                  </td>
                  <td style={TD}>
                    {getWlStageBadge(w, 'rounded-md px-2 py-0.5 text-[10px]')}
                  </td>
                  <td style={TD}>
                    {(() => {
                      const sessions = w.company_id ? phaseAgeMap[w.company_id] : null
                      const label = sessions == null ? '—' : formatPhaseAge(sessions)
                      const frac = sessions == null ? 0 : Math.min(1, sessions / 252)
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
                          <div
                            style={{
                              flex: '1 1 auto',
                              maxWidth: 80,
                              height: 4,
                              background: 'var(--text-muted)',
                              opacity: 0.25,
                              borderRadius: 2,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                width: `${frac * 100}%`,
                                height: '100%',
                                background: 'var(--text-primary)',
                                borderRadius: 2,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--text-hint)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{label}</span>
                        </div>
                      )
                    })()}
                  </td>
                  <td style={{ ...TD, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => void removeFromWatchlistRow(w)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: MUTED, padding: 4, lineHeight: 1 }}
                      title={`Remove ${w.symbol}`}
                    >
                      <i className="ti ti-x" style={{ fontSize: 16 }} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const invested = useMemo(() => portfolio.reduce((s, p) => s + (Number(p.invested) || 0), 0), [portfolio])

  return (
    <>
      <Helmet>
        <title>Dashboard — PineX</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      {/* Page header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: `1px solid ${BORDER}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: MUTED, flexShrink: 0 }}>
          Watchlist
        </p>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <i className="ti ti-search" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: MUTED, pointerEvents: 'none' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search watchlist…"
            style={{
              width: '100%', padding: '7px 10px 7px 30px', borderRadius: 8,
              border: `1px solid ${BORDER}`, background: 'var(--bg-elevated)',
              color: TEXT, fontSize: 13, outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Referral / invite — pinned to the top of Dashboard so users
          can find their referral link without scrolling past the
          watchlist. Wrapped in a maxWidth container so it lines up
          with the rest of the page content. */}
      <div id="invite-section" style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <InviteSection />
      </div>

      <div style={{ padding: '16px', maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 90 }}>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={80} />
            <Skeleton height={200} />
            <Skeleton height={160} />
          </div>
        ) : (
          <>
            {/* "Changes since yesterday" banner — surfaces phase
                transitions and large RS moves across the reader's
                watchlist so they don't have to scan the table to
                spot what changed. Hidden when nothing changed or
                when the reader has dismissed it for this view. */}
            {!changesLoading && changes.length > 0 && (
              <ChangesBanner
                changes={changes}
                onDismiss={() => setChanges([])}
              />
            )}

            {/* Stats strip */}
            {watchRows.length > 0 && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { label: 'Watching', value: stats.total, color: TEXT },
                  { label: 'Avg gain', value: fmtPct(stats.avg), color: stats.avg != null ? (stats.avg >= 0 ? GREEN : RED) : MUTED },
                  { label: 'Best', value: stats.bestSymbol ? `${stats.bestSymbol} ${fmtPct(stats.best)}` : '—', color: GREEN },
                  { label: 'Winners', value: stats.winners != null ? `${stats.winners}/${stats.total}` : '—', color: AMBER },
                ].map((s) => (
                  <div key={s.label} style={{
                    flex: '1 1 120px', background: 'var(--bg-surface)', border: `1px solid ${BORDER}`,
                    borderRadius: 10, padding: '10px 14px',
                  }}>
                    <p style={{ fontSize: 10, color: MUTED, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</p>
                    <p style={{ fontSize: 15, fontWeight: 700, color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Watchlist Health — phase + sector distribution and
                a breadth-alignment observation. Collapsible so the
                table stays the primary focus when the user already
                knows the shape of their list. */}
            {watchlistHealth && (
              <section>
                <SectionHeading icon="ti-stethoscope" title="Watchlist Health" />
                <Card>
                  <button
                    type="button"
                    onClick={() => setHealthOpen((v) => !v)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', border: 'none', background: 'transparent',
                      color: TEXT, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                      borderBottom: healthOpen ? `1px solid ${BORDER}` : 'none',
                    }}
                  >
                    <span style={{ color: MUTED, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                      Snapshot · {watchlistHealth.total} {watchlistHealth.total === 1 ? 'name' : 'names'}
                    </span>
                    <i className={`ti ${healthOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ fontSize: 14, color: MUTED }} />
                  </button>
                  {healthOpen && (
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Phase distribution */}
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                          Phase distribution
                        </p>
                        {(() => {
                          const totalPhased = Object.values(watchlistHealth.phaseCounts).reduce((s, n) => s + n, 0) + watchlistHealth.unclassified
                          const order = ['Stage 1', 'Stage 1+', 'Stage 2', 'Stage 3', 'Stage 4']
                          const segs = order
                            .map((k) => ({ key: k, count: watchlistHealth.phaseCounts[k], cfg: stageBadge(k) }))
                            .filter((s) => s.count > 0)
                          return (
                            <>
                              <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--bg-elevated)', gap: 1 }}>
                                {segs.length === 0 ? (
                                  <div style={{ flex: 1, background: 'var(--bg-elevated)' }} />
                                ) : segs.map((s) => (
                                  <div
                                    key={s.key}
                                    style={{
                                      flex: s.count,
                                      background: s.cfg.color,
                                      minWidth: 2,
                                    }}
                                    title={`${stageDisplayName(s.key)} · ${s.count}`}
                                  />
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                                {segs.map((s) => (
                                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED }}>
                                    <span style={{ width: 7, height: 7, borderRadius: 2, background: s.cfg.color, flexShrink: 0 }} />
                                    <span>{s.count} in {stageDisplayName(s.key)}</span>
                                  </div>
                                ))}
                                {watchlistHealth.unclassified > 0 && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: MUTED }}>
                                    <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--text-disabled)', flexShrink: 0 }} />
                                    <span>{watchlistHealth.unclassified} unclassified</span>
                                  </div>
                                )}
                              </div>
                              {!totalPhased && (
                                <p style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 8 }}>—</p>
                              )}
                            </>
                          )
                        })()}
                      </div>

                      {/* Sector distribution */}
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                          Top sectors
                        </p>
                        {watchlistHealth.topSectors.length === 0 ? (
                          <p style={{ fontSize: 11, color: 'var(--text-hint)' }}>—</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {watchlistHealth.topSectors.map((s) => (
                              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                <span style={{ color: TEXT }}>{s.name}</span>
                                <span style={{ color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Breadth alignment */}
                      <div>
                        <p style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
                          Breadth alignment
                        </p>
                        <p style={{ fontSize: 12, color: TEXT, lineHeight: 1.6 }}>
                          Market breadth: {marketBreadth != null ? `${marketBreadth.toFixed(0)}%` : '—'}
                          {' · '}
                          Your watchlist Advancing share: {watchlistHealth.advancingSharePct.toFixed(0)}%
                        </p>
                      </div>

                      <ObservationQuestion
                        observation={watchlistHealth.observation}
                        question={watchlistHealth.question}
                      />
                      <FactsOnlyDisclaimer />
                    </div>
                  )}
                </Card>
              </section>
            )}

            {/* Watchlist */}
            <section>
              <SectionHeading icon="ti-bookmark" title="Watchlist" count={watchRows.length || undefined} />
              {watchlistFetchError ? (
                <div style={{ padding: '16px', color: 'var(--negative-soft)', fontSize: 13 }}>Failed to load watchlist. Please refresh.</div>
              ) : !watchRows.length ? (
                <Card>
                  <div style={{ textAlign: 'center', padding: '48px 24px' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        marginBottom: 8,
                      }}
                    >
                      Your watchlist is empty
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        lineHeight: 1.6,
                        marginBottom: 24,
                        maxWidth: 280,
                        margin: '0 auto 24px',
                      }}
                    >
                      Search for any NSE stock and tap "Add to watchlist" to
                      track it here.
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/')}
                      style={{
                        padding: '11px 24px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--accent)',
                        color: '#000',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Search stocks →
                    </button>
                  </div>
                </Card>
              ) : !filteredRows.length ? (
                <p style={{ fontSize: 13, color: MUTED }}>No stocks match your search.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Sort bar — horizontally-scrollable chip row so
                      the full set fits on mobile without wrapping.
                      The active chip uses the same green accent as
                      SwingX rows so the visual language stays
                      consistent across the watchlist surface. */}
                  {(() => {
                    const SORT_OPTIONS = [
                      { key: 'phase', label: 'Phase' },
                      { key: 'rs',    label: 'RS' },
                      { key: 'ma',    label: '% vs MA' },
                      { key: 'days',  label: 'Days' },
                      { key: 'added', label: 'Added' },
                    ]
                    return (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 0',
                        overflowX: 'auto',
                        scrollbarWidth: 'none',
                        borderBottom: `1px solid ${BORDER}`,
                      }}>
                        <span style={{
                          fontSize: 10,
                          color: MUTED,
                          flexShrink: 0,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.06em',
                          marginRight: 2,
                        }}>
                          Sort
                        </span>
                        {SORT_OPTIONS.map((opt) => {
                          const active = sortBy === opt.key
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => setSortBy(opt.key)}
                              style={{
                                padding: '4px 10px',
                                borderRadius: 20,
                                border: `1px solid ${active ? 'rgba(0,200,5,0.4)' : BORDER}`,
                                background: active ? 'rgba(0,200,5,0.10)' : 'transparent',
                                color: active ? '#00C805' : MUTED,
                                fontSize: 11,
                                fontWeight: active ? 700 : 400,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                                transition: 'all 0.15s',
                              }}
                            >
                              {opt.label}
                              {active && ' ↓'}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                  {groupedFiltered.map(({ name, rows }) => (
                    <div key={name}>
                      {groupedFiltered.length > 1 && (
                        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: MUTED, marginBottom: 8 }}>{name}</p>
                      )}
                      {/* Mobile */}
                      <div className="home-mobile-list" style={{ background: 'var(--bg-surface)', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                        {rows.map(renderMobileCard)}
                      </div>
                      {/* Desktop */}
                      <div className="home-desktop-table" style={{ background: 'var(--bg-surface)', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                        {renderDesktopTable(rows)}
                      </div>
                    </div>
                  ))}
                  {/* Compact "facts only" footer — keeps the editorial
                      promise visible at the bottom of every watchlist. */}
                  <FactsOnlyDisclaimer compact />
                </div>
              )}
            </section>

            {/* Portfolio */}
            <section>
              <SectionHeading icon="ti-chart-pie" title="Portfolio" />
              <Card>
                {portfolio.length ? (
                  <>
                    <div style={{ padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: MUTED }}>Total invested</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: TEXT }}>₹{invested.toLocaleString('en-IN')}</span>
                    </div>
                    {portfolio.map((p, idx) => (
                      <div
                        key={`${p.symbol}-${idx}`}
                        onClick={() => navigate('/portfolio')}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '11px 14px', borderBottom: idx < portfolio.length - 1 ? `1px solid ${BORDER}` : 'none',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>{p.symbol}</p>
                          <p style={{ fontSize: 11, color: MUTED }}>{p.name}</p>
                        </div>
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: p.gainLossPct >= 0 ? GREEN : RED,
                        }}>
                          {p.gainLossPct >= 0 ? '+' : ''}{p.gainLossPct.toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ padding: '24px 14px', textAlign: 'center' }}>
                    <p style={{ fontSize: 13, color: MUTED }}>No holdings found.</p>
                  </div>
                )}
              </Card>
            </section>

            {/* Results Calendar */}
            {calendar.length > 0 && (
              <section>
                <SectionHeading icon="ti-calendar" title="Results Calendar" count={calendar.length} />
                <Card>
                  {calendar.map((c, idx) => (
                    <div
                      key={`${c.symbol}-${idx}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px',
                        borderBottom: idx < calendar.length - 1 ? `1px solid ${BORDER}` : 'none',
                      }}
                    >
                      <i className="ti ti-clock" style={{ fontSize: 12, color: AMBER, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, minWidth: 70 }}>{c.symbol}</span>
                      <span style={{ fontSize: 12, color: MUTED }}>~{c.watchNext}</span>
                    </div>
                  ))}
                </Card>
              </section>
            )}

            {/* Recent Activity */}
            {activity.length > 0 && (
              <section>
                <SectionHeading icon="ti-activity" title="Recent Activity" count={activity.length} />
                <Card>
                  {activity.map((a, idx) => (
                    <div
                      key={`${a.symbol}-${a.updatedAt}`}
                      onClick={() => navigate(`/stock/${a.symbol}`)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '11px 14px', cursor: 'pointer',
                        borderBottom: idx < activity.length - 1 ? `1px solid ${BORDER}` : 'none',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = HOVER_ROW }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <span style={{
                        width: 28, height: 28, borderRadius: 6, background: 'var(--bg-elevated)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: 10, fontWeight: 700, color: 'var(--info)',
                      }}>
                        {a.symbol.slice(0, 2)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 2 }}>{a.symbol}</p>
                        <p style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(a.headline || '').replaceAll('_', ' ')}
                        </p>
                      </div>
                      <i className="ti ti-chevron-right" style={{ fontSize: 14, color: 'var(--text-hint)', flexShrink: 0, marginTop: 4 }} />
                    </div>
                  ))}
                </Card>
              </section>
            )}
          </>
        )}
      </div>

      {/* Preferences */}
      <div style={{
        margin: '24px 16px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          fontSize: 11, fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Preferences
        </div>

        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
              Display Mode
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {isSepiaMode ? 'Sepia-Dim — warm tone, easy on eyes' : 'Dark — default dark theme'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const root = document.documentElement
              const newSepia = !isSepiaMode
              if (newSepia) {
                root.setAttribute('data-theme', 'sepia')
                localStorage.setItem('pinex-theme', 'sepia')
              } else {
                root.removeAttribute('data-theme')
                localStorage.setItem('pinex-theme', 'dark')
              }
              setIsSepiaMode(newSepia)
              window.dispatchEvent(new Event('pinex-theme-change'))
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>{isSepiaMode ? '☀️' : '🌙'}</span>
            <div style={{
              width: 44, height: 24, borderRadius: 12,
              background: isSepiaMode ? 'var(--accent)' : 'var(--border-strong)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', top: 3,
                left: isSepiaMode ? 23 : 3,
                width: 18, height: 18, borderRadius: '50%',
                background: '#fff', transition: 'left 0.2s',
                boxShadow: '0 1px 4px rgba(0,0,0,.3)',
              }} />
            </div>
          </button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><PineXMark /></span>
          <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>v1.0 · pinex.in</span>
        </div>
        <div style={{ padding: '8px 16px', fontSize: 10, color: 'var(--text-disabled)', textAlign: 'center', borderTop: '1px solid var(--border)', lineHeight: 1.6 }}>
          Data is for educational purposes only. Not investment advice.
        </div>
      </div>

      {/* "Watching since" date/price edit sheet — opened by the
          pencil button on each watchlist row. The sheet handles
          the auto-fetch-close fallback when the user leaves the
          price field blank. */}
      {editingDate && (() => {
        const row = watchRows.find((r) => r.wlId === editingDate)
        if (!row) return null
        return (
          <EditDateSheet
            row={row}
            onSave={async (dateIso, priceMaybe) => {
              const res = await patchReferenceDateAndPrice(row, dateIso, priceMaybe)
              if (res?.ok) {
                setEditingDate(null)
                if (priceMaybe == null && res.refPrice == null) {
                  setToast(`Saved. No close found for ${dateIso} — set price manually.`)
                } else {
                  setToast(`Updated ${row.symbol}`)
                }
              } else {
                setToast(`Could not save ${row.symbol}.`)
              }
            }}
            onClose={() => setEditingDate(null)}
          />
        )
      })()}

      {/* Toast */}
      {toast ? (
        <div
          style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999, background: 'var(--bg-surface)', border: `1px solid ${BORDER}`,
            borderRadius: 10, padding: '10px 18px', fontSize: 13, color: TEXT,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
          }}
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </>
  )
}

// ── ChangesBanner ─────────────────────────────────────────────
// Collapsed by default with a count chip; expand to see the per-
// stock detail rows. Renders nothing if the parent passes an empty
// changes array. Phase-transition rows show the from→to phase
// pills with stage-tinted backgrounds; RS-move rows show the
// percentage-point delta. The footer reiterates the facts-only
// editorial line so the reader is never asked to act on what they
// see here.
function ChangesBanner({ changes, onDismiss }) {
  const [expanded, setExpanded] = useState(false)

  const phaseChanges = changes.filter((c) => c.type === 'phase_change')
  const rsMoves      = changes.filter((c) => c.type === 'rs_move')

  // Display + colour mappings accept either DB ("Stage 2") or
  // PineX-display ("Advancing") forms — rows can carry either
  // depending on which source the diff caught.
  const PHASE_DISPLAY = {
    'Stage 1': 'Basing', Basing: 'Basing',
    'Stage 1+': 'Emerging ↗', 'Emerging ↗': 'Emerging ↗',
    'Stage 2': 'Advancing', Advancing: 'Advancing',
    'Stage 3': 'Topping', Topping: 'Topping',
    'Stage 4': 'Declining', Declining: 'Declining',
  }
  const PHASE_COLOR = {
    'Stage 2': '#00C805', Advancing: '#00C805',
    'Stage 1+': '#0D9488', 'Emerging ↗': '#0D9488',
    'Stage 1': '#FBBF24', Basing: '#FBBF24',
    'Stage 3': '#FB923C', Topping: '#FB923C',
    'Stage 4': '#FF3B30', Declining: '#FF3B30',
  }
  const phaseColor = (k) => PHASE_COLOR[k] || '#94A3B8'
  const phaseLabel = (k) => PHASE_DISPLAY[k] || k

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded((s) => !s)
          }
        }}
        aria-expanded={expanded}
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#00C805',
          flexShrink: 0,
          boxShadow: '0 0 6px rgba(0,200,5,0.6)',
        }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}>
            {changes.length} change{changes.length !== 1 ? 's' : ''} since yesterday
          </span>
          {!expanded && (
            <span style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginLeft: 8,
            }}>
              {phaseChanges.length > 0 && `${phaseChanges.length} phase`}
              {phaseChanges.length > 0 && rsMoves.length > 0 && ' · '}
              {rsMoves.length > 0 && `${rsMoves.length} RS move${rsMoves.length !== 1 ? 's' : ''}`}
            </span>
          )}
        </div>
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }} aria-hidden="true">
            {expanded ? '↑' : '↓'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss && onDismiss()
            }}
            aria-label="Dismiss changes banner"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 14,
              padding: 2,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* Phase-change rows */}
          {phaseChanges.map((c, i) => (
            <div key={`p-${i}`} style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}>
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                minWidth: 80,
              }}>
                {c.symbol}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: `${phaseColor(c.from)}20`,
                  color: phaseColor(c.from),
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}>
                  {phaseLabel(c.from)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }} aria-hidden="true">→</span>
                <span style={{
                  fontSize: 11,
                  padding: '2px 7px',
                  borderRadius: 4,
                  background: `${phaseColor(c.to)}20`,
                  color: phaseColor(c.to),
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}>
                  {phaseLabel(c.to)}
                </span>
              </div>
              <span style={{
                fontSize: 10,
                color: c.positive ? '#00C805' : '#FF3B30',
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}>
                {c.positive ? '↑ Phase up' : '↓ Phase down'}
              </span>
            </div>
          ))}

          {/* RS-move rows */}
          {rsMoves.map((c, i) => (
            <div key={`r-${i}`} style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--bg-elevated)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text-primary)',
                minWidth: 80,
              }}>
                {c.symbol}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
                RS moved
              </span>
              <span style={{
                fontSize: 12,
                fontWeight: 700,
                color: c.positive ? '#00C805' : '#FF3B30',
                whiteSpace: 'nowrap',
              }}>
                {c.positive ? '+' : ''}{c.value != null ? Number(c.value).toFixed(1) : '—'}%
              </span>
            </div>
          ))}

          {/* Editorial footer — same wording as FactsOnlyDisclaimer
              so the line stays consistent. Inline rather than the
              shared component because the banner already has a
              border + own typography rhythm to honour. */}
          <div style={{
            padding: '6px 14px',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontStyle: 'italic',
          }}>
            ℹ️ Facts only · Not advice · Your decision
          </div>
        </div>
      )}
    </div>
  )
}

// ── EditDateSheet ─────────────────────────────────────────────
// Bottom-sheet for editing a watchlist row's "watching since"
// date plus an optional reference price. When price is left blank
// the parent (`patchReferenceDateAndPrice`) attempts to fetch the
// closing price for that date from `price_data`.
//
// The sheet slides up from the bottom with a spring transition so
// it feels native on touch devices. Backdrop tap dismisses.
function EditDateSheet({ row, onSave, onClose }) {
  const todayIso = new Date().toISOString().slice(0, 10)
  const initial = (row?.referenceDate
      || (row?.addedIso ? String(row.addedIso).slice(0, 10) : null)
      || todayIso)
  const [date, setDate]   = useState(initial)
  const [price, setPrice] = useState(
    row?.referencePrice != null && Number.isFinite(Number(row.referencePrice))
      ? String(row.referencePrice)
      : ''
  )
  const [visible, setVisible] = useState(false)
  const [saving, setSaving]   = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30)
    return () => clearTimeout(t)
  }, [])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const trimmed = String(price).trim()
      const numeric = trimmed === '' ? null : Number(trimmed)
      await onSave(date, numeric)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Backdrop — only closes when the click is on the
          backdrop itself; child taps shouldn't bubble. */}
      <div
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 900,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set watching-since date"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 901,
          background: 'var(--bg-surface)',
          borderRadius: '20px 20px 0 0',
          borderTop: '1px solid var(--border)',
          padding: '20px 20px 40px',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
          maxWidth: 540,
          margin: '0 auto',
          boxShadow: '0 -8px 32px rgba(0,0,0,0.35)',
        }}
      >
        {/* Drag handle affordance */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: 'var(--border)', margin: '0 auto 20px',
        }} />

        <div style={{
          fontSize: 16, fontWeight: 700,
          color: 'var(--text-primary)', marginBottom: 4,
        }}>
          {row?.symbol}
        </div>
        <div style={{
          fontSize: 12, color: 'var(--text-muted)',
          marginBottom: 20, lineHeight: 1.5,
        }}>
          Set when you started watching this stock. Your return is
          calculated from this date.
        </div>

        {/* Date input */}
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: 'var(--text-muted)', marginBottom: 6,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Watching since
          </div>
          <input
            type="date"
            value={date}
            max={todayIso}
            onChange={(e) => setDate(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 14, outline: 'none', boxSizing: 'border-box',
              colorScheme: 'dark',
            }}
          />
        </div>

        {/* Optional price input */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            color: 'var(--text-muted)', marginBottom: 6,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Price on that date (optional)
          </div>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank to auto-fetch"
            inputMode="decimal"
            step="0.01"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: 14, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{
            fontSize: 10, color: 'var(--text-muted)', marginTop: 4,
          }}>
            Leave blank and we look up the closing price for that date.
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !date}
          style={{
            width: '100%', padding: '13px', borderRadius: 10,
            border: 'none', background: '#00C805',
            color: '#000', fontSize: 14, fontWeight: 700,
            cursor: saving ? 'wait' : 'pointer',
            marginBottom: 10,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: '100%', padding: '11px', borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-muted)',
            fontSize: 13, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </>
  )
}
