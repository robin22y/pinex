import { useEffect, useMemo, useRef, useState } from 'react'
import html2canvas from 'html2canvas'
import { Helmet } from 'react-helmet-async'
import { Link, useParams } from 'react-router-dom'
import AdUnit from '../components/AdUnit'
import DeliveryPanel from '../components/DeliveryPanel'
import RevenueChart from '../components/RevenueChart'
import ShareCard from '../components/ShareCard'
import SignalPanel from '../components/SignalPanel'
import SwingConditions from '../components/SwingConditions'
import WhatChanged from '../components/WhatChanged'
import DataWarning from '../components/states/DataWarning'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import ExplainButton from '../components/ui/ExplainButton'
import Modal from '../components/ui/Modal'
import SectionLabel from '../components/ui/SectionLabel'
import Skeleton from '../components/ui/Skeleton'
import { C } from '../styles/tokens'
import { CONFIG } from '../config'
import { useAuth } from '../context'
import { useViewLimit } from '../hooks/useViewLimit'
import { hasSupabaseEnv, supabase } from '../lib/supabase'

function stageToStatus(stage) {
  const v = String(stage || '').toLowerCase().replace(/\s+/g, '')
  if (v === 'stage2') return 'green'
  if (v === 'stage1') return 'amber'
  if (v === 'stage3' || v === 'stage4') return 'red'
  return 'neutral'
}

function stageLabel(stage) {
  const txt = String(stage || '').toUpperCase()
  return txt || 'N/A'
}

function valueNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatPrice(v) {
  return `₹${valueNum(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function parseShareDate(row) {
  const raw = row?.date || row?.quarter || row?.quarter_name || ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatShareDate(row) {
  const d = parseShareDate(row)
  if (!d) return row?.quarter || row?.quarter_name || '-'
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function formatPct(v) {
  return `${valueNum(v).toFixed(2)}%`
}

function trendClass(delta) {
  if (delta > 0) return 'text-emerald-600'
  if (delta < 0) return 'text-rose-600'
  return 'text-slate-900'
}

function trendIcon(delta) {
  if (delta > 0) return '↑'
  if (delta < 0) return '↓'
  return '•'
}

function ShareholdingTrendCell({ value, nextValue }) {
  const delta = valueNum(value) - valueNum(nextValue)
  return (
    <div className="flex items-center justify-center gap-1">
      <span className={`font-medium ${trendClass(delta)}`}>{formatPct(value)}</span>
      <span className={`text-[11px] ${delta === 0 ? 'text-slate-400' : 'text-slate-500'}`}>{trendIcon(delta)}</span>
    </div>
  )
}

function ShareholdingTable({ quarters }) {
  const metricRows = [
    { key: 'promoter', label: 'Promoters' },
    { key: 'fii', label: 'FII' },
    { key: 'dii', label: 'DII' },
    { key: 'publicHolding', label: 'Public' },
  ]

  return (
    <table className="min-w-full divide-y divide-slate-200">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-4 py-3 text-left text-sm font-medium text-slate-500">Quarter</th>
          {quarters.map((q) => (
            <th key={q.id || q.quarter || q.date} className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">
              {q.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-200 bg-white">
        {metricRows.map((metric, rowIdx) => (
          <tr key={metric.key} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
            <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-500">{metric.label}</td>
            {quarters.map((q, colIdx) => (
              <td key={`${metric.key}-${q.id || q.quarter || q.date}`} className="whitespace-nowrap px-4 py-3 text-sm">
                <ShareholdingTrendCell value={q[metric.key]} nextValue={quarters[colIdx + 1]?.[metric.key]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function monthKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function getDownloadCount() {
  try {
    const k = `stockiq_downloads_${monthKey()}`
    return Number(localStorage.getItem(k) || 0)
  } catch {
    return 0
  }
}

function incrementDownloadCount() {
  try {
    const k = `stockiq_downloads_${monthKey()}`
    const current = Number(localStorage.getItem(k) || 0)
    localStorage.setItem(k, String(current + 1))
  } catch {
    // no-op
  }
}

function LockedViewModal({ open, limitInfo, onClose }) {
  return (
    <Modal isOpen={open} onClose={onClose} title="Daily view limit reached">
      <p style={{ color: C.text }} className="text-sm leading-6">
        You have used {limitInfo?.count || 0} of {limitInfo?.limit || 0} free views today.
      </p>
      <p className="mt-2 text-sm" style={{ color: C.textMuted }}>
        Upgrade to paid for unlimited stock views.
      </p>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
          Close
        </button>
        <Link
          to="/account"
          className="rounded-lg border px-3 py-2 text-sm font-medium"
          style={{ borderColor: C.border, color: C.blue, background: C.blueBg }}
        >
          Upgrade
        </Link>
      </div>
    </Modal>
  )
}

export default function StockDetail() {
  const { symbol } = useParams()
  const { user, profile } = useAuth()
  const { checkAndRecordView } = useViewLimit()
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)
  const [limitInfo, setLimitInfo] = useState(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [message, setMessage] = useState('')
  const shareCardRef = useRef(null)

  const [company, setCompany] = useState(null)
  const [financials, setFinancials] = useState([])
  const [shareholding, setShareholding] = useState([])
  const [deliveryRows, setDeliveryRows] = useState([])
  const [changes, setChanges] = useState({})
  const [priceLatest, setPriceLatest] = useState(null)
  const [priceHistory, setPriceHistory] = useState([])
  const [historyCount, setHistoryCount] = useState(0)
  const [swing, setSwing] = useState({})
  const [sectorRow, setSectorRow] = useState(null)

  const normalizedSymbol = String(symbol || '').toUpperCase().trim()
  const stockUrl = `https://pinex.in/stock/${normalizedSymbol}`
  const isPaid = profile?.plan === 'paid'

  useEffect(() => {
    if (!normalizedSymbol) return
    let active = true

    async function run() {
      setLoading(true)
      setBlocked(false)
      setMessage('')

      if (!hasSupabaseEnv) {
        setLoading(false)
        return
      }

      try {
        const companyRes = await supabase.from('companies').select('*').eq('symbol', normalizedSymbol).single()
        const loadedCompany = companyRes.data
        const companyId = loadedCompany?.id
        if (!companyId) {
          setCompany(null)
          setFinancials([])
          setShareholding([])
          setDeliveryRows([])
          setChanges({})
          setPriceLatest(null)
          setPriceHistory([])
          setHistoryCount(0)
          setSwing({})
          setSectorRow(null)
          return
        }

        const viewRes = await checkAndRecordView(companyId)
        if (!active) return
        if (viewRes?.allowed === false) {
          setBlocked(true)
          setLimitInfo(viewRes)
          setLoading(false)
          return
        }

        const [financialRes, shareRes, deliveryRes, changesRes, priceHistoryRes, swingRes] = await Promise.all([
          supabase
            .from('financials')
            .select('*')
            .eq('company_id', companyId)
            .order('quarter', { ascending: false })
            .limit(8),
          supabase
            .from('shareholding')
            .select('*')
            .eq('company_id', companyId)
            .order('quarter', { ascending: false })
            .limit(8),
          supabase
            .from('delivery_data')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(30),
          supabase
            .from('quarterly_changes')
            .select('*')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('price_data')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(252),
          supabase
            .from('swing_conditions')
            .select('*')
            .eq('company_id', companyId)
            .order('date', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])

        const latestPrice = priceHistoryRes.data?.[0] || null
        const sector = loadedCompany?.sector

        let sectorData = null
        if (sector) {
          const latestSectorDateRes = await supabase
            .from('sectors')
            .select('last_updated')
            .eq('name', sector)
            .order('last_updated', { ascending: false })
            .limit(1)
          const latestSectorDate = latestSectorDateRes.data?.[0]?.last_updated
          if (latestSectorDate) {
            const s = await supabase
              .from('sectors')
              .select('*')
              .eq('name', sector)
              .eq('last_updated', latestSectorDate)
              .maybeSingle()
            sectorData = s.data
          }
        }

        if (!active) return
        setCompany(loadedCompany || null)
        setFinancials(financialRes.data || [])
        setShareholding(shareRes.data || [])
        setDeliveryRows(deliveryRes.data || [])
        const changeRow = changesRes.data || {}
        setChanges({
          ...changeRow,
          headline: changeRow.headline_change || changeRow.headline || '',
        })
        setPriceLatest(latestPrice)
        setPriceHistory(priceHistoryRes.data || [])
        setHistoryCount((priceHistoryRes.data || []).length)
        setSwing(swingRes.data || {})
        setSectorRow(sectorData)
      } finally {
        if (active) setLoading(false)
      }
    }

    void run()
    return () => {
      active = false
    }
  }, [normalizedSymbol, checkAndRecordView])

  const delivery = useMemo(() => {
    const today = deliveryRows[0]?.delivery_pct || 0
    const weekRows = deliveryRows.slice(0, 7)
    const monthRows = deliveryRows.slice(0, 30)
    const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + valueNum(r.delivery_pct), 0) / rows.length : 0)
    return {
      symbol: normalizedSymbol,
      today,
      week_avg: avg(weekRows),
      month_avg: avg(monthRows),
      vs_30d_avg: deliveryRows[0]?.vs_30d_avg || 0,
      ai_insight: deliveryRows[0]?.ai_insight || '',
    }
  }, [deliveryRows, normalizedSymbol])

  const financialWarning =
    financials.find((r) => r?.data_quality_flag || r?.data_quality_warning || r?.is_quality_flagged)?.data_quality_warning ||
    ''
  const shareholdingWarning =
    shareholding.find((r) => r?.data_quality_flag || r?.data_quality_warning || r?.is_quality_flagged)?.data_quality_warning ||
    ''

  const latestTimestamp =
    priceLatest?.date ||
    deliveryRows[0]?.date ||
    changes?.created_at ||
    new Date().toISOString()

  const trendPoints = useMemo(() => {
    const recent = [...priceHistory].slice(0, 60).reverse()
    const closes = recent.map((r) => valueNum(r?.close))
    if (!closes.length) return ''
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const span = max - min || 1
    return closes
      .map((v, i) => {
        const x = (i / Math.max(1, closes.length - 1)) * 100
        const y = 100 - ((v - min) / span) * 100
        return `${x},${y}`
      })
      .join(' ')
  }, [priceHistory])

  const prevClose = valueNum(priceHistory?.[1]?.close)
  const latestClose = valueNum(priceLatest?.close)
  const dayChangePct = prevClose ? ((latestClose - prevClose) / prevClose) * 100 : 0
  const dayChangeUp = dayChangePct >= 0

  const shareholdingRows = useMemo(() => {
    return [...shareholding]
      .sort((a, b) => {
        const at = parseShareDate(a)
        const bt = parseShareDate(b)
        return (bt ? bt.getTime() : 0) - (at ? at.getTime() : 0)
      })
      .map((row) => {
        const promoter = valueNum(row?.promoter_pct)
        const fii = valueNum(row?.fii_pct)
        const dii = valueNum(row?.dii_pct)
        const publicHolding = valueNum(row?.public_pct ?? row?.retail_pct)
        return {
          id: row?.id,
          date: row?.date,
          quarter: row?.quarter,
          label: formatShareDate(row),
          promoter,
          fii,
          dii,
          publicHolding,
        }
      })
  }, [shareholding])

  async function addToWatchlist() {
    if (!user?.id) {
      setMessage('Please sign in to add watchlist stocks.')
      return
    }

    const limit = CONFIG.limits.watchlistStocks
    const countRes = await supabase.from('watchlist').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
    const count = countRes.count || 0
    if (!isPaid && count >= limit) {
      setMessage(`Watchlist limit reached (${limit} stocks).`)
      return
    }

    const { error } = await supabase.from('watchlist').upsert(
      {
        user_id: user.id,
        symbol: normalizedSymbol,
        company_id: company?.id || null,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,symbol' },
    )
    setMessage(error ? 'Could not add to watchlist right now.' : 'Added to watchlist.')
  }

  function openShare() {
    setShareOpen(true)
  }

  function watchLineText() {
    const watch = String(changes?.watch_next || '').trim()
    return watch ? `WATCH: ${watch}` : 'WATCH: Monitor next quarter results.'
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(stockUrl)
      setMessage('Share link copied.')
    } catch {
      setMessage('Could not copy link.')
    } finally {
      setShareOpen(false)
    }
  }

  async function downloadPdf() {
    setPdfLoading(true)
    const limit = CONFIG.limits.downloadsMonthly
    const count = getDownloadCount()
    if (!isPaid && count >= limit) {
      setMessage(`Download limit reached (${limit}/month).`)
      setPdfLoading(false)
      return
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const payload = {
        symbol: normalizedSymbol,
        companyData: company || {},
        financials,
        shareholding,
        changes,
        signals: Array.isArray(changes?.signal_panel) ? changes.signal_panel : [],
        delivery,
        swingConditions: swing,
      }

      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errText = await res.text()
        setMessage(errText || 'Could not generate PDF.')
        setPdfLoading(false)
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const d = new Date()
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yyyy = d.getFullYear()
      const link = document.createElement('a')
      link.href = url
      link.download = `${normalizedSymbol}_PineX_${dd}${mm}${yyyy}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      incrementDownloadCount()
      setMessage('PDF downloaded successfully.')
    } catch {
      setMessage('Failed to generate PDF right now.')
    } finally {
      setPdfLoading(false)
    }
  }

  async function captureCardBlob() {
    const node = shareCardRef.current
    if (!node) return null
    const canvas = await html2canvas(node, { backgroundColor: null, scale: 2 })
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  }

  async function downloadShareCardImage() {
    try {
      const blob = await captureCardBlob()
      if (!blob) {
        setMessage('Could not create share card image.')
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${normalizedSymbol}_PineX.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setMessage('Share card image downloaded.')
    } catch {
      setMessage('Could not download share card image.')
    }
  }

  async function shareOnWhatsapp() {
    await downloadShareCardImage()
    window.open(`https://wa.me/?text=${encodeURIComponent(`Check ${normalizedSymbol} on PineX: ${stockUrl}`)}`, '_blank')
    setShareOpen(false)
  }

  function shareOnTelegram() {
    const headline = String(changes?.headline || '').replaceAll('_', ' ') || 'Stock update'
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(stockUrl)}&text=${encodeURIComponent(headline)}`,
      '_blank',
    )
    setShareOpen(false)
  }

  const website = company?.website || null
  const bseUrl = company?.bse_code ? `https://www.bseindia.com/stock-share-price/stockreach.aspx?scripcode=${company.bse_code}` : null
  const nseUrl = `https://www.nseindia.com/get-quotes/equity?symbol=${normalizedSymbol}`
  const screenerUrl = `https://www.screener.in/company/${normalizedSymbol}/consolidated/`

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        <Skeleton height={36} width="60%" />
        <Skeleton height={20} width="35%" />
        <Skeleton height={180} />
        <Skeleton height={250} />
        <Skeleton height={220} />
      </div>
    )
  }

  if (blocked) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Card>
          <p style={{ color: C.text }} className="text-lg font-semibold">View limit reached</p>
          <p style={{ color: C.textMuted }} className="mt-1 text-sm">
            Upgrade to continue viewing unlimited company detail pages.
          </p>
        </Card>
        <LockedViewModal open={blocked} limitInfo={limitInfo} onClose={() => setBlocked(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-12 pt-4">
      <Helmet>
        <title>{`${company?.name || normalizedSymbol} (${normalizedSymbol}) — PineX`}</title>
        <meta
          name="description"
          content={String(company?.description || company?.description_ai || 'Stock analysis').slice(0, 120)}
        />
        <meta property="og:title" content={`${company?.name || normalizedSymbol} Analysis — PineX`} />
        <meta
          property="og:description"
          content={String(changes?.headline || '').replaceAll('_', ' ') || 'Stock update'}
        />
        <meta property="og:url" content={`https://pinex.in/stock/${normalizedSymbol}`} />
        <meta property="og:image" content="/og-default.png" />
        <meta name="twitter:card" content="summary" />
      </Helmet>

      <section className="rounded-xl p-6 shadow-sm" style={{ background: C.surface }}>
        <h1 className="text-3xl font-bold" style={{ color: C.text }}>
          {company?.name || normalizedSymbol}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge status="blue" text={normalizedSymbol} size="md" />
          <Badge status="neutral" text={company?.sector || 'Unknown sector'} />
          <Badge status="neutral" text={company?.exchange || 'NSE'} />
          <Badge status={stageToStatus(priceLatest?.stage)} text={stageLabel(priceLatest?.stage)} />
        </div>

        <p className="mt-4 text-4xl font-bold tracking-tight" style={{ color: C.text }}>
          {formatPrice(priceLatest?.close)}
        </p>
        <p className="mt-1 text-sm font-semibold" style={{ color: dayChangeUp ? C.green : C.red }}>
          {dayChangeUp ? '+' : ''}
          {dayChangePct.toFixed(2)}% today
        </p>

        <p className="mt-3 text-sm leading-6" style={{ color: C.text }}>
          {company?.description || company?.description_ai || 'Description will appear once generated.'}
        </p>
        {company?.description_approved === false ? (
          <p className="mt-1 text-xs italic" style={{ color: C.textMuted }}>
            AI-generated description — under human review
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          {website ? <a href={website} target="_blank" rel="noreferrer" style={{ color: C.textMuted }}>🌐 Website</a> : null}
          {bseUrl ? <a href={bseUrl} target="_blank" rel="noreferrer" style={{ color: C.textMuted }}>BSE</a> : null}
          <a href={nseUrl} target="_blank" rel="noreferrer" style={{ color: C.textMuted }}>NSE</a>
          <a href={screenerUrl} target="_blank" rel="noreferrer" style={{ color: C.textMuted }}>Screener</a>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={addToWatchlist} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
            ☆ Add to Watchlist
          </button>
          <button type="button" onClick={openShare} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
            📤 Share
          </button>
          <button type="button" onClick={downloadPdf} disabled={pdfLoading} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text, opacity: pdfLoading ? 0.75 : 1 }}>
            {pdfLoading ? 'Generating PDF...' : '⬇ Download PDF'}
          </button>
        </div>
        {message ? (
          <p className="mt-2 text-sm" style={{ color: C.textMuted }}>{message}</p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl p-6 shadow-sm md:col-span-2" style={{ background: C.surface }}>
          <SectionLabel text="Price Trend" />
          <div className="mt-3 h-[220px] w-full rounded-lg bg-black/20 p-3">
            {trendPoints ? (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                <polyline fill="none" stroke={dayChangeUp ? C.green : C.red} strokeWidth="2" points={trendPoints} />
              </svg>
            ) : (
              <p className="text-sm text-slate-500">Price history unavailable.</p>
            )}
          </div>
        </div>
        <div className="rounded-xl p-6 shadow-sm" style={{ background: C.surface }}>
          <SectionLabel text="Technical Stats" />
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-500">RSI</span><span className="font-semibold text-slate-100">{valueNum(priceLatest?.rsi || priceLatest?.rsi14).toFixed(2)}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">MA20</span><span className="font-semibold text-slate-100">{formatPrice(priceLatest?.ma20)}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">MA50</span><span className="font-semibold text-slate-100">{formatPrice(priceLatest?.ma50)}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">MA150</span><span className="font-semibold text-slate-100">{formatPrice(priceLatest?.ma150)}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">52W High</span><span className="font-semibold text-slate-100">{formatPrice(priceLatest?.high_52w)}</span></div>
            <div className="flex items-center justify-between"><span className="text-slate-500">52W Low</span><span className="font-semibold text-slate-100">{formatPrice(priceLatest?.low_52w)}</span></div>
          </div>
        </div>
      </section>

      <section>
        <SectionLabel text="What changed since last quarter" />
        <WhatChanged changes={changes} />
      </section>

      <section>
        <SectionLabel text="At a glance" />
        <SignalPanel signals={Array.isArray(changes?.signal_panel) ? changes.signal_panel : []} />
      </section>

      <section>
        <SectionLabel text="Swing trader conditions" action={<ExplainButton context="What are swing trader conditions?" symbol={normalizedSymbol} />} />
        <SwingConditions
          conditions={{
            is_stage2: swing?.condition_stage2,
            is_delivery_above_avg: swing?.condition_delivery_above_avg,
            is_near_ma20: swing?.condition_near_ma20,
            is_rsi_healthy: swing?.condition_rsi_healthy,
            is_volume_contracting: swing?.condition_volume_contracting,
            breakout_52w: swing?.breakout_52w,
            stage2_entered_this_week: swing?.stage2_new_this_week,
          }}
        />
      </section>

      <section>
        <AdUnit slot={import.meta.env.VITE_ADSENSE_STOCK_SLOT || 'YOUR_SLOT_ID'} format="rectangle" />
      </section>

      <section className="space-y-4">
        {(financials?.length > 0 || shareholdingRows?.length > 0) ? <SectionLabel text="Financials" /> : null}
        {financials?.length > 0 ? (
          <div className="relative rounded-xl p-6 shadow-sm" style={{ background: C.surface }}>
            <SectionLabel text="Revenue & Profit — 8 quarters" action={<ExplainButton context="Explain revenue and PAT trend in plain language." symbol={normalizedSymbol} />} />
            <RevenueChart data={[...financials].reverse()} />
            {financialWarning ? (
              <div className="absolute bottom-3 right-4">
                <DataWarning message={financialWarning} />
              </div>
            ) : null}
          </div>
        ) : null}
        {shareholdingRows?.length > 0 ? (
          <div className="relative rounded-xl p-6 shadow-sm" style={{ background: C.surface }}>
            <SectionLabel text="Shareholding" action={<ExplainButton context="Explain this shareholding pattern simply." symbol={normalizedSymbol} />} />
            <Card className="mt-4 border-slate-200 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <span aria-hidden="true" className="text-slate-500">👥</span>
                <h3 className="text-lg font-bold text-slate-900">Shareholding Pattern</h3>
              </div>
              <div className="overflow-x-auto scrollbar-hide rounded-lg border border-slate-200 bg-white">
                <ShareholdingTable quarters={shareholdingRows} />
              </div>
              <p className="mt-2 text-xs text-slate-400">Data updated quarterly</p>
            </Card>
            {shareholdingWarning ? (
              <div className="absolute bottom-3 right-4">
                <DataWarning message={shareholdingWarning} />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <SectionLabel text="Market behaviour — today" action={<ExplainButton context="Explain current delivery data and how unusual it is." symbol={normalizedSymbol} />} />
        <DeliveryPanel delivery={delivery} />
      </section>

      <section>
        <SectionLabel text={`Sector: ${company?.sector || 'Unknown'}`} />
        <Card>
          <div className="flex items-center gap-2">
            <Badge
              status={String(sectorRow?.health || '').toLowerCase() === 'strong' ? 'green' : String(sectorRow?.health || '').toLowerCase() === 'weak' ? 'red' : 'amber'}
              text={sectorRow?.health || 'neutral'}
            />
            <span className="text-sm" style={{ color: C.textMuted }}>
              Stage2: {sectorRow?.stage2_count || 0}/{sectorRow?.total_companies || sectorRow?.total_count || 0}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6" style={{ color: C.text }}>
            {sectorRow?.ai_overview || 'Sector overview will be shown once AI summary is generated.'}
          </p>
          {company?.sector ? (
            <Link to={`/sector/${encodeURIComponent(company.sector)}`} className="mt-3 inline-block text-sm" style={{ color: C.blue }}>
              See all {company.sector} companies →
            </Link>
          ) : null}
        </Card>
      </section>

      <footer className="rounded-xl border p-4 text-xs leading-6" style={{ borderColor: C.border, background: C.surface2, color: C.textMuted }}>
        Data sourced from NSE, BSE, and public company filings.
        <br />
        AI-generated summaries are for information only.
        <br />
        This is not investment advice. Please consult a SEBI
        <br />
        registered investment adviser before making any investment decision.
        <br />
        Last updated: {new Date(latestTimestamp).toLocaleString()}
        <br />
        Price sessions loaded: {historyCount}
        <br />
        <a
          href={`mailto:support@pinex.in?subject=Data%20error%20report%20-${normalizedSymbol}`}
          style={{ color: C.blue }}
        >
          🚩 Report a data error
        </a>
      </footer>

      <Modal isOpen={shareOpen} onClose={() => setShareOpen(false)} title="Share this stock">
        <p className="text-sm" style={{ color: C.textMuted }}>Choose an option:</p>
        <div className="mt-3 grid gap-2">
          <button type="button" onClick={copyLink} className="rounded-lg border px-3 py-2 text-sm text-left" style={{ borderColor: C.border, color: C.text }}>
            Option A: Copy link
          </button>
          <button type="button" onClick={shareOnWhatsapp} className="rounded-lg border px-3 py-2 text-sm text-left" style={{ borderColor: C.border, color: C.text }}>
            Option B: Share on WhatsApp
          </button>
          <button type="button" onClick={shareOnTelegram} className="rounded-lg border px-3 py-2 text-sm text-left" style={{ borderColor: C.border, color: C.text }}>
            Option C: Share on Telegram
          </button>
          <button type="button" onClick={downloadShareCardImage} className="rounded-lg border px-3 py-2 text-sm text-left" style={{ borderColor: C.border, color: C.text }}>
            Option D: Download card image
          </button>
        </div>
        <p className="mt-3 break-all rounded border px-2 py-1 text-xs" style={{ borderColor: C.border, color: C.text }}>
          {stockUrl}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={() => setShareOpen(false)} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.border, color: C.text }}>
            Close
          </button>
        </div>
      </Modal>

      <div className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0">
        <div ref={shareCardRef}>
          <ShareCard
            companyName={company?.name || normalizedSymbol}
            symbol={normalizedSymbol}
            headline={changes?.headline}
            headlineSeverity={changes?.headline_severity}
            signals={Array.isArray(changes?.signal_panel) ? changes.signal_panel : []}
            swingCount={Number(swing?.conditions_met) || 0}
            deliveryPct={delivery?.today}
            deliveryVs={delivery?.vs_30d_avg}
            watchText={watchLineText()}
            quarter={changes?.current_quarter || financials?.[0]?.quarter || ''}
          />
        </div>
      </div>
    </div>
  )
}
