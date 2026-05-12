import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

const C = {
  bg: '#0B0E11',
  surface: '#0F1217',
  card: '#141820',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  hint: '#475569',
  green: '#00C805',
  red: '#FF3B30',
  blue: '#60A5FA',
  amber: '#FBBF24',
}

const fmt = (n, d=1) => n == null ? '—' : 
  n.toLocaleString('en-IN', {maximumFractionDigits: d})
const fmtPct = (n, d=1) => n == null ? '—' : 
  (n > 0 ? '+' : '') + n.toFixed(d) + '%'
const fmtVol = (n) => {
  if (!n) return '—'
  if (n >= 10000000) return (n/10000000).toFixed(1) + 'Cr'
  if (n >= 100000) return (n/100000).toFixed(1) + 'L'
  if (n >= 1000) return (n/1000).toFixed(0) + 'K'
  return Math.round(n)
}

const StageBadge = ({ stage }) => {
  const cfg = {
    'Stage 2': { bg: 'rgba(0,200,5,.15)', 
                 color: '#00C805', 
                 border: 'rgba(0,200,5,.3)', 
                 label: 'S2' },
    'Stage 1': { bg: 'rgba(96,165,250,.15)', 
                 color: '#60A5FA', 
                 border: 'rgba(96,165,250,.3)', 
                 label: 'S1' },
    'Stage 3': { bg: 'rgba(251,191,36,.15)', 
                 color: '#FBBF24', 
                 border: 'rgba(251,191,36,.3)', 
                 label: 'S3' },
    'Stage 4': { bg: 'rgba(255,59,48,.15)', 
                 color: '#FF3B30', 
                 border: 'rgba(255,59,48,.3)', 
                 label: 'S4' },
  }
  const s = cfg[stage] || { bg: '#1E2530', 
    color: '#64748B', border: '#1E2530', label: '?' }
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 9, fontWeight: 700,
      padding: '1px 5px', borderRadius: 3,
      letterSpacing: '0.05em', flexShrink: 0
    }}>
      {s.label}
    </span>
  )
}

const PulseTag = ({ pulse }) => {
  const cfg = {
    Bullish: { bg: 'rgba(0,200,5,.1)', 
               color: '#00C805', 
               border: 'rgba(0,200,5,.2)' },
    Warning: { bg: 'rgba(255,59,48,.1)', 
               color: '#FF3B30', 
               border: 'rgba(255,59,48,.2)' },
    Neutral: { bg: 'rgba(100,116,139,.1)', 
               color: '#94A3B8', 
               border: 'rgba(100,116,139,.2)' },
  }
  const s = cfg[pulse] || cfg.Neutral
  return (
    <span style={{
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 10, fontWeight: 500,
      padding: '2px 7px', borderRadius: 3,
    }}>
      {pulse || 'Neutral'}
    </span>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [allStocks, setAllStocks] = useState([])
  const [market, setMarket] = useState(null)
  const [sectors, setSectors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState('all')
  const [sortCol, setSortCol] = useState('rs_rating')
  const [sortDir, setSortDir] = useState(-1)
  const [page, setPage] = useState(0)
  const [sectorTf, setSectorTf] = useState('1W')
  const [homeTab, setHomeTab] = useState('stocks')
  const PER_PAGE = 15

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [
          { data: companies },
          { data: prices },
          { data: delivery },
          { data: shareholding },
          { data: mkt },
          { data: sec }
        ] = await Promise.all([
          supabase.from('companies')
            .select('id,symbol,name,sector')
            .or('is_suspended.is.null,is_suspended.eq.false')
            .order('symbol').limit(600),
          supabase.from('price_data')
            .select('company_id,close,stage,rs_vs_nifty,ma30w,ma50,obv_slope,volume,rsi,high_52w,low_52w')
            .eq('is_latest', true).limit(600),
          supabase.from('delivery_signals')
            .select('company_id,avg_delivery_30d,delivery_trend_30d,avg_volume_30d,vol_ratio,is_accumulation,is_distribution,breakout_30wma,breakdown_30wma,breakout_50dma,breakdown_50dma,price_change_7d')
            .order('date', { ascending: false }).limit(600),
          supabase.from('shareholding')
            .select('company_id,promoter_pledge_pct')
            .order('quarter', { ascending: false }).limit(600),
          supabase.from('market_internals')
            .select('*')
            .order('date', { ascending: false }).limit(1),
          supabase.from('nifty_sectors')
            .select('*')
            .order('date', { ascending: false }).limit(32)
        ])

        const pm = {}; prices?.forEach(p => { pm[p.company_id] = p })
        const dm = {}; delivery?.forEach(d => { if(!dm[d.company_id]) dm[d.company_id]=d })
        const sm = {}; shareholding?.forEach(s => { if(!sm[s.company_id]) sm[s.company_id]=s })

        const merged = (companies||[]).map(c => {
          const p = pm[c.id]||{}; const d = dm[c.id]||{}; const s = sm[c.id]||{}
          return {
            ...c,
            close: p.close, stage: p.stage,
            rs_vs_nifty: p.rs_vs_nifty,
            ma30w: p.ma30w, ma50: p.ma50,
            obv_slope: p.obv_slope, volume: p.volume,
            rsi: p.rsi, high_52w: p.high_52w, low_52w: p.low_52w,
            delivery: d.avg_delivery_30d,
            delivery_trend: d.delivery_trend_30d,
            avg_volume_30d: d.avg_volume_30d,
            vol_ratio: d.vol_ratio,
            is_accumulation: d.is_accumulation,
            is_distribution: d.is_distribution,
            breakout_30wma: d.breakout_30wma,
            breakdown_30wma: d.breakdown_30wma,
            breakout_50dma: d.breakout_50dma,
            breakdown_50dma: d.breakdown_50dma,
            price_change_7d: d.price_change_7d,
            pledge: s.promoter_pledge_pct||0,
            pct_from_ma: p.close && p.ma30w
              ? ((p.close - p.ma30w)/p.ma30w*100) : null,
          }
        }).filter(c => c.close != null)

        const rsVals = merged.filter(r => r.rs_vs_nifty != null)
          .map(r => r.rs_vs_nifty).sort((a,b)=>a-b)
        const withR = merged.map(s => ({
          ...s,
          rs_rating: s.rs_vs_nifty != null && rsVals.length
            ? Math.max(1, Math.round(
                (rsVals.filter(v=>v<=s.rs_vs_nifty).length/rsVals.length)*99))
            : null,
          ai_pulse: s.stage==='Stage 2' && s.obv_slope>0.01 ? 'Bullish'
            : s.stage==='Stage 4'||s.obv_slope<-0.02 ? 'Warning' : 'Neutral'
        }))

        setAllStocks(withR)
        setMarket(mkt?.[0]||null)
        const latestDate = sec?.[0]?.date
        setSectors((sec||[]).filter(s=>s.date===latestDate))
      } catch(e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const counts = useMemo(() => ({
    all: allStocks.length,
    stage2: allStocks.filter(s=>s.stage==='Stage 2').length,
    accumulation: allStocks.filter(s=>s.is_accumulation).length,
    distribution: allStocks.filter(s=>s.is_distribution).length,
    breakout30w: allStocks.filter(s=>s.breakout_30wma).length,
    breakdown30w: allStocks.filter(s=>s.breakdown_30wma).length,
    highdelivery: allStocks.filter(s=>s.delivery>55).length,
    clean: allStocks.filter(s=>(!s.pledge||s.pledge===0)&&s.stage==='Stage 2').length,
  }), [allStocks])

  const filtered = useMemo(() => {
    let r = [...allStocks]
    if (activeFilter==='stage2') r=r.filter(s=>s.stage==='Stage 2')
    else if (activeFilter==='accumulation') r=r.filter(s=>s.is_accumulation)
    else if (activeFilter==='distribution') r=r.filter(s=>s.is_distribution)
    else if (activeFilter==='breakout30w') r=r.filter(s=>s.breakout_30wma)
    else if (activeFilter==='breakdown30w') r=r.filter(s=>s.breakdown_30wma)
    else if (activeFilter==='highdelivery') r=r.filter(s=>s.delivery>55)
    else if (activeFilter==='clean') r=r.filter(s=>(!s.pledge||s.pledge===0)&&s.stage==='Stage 2')
    if (search) {
      const q=search.toLowerCase()
      r=r.filter(s=>s.symbol?.toLowerCase().includes(q)||
        (s.sector||'').toLowerCase().includes(q))
    }
    r.sort((a,b)=>{
      const av=a[sortCol]??-999, bv=b[sortCol]??-999
      return sortDir*(bv-av)
    })
    return r
  }, [allStocks, activeFilter, search, sortCol, sortDir])

  const paginated = filtered.slice(page*PER_PAGE, (page+1)*PER_PAGE)
  const totalPages = Math.ceil(filtered.length/PER_PAGE)

  const handleSort = (col) => {
    if (sortCol===col) setSortDir(d=>d*-1)
    else { setSortCol(col); setSortDir(-1) }
    setPage(0)
  }

  const FILTERS = [
    { id:'all', label:'All Stocks', count: counts.all, color: C.muted },
    { id:'stage2', label:'Stage 2', count: counts.stage2, color: C.green },
    { id:'accumulation', label:'Accumulation', count: counts.accumulation, color: C.green },
    { id:'distribution', label:'Distribution', count: counts.distribution, color: C.red },
    { id:'breakout30w', label:'30W Breakout', count: counts.breakout30w, color: C.green },
    { id:'breakdown30w', label:'30W Breakdown', count: counts.breakdown30w, color: C.red },
    { id:'highdelivery', label:'High Delivery', count: counts.highdelivery, color: C.blue },
    { id:'clean', label:'Clean Promoters', count: counts.clean, color: C.amber },
  ]

  const sectorKey = sectorTf==='1D'?'change_1d':sectorTf==='1W'?'change_1w':sectorTf==='1M'?'change_1m':'change_3m'
  const sortedSectors = [...sectors].sort((a,b)=>(b[sectorKey]||0)-(a[sectorKey]||0))

  const TH = ({col, label, right}) => (
    <th onClick={()=>handleSort(col)} style={{
      padding:'6px 10px', fontSize:10, color: sortCol===col ? C.text : C.muted,
      textTransform:'uppercase', letterSpacing:'0.05em', fontWeight:400,
      textAlign: right?'right':'left', cursor:'pointer', whiteSpace:'nowrap',
      borderBottom:`1px solid ${C.border}`, userSelect:'none',
      background: C.surface,
    }}>
      {label} {sortCol===col ? (sortDir===-1?'↓':'↑') : '⇅'}
    </th>
  )

  console.log('allStocks:', allStocks.length, 'filtered:', filtered.length, 'paginated:', paginated.length, 'loading:', loading)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{
                  background:C.bg, color:C.text, 
                  fontSize:13, fontFamily:'DM Sans,system-ui,sans-serif',
                }}>

      <div style={{flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0}}>

        {/* TOPBAR */}
        <div style={{
          height:40, background:C.surface,
          borderBottom:`1px solid ${C.border}`,
          display:'flex', alignItems:'center',
          padding:'0 16px', gap:0, flexShrink:0,
          overflowX:'auto'
        }}>
          {[
            { label:'NIFTY 50', value: market?.nifty_close ? fmt(market.nifty_close,0) : '—',
              badge: (market?.stage2_pct||0)>40 ? 'STAGE 2' : 'STAGE 1',
              badgeColor: (market?.stage2_pct||0)>40 ? C.green : C.blue },
            { label:'INDIA VIX', value: market?.india_vix ? market.india_vix.toFixed(1) : '—',
              badge: market?.vix_level||'—',
              badgeColor: (market?.india_vix||0)>20 ? C.red : (market?.india_vix||0)>15 ? C.amber : C.green },
          ].map((item,i) => (
            <div key={i} style={{display:'flex', alignItems:'center', gap:8, paddingRight:16, marginRight:16,
              borderRight:`1px solid ${C.border}`, flexShrink:0}}>
              <span style={{fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em'}}>
                {item.label}
              </span>
              <span style={{fontWeight:600, fontSize:13}}>{item.value}</span>
              <span style={{
                background: item.badgeColor+'22', color: item.badgeColor,
                border:`1px solid ${item.badgeColor}44`,
                fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:3
              }}>{item.badge}</span>
            </div>
          ))}
          <div style={{display:'flex', alignItems:'center', gap:8, flexShrink:0}}>
            <span style={{fontSize:10, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em'}}>
              BREADTH &gt; 30W MA
            </span>
            <div style={{width:100, height:6, background:C.border, borderRadius:3, overflow:'hidden'}}>
              <div style={{
                height:'100%', borderRadius:3, background:C.green,
                width: (market?.above_ma150_pct||0)+'%'
              }}/>
            </div>
            <span style={{fontWeight:600, fontSize:12}}>
              {market?.above_ma150_pct?.toFixed(1)||'—'}%
            </span>
          </div>
          <span style={{marginLeft:'auto', fontSize:11, color:C.hint, flexShrink:0}}>
            Updated {market?.date ? new Date(market.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'2-digit'}) : '—'}
          </span>
        </div>

        <div style={{
          display:'flex', flexShrink:0,
          borderBottom:`1px solid ${C.border}`,
          background:C.surface,
          overflowX:'auto', scrollbarWidth:'none',
        }}>
          {[
            {id:'stocks', label:'Stocks'},
            {id:'sectors', label:'Sector Performance'},
          ].map(tab=>(
            <button key={tab.id}
              type="button"
              onClick={()=>setHomeTab(tab.id)}
              style={{
                flex:'none',
                padding:'10px 18px',
                minHeight:40,
                fontSize:13,
                fontWeight:homeTab===tab.id ? 600 : 400,
                color:homeTab===tab.id ? C.text : C.muted,
                background:'none',
                border:'none',
                borderBottom:`2px solid ${
                  homeTab===tab.id ? C.green : 'transparent'}`,
                cursor:'pointer',
                whiteSpace:'nowrap',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* SCROLLABLE BODY */}
        <div style={{flex:1, overflowY:'auto', padding:'12px 16px 96px',
          display:'flex', flexDirection:'column', gap:12}}>

          {homeTab==='stocks' && (
            <>

          {/* FILTER CARDS */}
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px,1fr))', gap:8}}>
            {FILTERS.map(f => (
              <div key={f.id}
                onClick={()=>{ setActiveFilter(f.id); setPage(0) }}
                style={{
                  background: activeFilter===f.id ? C.card : C.surface,
                  border:`1px solid ${activeFilter===f.id ? f.color : C.border}`,
                  borderRadius:6, padding:'10px 12px',
                  cursor:'pointer', transition:'border-color .15s'
                }}>
                <div style={{fontSize:11, fontWeight:500, color:C.text}}>
                  {f.label}
                </div>
                <div style={{fontSize:22, fontWeight:700, color:f.color, marginTop:4}}>
                  {loading ? '...' : f.count}
                </div>
              </div>
            ))}
          </div>

          {/* ENGINE TABLE */}
          <div style={{background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, minHeight:200}}>

            {/* Table toolbar */}
            <div style={{padding:'8px 12px', borderBottom:`1px solid ${C.border}`,
              display:'flex', alignItems:'center', gap:8}}>
              <div style={{position:'relative', flex:1, maxWidth:220}}>
                <i className="ti ti-search" style={{position:'absolute', left:8, top:'50%',
                  transform:'translateY(-50%)', fontSize:13, color:C.muted}}/>
                <input
                  value={search}
                  onChange={e=>{ setSearch(e.target.value); setPage(0) }}
                  placeholder="Search ticker or sector..."
                  style={{
                    width:'100%', background:C.bg, border:`1px solid ${C.border}`,
                    borderRadius:4, padding:'5px 8px 5px 26px',
                    fontSize:12, color:C.text, outline:'none'
                  }}
                />
              </div>
              <span style={{marginLeft:'auto', fontSize:11, color:C.hint}}>
                {filtered.length} stocks · Page {page+1}/{Math.max(1,totalPages)}
              </span>
            </div>

            {/* Desktop table */}
            <div className="hidden md:block" style={{overflowX:'auto', minHeight:200}}>
              <table style={{width:'100%', borderCollapse:'collapse', tableLayout:'fixed'}}>
                <colgroup>
                  <col style={{width:160}}/><col style={{width:100}}/><col style={{width:100}}/>
                  <col style={{width:80}}/><col style={{width:80}}/><col style={{width:90}}/>
                  <col style={{width:80}}/><col style={{width:90}}/><col style={{width:90}}/><col style={{width:90}}/>
                </colgroup>
                <thead>
                  <tr>
                    <TH col="symbol" label="Ticker"/>
                    <TH col="close" label="CMP" right/>
                    <TH col="pct_from_ma" label="% 30W MA" right/>
                    <TH col="rs_rating" label="RS" right/>
                    <TH col="volume" label="Volume" right/>
                    <TH col="delivery" label="Del %" right/>
                    <TH col="avg_volume_30d" label="Del Vol" right/>
                    <TH col="price_change_7d" label="7D %" right/>
                    <TH col="pledge" label="Pledge" right/>
                    <TH col="ai_pulse" label="Pulse" right/>
                  </tr>
                </thead>
                <tbody>
                  {loading ? Array(8).fill(0).map((_,i)=>(
                    <tr key={i}>
                      {Array(10).fill(0).map((_,j)=>(
                        <td key={j} style={{padding:'8px 10px'}}>
                          <div style={{height:12, background:C.border, borderRadius:3,
                            animation:'pulse 1.5s ease infinite', opacity:.5}}/>
                        </td>
                      ))}
                    </tr>
                  )) : paginated.map(s => (
                    <tr key={s.symbol}
                      onClick={()=>navigate('/stock/'+s.symbol)}
                      style={{borderBottom:`1px solid ${C.card}`, cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background=C.card}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'7px 10px'}}>
                        <div style={{display:'flex', alignItems:'center', gap:5}}>
                          <span style={{fontWeight:600, fontSize:12}}>{s.symbol}</span>
                          <StageBadge stage={s.stage}/>
                        </div>
                        <div style={{fontSize:10, color:C.muted, marginTop:1}}>{s.sector}</div>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontWeight:600, fontSize:13,
                          color: s.pct_from_ma>5 ? C.green : s.pct_from_ma<-5 ? C.red : C.text}}>
                          ₹{fmt(s.close)}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{
                          fontSize:12, fontWeight:600, padding:'2px 6px', borderRadius:3,
                          background: s.pct_from_ma>5 ? 'rgba(0,200,5,.1)'
                            : s.pct_from_ma>-3 && s.pct_from_ma<5 ? 'rgba(251,191,36,.1)'
                            : 'rgba(255,59,48,.1)',
                          color: s.pct_from_ma>5 ? C.green
                            : s.pct_from_ma>-3 ? C.amber : C.red
                        }}>
                          {s.pct_from_ma!=null ? fmtPct(s.pct_from_ma) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:4}}>
                          <div style={{width:28, height:4, background:C.border, borderRadius:2, overflow:'hidden'}}>
                            <div style={{height:'100%', borderRadius:2,
                              width:(s.rs_rating||0)+'%',
                              background: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red
                            }}/>
                          </div>
                          <span style={{fontSize:12, fontWeight:600, minWidth:22,
                            color: s.rs_rating>80?C.green:s.rs_rating>60?C.blue:s.rs_rating>40?C.amber:C.red}}>
                            {s.rs_rating||'—'}
                          </span>
                        </div>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right', fontSize:12, color:C.muted}}>
                        {fmtVol(s.volume)}
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontSize:12, fontWeight: s.delivery>=60?600:400,
                          color: s.delivery>=60?C.green:s.delivery>=40?C.text:C.muted}}>
                          {s.delivery?.toFixed(1)||'—'}%
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right', fontSize:12, color:C.muted}}>
                        {fmtVol(s.avg_volume_30d)}
                        {s.delivery_trend==='rising' && 
                          <span style={{color:C.green, marginLeft:4}}>↑</span>}
                        {s.delivery_trend==='falling' && 
                          <span style={{color:C.red, marginLeft:4}}>↓</span>}
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontSize:12, fontWeight:500,
                          color: s.price_change_7d>3?C.green:s.price_change_7d<-3?C.red:C.muted}}>
                          {s.price_change_7d!=null ? fmtPct(s.price_change_7d) : '—'}
                        </span>
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        {s.pledge>0
                          ? <span style={{color:C.red, fontWeight:700, fontSize:12}}>
                              ⚠ {s.pledge.toFixed(1)}%
                            </span>
                          : <span style={{color:C.hint, fontSize:12}}>—</span>
                        }
                      </td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <PulseTag pulse={s.ai_pulse}/>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden">
              {loading ? Array(6).fill(0).map((_,i)=>(
                <div key={i} style={{padding:'12px 14px', borderBottom:`1px solid ${C.border}`}}>
                  <div style={{height:14, background:C.border, borderRadius:3, width:'40%', 
                    marginBottom:6, animation:'pulse 1.5s ease infinite'}}/>
                  <div style={{height:10, background:C.border, borderRadius:3, width:'60%',
                    animation:'pulse 1.5s ease infinite'}}/>
                </div>
              )) : paginated.map(s => (
                <div key={s.symbol}
                  onClick={()=>navigate('/stock/'+s.symbol)}
                  style={{padding:'12px 14px', borderBottom:`1px solid ${C.border}`,
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    cursor:'pointer', minHeight:56}}
                  onTouchStart={e=>e.currentTarget.style.background=C.card}
                  onTouchEnd={e=>e.currentTarget.style.background='transparent'}>
                  <div>
                    <div style={{display:'flex', alignItems:'center', gap:6, marginBottom:3}}>
                      <span style={{fontSize:15, fontWeight:700}}>{s.symbol}</span>
                      <StageBadge stage={s.stage}/>
                      {s.pledge>0 && 
                        <span style={{color:C.red, fontSize:10, fontWeight:700}}>⚠</span>}
                    </div>
                    <div style={{fontSize:11, color:C.muted}}>{s.sector}</div>
                    <div style={{fontSize:11, fontWeight:500, marginTop:2,
                      color: s.pct_from_ma>5?C.green:s.pct_from_ma>-3?C.amber:C.red}}>
                      {s.pct_from_ma!=null ? fmtPct(s.pct_from_ma)+' vs 30W MA' : ''}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:15, fontWeight:700, marginBottom:3,
                      color: s.pct_from_ma>5?C.green:s.pct_from_ma<-5?C.red:C.text}}>
                      ₹{fmt(s.close)}
                    </div>
                    <div style={{fontSize:11,
                      color: s.delivery>=60?C.green:C.muted}}>
                      {s.delivery?.toFixed(1)||'—'}% del
                    </div>
                    <PulseTag pulse={s.ai_pulse}/>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages>1 && (
              <div style={{padding:'6px 12px', borderTop:`1px solid ${C.border}`,
                display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <button onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}
                  style={{background:C.card, border:`1px solid ${C.border}`, borderRadius:4,
                    padding:'4px 10px', color:page===0?C.hint:C.text, cursor:page===0?'default':'pointer',
                    fontSize:12}}>
                  ← Prev
                </button>
                <span style={{fontSize:11, color:C.muted}}>
                  {page+1} / {totalPages} · {filtered.length} stocks
                </span>
                <button onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} 
                  disabled={page>=totalPages-1}
                  style={{background:C.card, border:`1px solid ${C.border}`, borderRadius:4,
                    padding:'4px 10px', 
                    color:page>=totalPages-1?C.hint:C.text, 
                    cursor:page>=totalPages-1?'default':'pointer',
                    fontSize:12}}>
                  Next →
                </button>
              </div>
            )}
          </div>
            </>
          )}

          {homeTab==='sectors' && (
          <div style={{background:C.surface, border:`1px solid ${C.border}`,
            borderRadius:8, overflow:'hidden'}}>
            <div style={{padding:'10px 12px', borderBottom:`1px solid ${C.border}`,
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:12, flexWrap:'wrap'}}>
              <span style={{fontSize:11, fontWeight:600, color:C.muted,
                textTransform:'uppercase', letterSpacing:'0.07em'}}>
                Nifty Sector Performance
              </span>
              <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
                {['1D','1W','1M','3M'].map(tf=>(
                  <button key={tf} onClick={()=>setSectorTf(tf)}
                    style={{fontSize:11, padding:'3px 8px', borderRadius:4,
                      border:`1px solid ${C.border}`,
                      background: sectorTf===tf ? C.border : 'transparent',
                      color: sectorTf===tf ? C.text : C.muted,
                      cursor:'pointer'}}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            {sortedSectors.length===0 ? (
              <div style={{padding:16, color:C.hint, fontSize:12, textAlign:'center'}}>
                No sector data available
              </div>
            ) : (
              <div style={{
                display:'grid',
                gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',
                gap:8,
                padding:12,
              }}>
                {sortedSectors.map(sec=>{
                  const chg = sec[sectorKey]
                  const isPos = (chg||0)>=0
                  return (
                    <div key={sec.index_name} style={{
                      padding:'10px 12px',
                      border:`1px solid ${C.border}`,
                      borderRadius:8,
                      background:C.card,
                      display:'flex', alignItems:'center', gap:10,
                    }}>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{fontSize:12, color:C.text, fontWeight:500,
                          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                          {sec.display_name||sec.index_name}
                        </div>
                        <div style={{width:'100%', height:4, background:C.border,
                          borderRadius:2, marginTop:6, overflow:'hidden'}}>
                          <div style={{height:'100%', borderRadius:2,
                            background: isPos ? C.green : C.red,
                            width: Math.min(Math.abs(chg||0)*8, 100)+'%'}}/>
                        </div>
                      </div>
                      <span style={{fontSize:13, fontWeight:700, flexShrink:0, minWidth:56,
                        textAlign:'right', fontFamily:'DM Mono,monospace',
                        color: isPos ? C.green : C.red}}>
                        {chg!=null ? (isPos?'+':'')+chg.toFixed(2)+'%' : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          )}

        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100%{opacity:.4} 50%{opacity:.7}
        }
        input::placeholder{color:#475569}
        input:focus{border-color:#2D3748!important}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#1E2530;border-radius:2px}
      `}</style>
    </div>
  )
}
