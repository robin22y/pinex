import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import DeliveryPanel from '../components/DeliveryPanel'
import { supabase } from '../lib/supabaseClient'

const C = {
  bg: '#0B0E11', surface: '#0F1217', card: '#141820',
  border: '#1E2530', text: '#E2E8F0', muted: '#64748B',
  hint: '#475569', green: '#00C805', red: '#FF3B30',
  blue: '#60A5FA', amber: '#FBBF24',
}

const fmt = (n, d=2) => n==null ? '—' :
  '₹'+Number(n).toLocaleString('en-IN',
    {maximumFractionDigits:d})
const fmtN = (n, d=1) => n==null ? '—' :
  Number(n).toLocaleString('en-IN',
    {maximumFractionDigits:d})
const fmtPct = (n, d=1) => n==null ? '—' :
  (n>0?'+':'')+Number(n).toFixed(d)+'%'
const fmtCr = (n) => {
  if(!n) return '—'
  if(n>=10000000) return '₹'+(n/10000000).toFixed(1)+' Cr'
  if(n>=100000) return '₹'+(n/100000).toFixed(1)+'L'
  if(n>=1000) return '₹'+(n/1000).toFixed(0)+'K'
  return '₹'+n.toFixed(0)
}
const fmtDeliveryDate = (d) => {
  if(!d) return '—'
  const dt = new Date(`${String(d).slice(0, 10)}T00:00:00`)
  if(Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-IN',
    {day:'numeric', month:'short', year:'numeric'})
}
const fmtShares = (n) => {
  if(n==null) return '—'
  const v = Number(n)
  if(!Number.isFinite(v)) return '—'
  if(v>=10000000) return (v/10000000).toFixed(2)+' Cr'
  if(v>=100000) return (v/100000).toFixed(2)+' L'
  if(v>=1000) return (v/1000).toFixed(1)+' K'
  return Math.round(v).toLocaleString('en-IN')
}
const timeAgo = (d) => {
  if(!d) return ''
  const diff = Date.now()-new Date(d)
  const h = Math.floor(diff/3600000)
  const days = Math.floor(diff/86400000)
  if(h<1) return Math.floor(diff/60000)+'m ago'
  if(h<24) return h+'h ago'
  if(days<7) return days+'d ago'
  return new Date(d).toLocaleDateString('en-IN',
    {day:'numeric',month:'short'})
}

const StagePill = ({stage}) => {
  const m = {
    'Stage 2':{bg:'rgba(0,200,5,.12)',c:'#00C805',
               b:'rgba(0,200,5,.3)'},
    'Stage 1':{bg:'rgba(96,165,250,.12)',c:'#60A5FA',
               b:'rgba(96,165,250,.3)'},
    'Stage 3':{bg:'rgba(251,191,36,.12)',c:'#FBBF24',
               b:'rgba(251,191,36,.3)'},
    'Stage 4':{bg:'rgba(255,59,48,.12)',c:'#FF3B30',
               b:'rgba(255,59,48,.3)'},
  }
  const s = m[stage]||{bg:'#1E2530',c:'#64748B',b:'#1E2530'}
  return (
    <span style={{background:s.bg,color:s.c,
      border:`1px solid ${s.b}`,fontSize:11,
      fontWeight:700,padding:'3px 10px',
      borderRadius:20,letterSpacing:'0.04em'}}>
      {stage||'Unclassified'}
    </span>
  )
}

const MetricCard = ({label,value,sub,color}) => (
  <div style={{background:C.card,borderRadius:8,
    padding:'12px 14px',border:`1px solid ${C.border}`}}>
    <div style={{fontSize:10,color:C.muted,
      textTransform:'uppercase',letterSpacing:'0.07em',
      marginBottom:6}}>
      {label}
    </div>
    <div style={{fontSize:16,fontWeight:700,
      color:color||C.text}}>
      {value}
    </div>
    {sub && (
      <div style={{fontSize:11,color:C.muted,marginTop:3}}>
        {sub}
      </div>
    )}
  </div>
)

const SectionHeader = ({title,color}) => (
  <div style={{fontSize:10,color:color||C.muted,
    fontWeight:700,textTransform:'uppercase',
    letterSpacing:'0.08em',marginBottom:12}}>
    {title}
  </div>
)

export default function StockDetail() {
  const {symbol} = useParams()
  const navigate = useNavigate()
  const tabRef = useRef(null)
  const [company,setCompany] = useState(null)
  const [price,setPrice] = useState(null)
  const [shareholding,setShareholding] = useState([])
  const [financials,setFinancials] = useState([])
  const [news,setNews] = useState([])
  const [delivery,setDelivery] = useState(null)
  const [latestDeliveryDay,setLatestDeliveryDay] = useState(null)
  const [changes,setChanges] = useState(null)
  const [watching,setWatching] = useState(false)
  const [loading,setLoading] = useState(true)
  const [activeTab,setActiveTab] = useState('overview')
  const sym = symbol?.toUpperCase()

  useEffect(()=>{
    if(!sym) return
    const load = async()=>{
      setLoading(true)
      const {data:co} = await supabase
        .from('companies')
        .select('*')
        .eq('symbol',sym)
        .single()
      if(!co){setLoading(false);return}
      setCompany(co)
      const [
        {data:pd},{data:sh},{data:fin},
        {data:nws},{data:del},{data:chg},
        {data:latestDay}
      ] = await Promise.all([
        supabase.from('price_data').select('*')
          .eq('company_id',co.id)
          .eq('is_latest',true).single(),
        supabase.from('shareholding').select('*')
          .eq('company_id',co.id)
          .order('quarter',{ascending:false}).limit(6),
        supabase.from('financials').select('*')
          .eq('company_id',co.id)
          .order('quarter',{ascending:false}).limit(8),
        supabase.from('stock_news').select('*')
          .eq('company_id',co.id)
          .order('published_at',{ascending:false})
          .limit(10),
        supabase.from('delivery_signals').select('*')
          .eq('company_id',co.id)
          .order('date',{ascending:false}).single(),
        supabase.from('quarterly_changes').select('*')
          .eq('company_id',co.id)
          .order('created_at',{ascending:false}).single(),
        supabase.from('delivery_data').select(
          'date,delivery_pct,delivery_volume,total_volume,vs_30d_avg,ai_insight')
          .eq('company_id',co.id)
          .order('date',{ascending:false})
          .limit(1)
          .maybeSingle(),
      ])
      setPrice(pd)
      setShareholding(sh||[])
      setFinancials(fin||[])
      setNews(nws||[])
      setDelivery(del)
      setLatestDeliveryDay(latestDay)
      setChanges(chg)
      setLoading(false)
    }
    load()
  },[sym])

  const pct_from_ma = price?.close && price?.ma30w
    ? ((price.close-price.ma30w)/price.ma30w*100) : null
  const latest_sh = shareholding[0]||{}
  const prev_sh = shareholding[1]||{}
  const ttm_rev = financials.slice(0,4)
    .reduce((s,r)=>s+(r.revenue||0),0)
  const ttm_pat = financials.slice(0,4)
    .reduce((s,r)=>s+(r.pat||0),0)
  const sessionDate = latestDeliveryDay?.date || delivery?.date
  const sessionPct = latestDeliveryDay?.delivery_pct
    ?? delivery?.delivery_pct_today
  const sessionDelVol = latestDeliveryDay?.delivery_volume
  const sessionTotalVol = latestDeliveryDay?.total_volume
  const sessionVs30d = latestDeliveryDay?.vs_30d_avg

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setTimeout(()=>{
      if(tabRef.current){
        tabRef.current.scrollIntoView(
          {behavior:'smooth',block:'start'})
      }
    },50)
  }

  if(loading) return (
    <div style={{background:C.bg,height:'100vh',
      display:'flex',alignItems:'center',
      justifyContent:'center',color:C.muted,
      fontSize:14,fontFamily:'DM Sans,system-ui'}}>
      Loading {sym}...
    </div>
  )

  if(!company) return (
    <div style={{background:C.bg,height:'100vh',
      display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',
      color:C.muted,fontSize:14,
      fontFamily:'DM Sans,system-ui',gap:12}}>
      <span>Stock not found: {sym}</span>
      <button onClick={()=>navigate('/')}
        style={{color:C.blue,background:'none',
          border:'none',cursor:'pointer',fontSize:13}}>
        ← Back to Home
      </button>
    </div>
  )

  return (
    <div style={{background:C.bg,color:C.text,
      minHeight:'100vh',fontSize:13,
      fontFamily:'DM Sans,system-ui,sans-serif'}}>

      {/* ── STICKY HEADER ── */}
      <div style={{position:'sticky',top:0,zIndex:50,
        background:C.bg,
        borderBottom:`1px solid ${C.border}`}}>

        {/* Nav row */}
        <div style={{display:'flex',alignItems:'center',
          justifyContent:'space-between',
          padding:'0 16px',height:52}}>

          {/* Left */}
          <div style={{display:'flex',
            alignItems:'center',gap:10}}>
            <button onClick={()=>navigate(-1)}
              style={{width:36,height:36,display:'flex',
                alignItems:'center',justifyContent:'center',
                background:'none',border:'none',
                cursor:'pointer',color:C.muted,
                borderRadius:6}}>
              <i className="ti ti-arrow-left"
                style={{fontSize:20}}/>
            </button>
            <div>
              <div style={{display:'flex',
                alignItems:'center',gap:8}}>
                <span style={{fontSize:18,fontWeight:800,
                  letterSpacing:'-0.02em'}}>
                  {sym}
                </span>
                <StagePill stage={price?.stage}/>
              </div>
              <div style={{fontSize:11,color:C.muted,
                marginTop:1}}>
                {company.name} · {company.sector}
              </div>
            </div>
          </div>

          {/* Right: price + actions */}
          <div style={{display:'flex',
            alignItems:'center',gap:8}}>
            <div style={{textAlign:'right',
              marginRight:8}}>
              <div style={{fontSize:20,fontWeight:800,
                fontFamily:'DM Mono,monospace',
                color:pct_from_ma>5?C.green:
                      pct_from_ma<-5?C.red:C.text}}>
                {fmt(price?.close)}
              </div>
              <div style={{fontSize:11,
                color:pct_from_ma>0?C.green:C.red}}>
                {pct_from_ma!=null
                  ?(pct_from_ma>0?'+':'')+
                    pct_from_ma.toFixed(1)
                    +'% vs 30W MA'
                  :''}
              </div>
            </div>
            <button onClick={()=>navigate('/')}
              style={{width:36,height:36,display:'flex',
                alignItems:'center',justifyContent:'center',
                background:'none',border:'none',
                cursor:'pointer',color:C.muted,
                borderRadius:6}}>
              <i className="ti ti-home"
                style={{fontSize:18}}/>
            </button>
            <button
              style={{width:36,height:36,display:'flex',
                alignItems:'center',justifyContent:'center',
                background:'none',border:'none',
                cursor:'pointer',
                color:watching?C.green:C.muted,
                borderRadius:6}}>
              <i className={watching
                ?'ti ti-bookmark-filled'
                :'ti ti-bookmark'}
                style={{fontSize:18}}/>
            </button>
          </div>
        </div>

        {/* Verdict badges */}
        <div style={{padding:'0 16px 10px',
          display:'flex',gap:6,flexWrap:'wrap'}}>
          {[
            {show:true,
             bg:price?.stage==='Stage 2'
               ?'rgba(0,200,5,.1)'
               :price?.stage==='Stage 4'
               ?'rgba(255,59,48,.1)'
               :'rgba(96,165,250,.1)',
             color:price?.stage==='Stage 2'?C.green
               :price?.stage==='Stage 4'?C.red:C.blue,
             label:price?.stage||'Unclassified'},
            {show:delivery?.avg_delivery_30d!=null,
             bg:delivery?.avg_delivery_30d>55
               ?'rgba(0,200,5,.1)'
               :'rgba(100,116,139,.1)',
             color:delivery?.avg_delivery_30d>55
               ?C.green:C.muted,
             label:`Del ${delivery?.avg_delivery_30d
               ?.toFixed(1)||'—'}% (30D)`},
            {show:latest_sh.promoter_pledge_pct!=null,
             bg:latest_sh.promoter_pledge_pct>0
               ?'rgba(255,59,48,.1)'
               :'rgba(0,200,5,.08)',
             color:latest_sh.promoter_pledge_pct>0
               ?C.red:C.green,
             label:latest_sh.promoter_pledge_pct>0
               ?`⚠ Pledge ${latest_sh
                 .promoter_pledge_pct?.toFixed(1)}%`
               :'✓ No Pledge'},
            {show:price?.rs_vs_nifty!=null,
             bg:price?.rs_vs_nifty>0
               ?'rgba(0,200,5,.08)'
               :'rgba(255,59,48,.08)',
             color:price?.rs_vs_nifty>0?C.green:C.red,
             label:`RS ${fmtPct(price?.rs_vs_nifty)
               } vs Nifty`},
          ].filter(b=>b.show).map((b,i)=>(
            <span key={i} style={{
              background:b.bg,color:b.color,
              border:`1px solid ${b.color}33`,
              fontSize:11,fontWeight:600,
              padding:'4px 12px',borderRadius:20}}>
              {b.label}
            </span>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:'flex',
          borderTop:`1px solid ${C.border}`,
          overflowX:'auto',scrollbarWidth:'none'}}>
          {['Overview','Ownership',
            'Technicals','Delivery','Financials'].map(tab=>(
            <button key={tab}
              onClick={()=>handleTabChange(
                tab.toLowerCase())}
              style={{flex:'none',
                padding:'10px 20px',minHeight:40,
                fontSize:13,
                fontWeight:activeTab===tab.toLowerCase()
                  ?600:400,
                color:activeTab===tab.toLowerCase()
                  ?C.text:C.muted,
                background:'none',border:'none',
                borderBottom:`2px solid ${
                  activeTab===tab.toLowerCase()
                    ?C.green:'transparent'}`,
                cursor:'pointer',
                whiteSpace:'nowrap',
                transition:'color .15s'}}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── TAB CONTENT ── */}
      <div ref={tabRef} style={{maxWidth:1100,
        margin:'0 auto',padding:'16px',
        paddingBottom:80}}>

        {/* ════ OVERVIEW ════ */}
        {activeTab==='overview' && (
          <div style={{display:'flex',
            flexDirection:'column',gap:16}}>

            {/* AI Description */}
            {company.description && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderLeft:`3px solid ${C.green}`,
                borderRadius:8,padding:'14px 16px'}}>
                <SectionHeader title="PineX Intelligence"
                  color={C.green}/>
                <ul style={{listStyle:'none',
                  padding:0,margin:0,
                  display:'flex',flexDirection:'column',
                  gap:10}}>
                  {company.description
                    .split(/\.\s+/)
                    .filter(s=>s.length>40)
                    .slice(0,4)
                    .map((point,i)=>(
                    <li key={i} style={{display:'flex',
                      gap:10,fontSize:13,
                      color:'#94A3B8',lineHeight:1.6}}>
                      <span style={{color:C.green,
                        flexShrink:0,marginTop:2}}>›
                      </span>
                      {point.trim()+'.'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* What Changed */}
            {changes?.headline_change && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderLeft:`3px solid ${C.amber}`,
                borderRadius:8,padding:'14px 16px'}}>
                <SectionHeader
                  title={`What Changed · ${changes.quarter||''}`}
                  color={C.amber}/>
                <div style={{fontSize:14,fontWeight:600,
                  color:C.text,marginBottom:8}}>
                  {changes.headline_change
                    ?.replace(/_/g,' ')}
                </div>
                {changes.ai_summary && (
                  <p style={{fontSize:12,
                    color:'#94A3B8',lineHeight:1.6,
                    margin:0}}>
                    {changes.ai_summary}
                  </p>
                )}
              </div>
            )}

            {/* Analyst consensus */}
            {(company.analyst_strong_buy||
              company.analyst_buy) && (()=>{
              const sb=company.analyst_strong_buy||0
              const b=company.analyst_buy||0
              const h=company.analyst_hold||0
              const s=company.analyst_sell||0
              const total=sb+b+h+s
              if(!total) return null
              const segs=[
                {label:'Strong Buy',count:sb,
                 color:C.green},
                {label:'Buy',count:b,
                 color:'#86EFAC'},
                {label:'Hold',count:h,
                 color:C.amber},
                {label:'Sell',count:s,
                 color:C.red},
              ]
              const buyPct=(sb+b)/total*100
              return (
                <div style={{background:C.surface,
                  border:`1px solid ${C.border}`,
                  borderRadius:8,
                  padding:'14px 16px'}}>
                  <div style={{display:'flex',
                    justifyContent:'space-between',
                    alignItems:'center',
                    marginBottom:12}}>
                    <SectionHeader
                      title={`Analyst Consensus · ${total} analysts`}/>
                    <span style={{fontSize:12,
                      fontWeight:700,
                      color:buyPct>70?C.green:
                            buyPct>50?'#86EFAC':C.amber,
                      padding:'3px 10px',
                      borderRadius:20,
                      background:buyPct>70
                        ?'rgba(0,200,5,.1)'
                        :'rgba(251,191,36,.1)'}}>
                      {buyPct>70?'Strong Buy':
                       buyPct>50?'Buy':'Mixed'}
                    </span>
                  </div>
                  <div style={{display:'flex',
                    height:8,borderRadius:4,
                    overflow:'hidden',
                    gap:1,marginBottom:10}}>
                    {segs.map(sg=>(
                      <div key={sg.label}
                        style={{flex:sg.count/total,
                          background:sg.color,
                          minWidth:sg.count?2:0}}/>
                    ))}
                  </div>
                  <div style={{display:'flex',
                    gap:16,flexWrap:'wrap'}}>
                    {segs.map(sg=>(
                      <div key={sg.label}
                        style={{display:'flex',
                          alignItems:'center',gap:5}}>
                        <div style={{width:8,height:8,
                          borderRadius:2,
                          background:sg.color}}/>
                        <span style={{fontSize:11,
                          color:C.muted}}>
                          {sg.label}:
                        </span>
                        <span style={{fontSize:11,
                          fontWeight:600,
                          color:sg.color}}>
                          {sg.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* News */}
            <div style={{background:C.surface,
              border:`1px solid ${C.border}`,
              borderRadius:8,padding:'14px 16px'}}>
              <SectionHeader title="Recent News"/>
              {news.length===0
                ? <p style={{fontSize:12,
                    color:C.hint,textAlign:'center',
                    padding:'16px 0',margin:0}}>
                    No recent news available.
                    News updates daily after market close.
                  </p>
                : news.map((item,i)=>(
                  <div key={i}
                    onClick={()=>{
                      const url=item.url?.startsWith('http')
                        ?item.url
                        :'https://www.livemint.com'
                          +(item.url||'')
                      window.open(url,'_blank')
                    }}
                    style={{display:'flex',gap:12,
                      padding:'10px 0',cursor:'pointer',
                      borderBottom:i<news.length-1
                        ?`1px solid ${C.border}`:'none'}}
                    onMouseEnter={e=>
                      e.currentTarget.style.opacity='.8'}
                    onMouseLeave={e=>
                      e.currentTarget.style.opacity='1'}>
                    {item.image_url && (
                      <img src={item.image_url}
                        style={{width:54,height:54,
                          borderRadius:6,
                          objectFit:'cover',
                          flexShrink:0}}
                        onError={e=>
                          e.target.style.display='none'}/>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:10,
                        color:C.hint,marginBottom:3}}>
                        {timeAgo(item.published_at)}
                        {item.source&&
                          ` · ${item.source}`}
                      </div>
                      <div style={{fontSize:13,
                        fontWeight:500,color:C.text,
                        lineHeight:1.4,overflow:'hidden',
                        display:'-webkit-box',
                        WebkitLineClamp:2,
                        WebkitBoxOrient:'vertical'}}>
                        {item.title}
                      </div>
                      {item.summary && (
                        <div style={{fontSize:11,
                          color:C.muted,marginTop:3,
                          overflow:'hidden',
                          display:'-webkit-box',
                          WebkitLineClamp:1,
                          WebkitBoxOrient:'vertical'}}>
                          {item.summary}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* ════ OWNERSHIP ════ */}
        {activeTab==='ownership' && (
          <div style={{display:'flex',
            flexDirection:'column',gap:16}}>

            {/* Shareholding snapshot */}
            <div style={{background:C.surface,
              border:`1px solid ${C.border}`,
              borderRadius:8,padding:'14px 16px'}}>
              <div style={{display:'flex',
                justifyContent:'space-between',
                alignItems:'center',marginBottom:14}}>
                <SectionHeader
                  title="Shareholding Pattern"/>
                {latest_sh.quarter && (
                  <span style={{fontSize:11,
                    color:C.hint}}>
                    {latest_sh.quarter}
                  </span>
                )}
              </div>

              {/* 4 big boxes */}
              <div style={{display:'grid',
                gridTemplateColumns:
                  'repeat(4,1fr)',gap:8,
                marginBottom:16}}>
                {[
                  {label:'Promoter',
                   val:latest_sh.promoter_pct,
                   prev:prev_sh.promoter_pct,
                   color:'#8B5CF6'},
                  {label:'FII',
                   val:latest_sh.fii_pct,
                   prev:prev_sh.fii_pct,
                   color:C.blue},
                  {label:'DII',
                   val:latest_sh.dii_pct,
                   prev:prev_sh.dii_pct,
                   color:C.green},
                  {label:'Public',
                   val:latest_sh.public_pct,
                   prev:prev_sh.public_pct,
                   color:C.muted},
                ].map(sh=>{
                  const chg=sh.val!=null&&sh.prev!=null
                    ?(sh.val-sh.prev):null
                  return (
                    <div key={sh.label}
                      style={{background:C.card,
                        borderRadius:8,
                        padding:'12px 14px',
                        border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:10,
                        color:C.muted,
                        textTransform:'uppercase',
                        letterSpacing:'0.07em',
                        marginBottom:6}}>
                        {sh.label}
                      </div>
                      <div style={{fontSize:18,
                        fontWeight:700,
                        color:sh.color,
                        marginBottom:4}}>
                        {sh.val?.toFixed(2)||'—'}%
                      </div>
                      {chg!=null && (
                        <div style={{fontSize:11,
                          color:chg>0?C.green:
                                chg<0?C.red:C.hint}}>
                          {chg>0?'↑ +':'↓ '}
                          {Math.abs(chg).toFixed(2)}%
                          {' QoQ'}
                        </div>
                      )}
                      <div style={{height:3,
                        background:C.border,
                        borderRadius:2,marginTop:8,
                        overflow:'hidden'}}>
                        <div style={{height:'100%',
                          background:sh.color,
                          borderRadius:2,
                          width:Math.min(
                            sh.val||0,100)+'%'}}/>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pledge warning */}
              {latest_sh.promoter_pledge_pct>0 && (
                <div style={{
                  background:'rgba(255,59,48,.08)',
                  border:'1px solid rgba(255,59,48,.25)',
                  borderRadius:6,padding:'10px 14px'}}>
                  <span style={{color:C.red,
                    fontSize:13,fontWeight:600}}>
                    ⚠ Promoter pledge:{' '}
                    {latest_sh.promoter_pledge_pct
                      ?.toFixed(1)}%
                  </span>
                  <span style={{color:'#94A3B8',
                    fontSize:11,marginLeft:8}}>
                    Risk of forced selling if stock falls
                  </span>
                </div>
              )}
            </div>

            {/* Quarterly history table */}
            {shareholding.length>1 && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderRadius:8,overflow:'hidden'}}>
                <div style={{padding:'12px 16px',
                  borderBottom:`1px solid ${C.border}`}}>
                  <SectionHeader
                    title="Quarterly Trend"/>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',
                    borderCollapse:'collapse'}}>
                    <thead>
                      <tr style={{background:C.card,
                        borderBottom:
                          `1px solid ${C.border}`}}>
                        {['Quarter','Promoter',
                          'FII','DII',
                          'Public','Pledge']
                          .map(h=>(
                          <th key={h} style={{
                            padding:'8px 14px',
                            fontSize:10,color:C.hint,
                            fontWeight:400,
                            textTransform:'uppercase',
                            textAlign:h==='Quarter'
                              ?'left':'right'}}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shareholding.map((r,i)=>{
                        const prev=shareholding[i+1]
                        const chgP=prev
                          ?(r.promoter_pct||0)
                            -(prev.promoter_pct||0)
                          :null
                        return (
                          <tr key={i} style={{
                            borderBottom:
                              `1px solid ${C.card}`}}>
                            <td style={{
                              padding:'8px 14px',
                              fontSize:12,
                              color:C.muted,
                              fontWeight:500}}>
                              {r.quarter}
                            </td>
                            <td style={{
                              padding:'8px 14px',
                              fontSize:12,
                              textAlign:'right'}}>
                              <span style={{
                                color:C.text,
                                fontWeight:500}}>
                                {r.promoter_pct
                                  ?.toFixed(2)||'—'}%
                              </span>
                              {chgP!=null && (
                                <span style={{
                                  fontSize:10,
                                  marginLeft:6,
                                  color:chgP>0?C.green:
                                        chgP<0?C.red:
                                        C.hint}}>
                                  {chgP>0?'↑':
                                   chgP<0?'↓':'→'}
                                </span>
                              )}
                            </td>
                            {[r.fii_pct,r.dii_pct,
                              r.public_pct].map((v,j)=>(
                              <td key={j} style={{
                                padding:'8px 14px',
                                fontSize:12,
                                textAlign:'right',
                                color:C.text}}>
                                {v?.toFixed(2)||'—'}%
                              </td>
                            ))}
                            <td style={{
                              padding:'8px 14px',
                              fontSize:12,
                              textAlign:'right',
                              color:r.promoter_pledge_pct>0
                                ?C.red:C.hint,
                              fontWeight:r
                                .promoter_pledge_pct>0
                                ?600:400}}>
                              {r.promoter_pledge_pct
                                ?.toFixed(1)||'—'}%
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ TECHNICALS ════ */}
        {activeTab==='technicals' && (
          <div style={{display:'flex',
            flexDirection:'column',gap:16}}>

            {/* Price metrics */}
            <div>
              <SectionHeader title="Price & Trend"/>
              <div style={{display:'grid',
                gridTemplateColumns:
                  'repeat(auto-fill,minmax(155px,1fr))',
                gap:8}}>
                <MetricCard label="Current Price"
                  value={fmt(price?.close)}
                  color={pct_from_ma>5?C.green:
                         pct_from_ma<-5?C.red:C.text}/>
                <MetricCard label="% from 30W MA"
                  value={fmtPct(pct_from_ma)}
                  sub={`MA: ${fmt(price?.ma30w)}`}
                  color={pct_from_ma>5?C.green:
                         pct_from_ma>-3?C.amber:C.red}/>
                <MetricCard label="MA30W Slope"
                  value={price?.ma30w_slope
                    ?.toFixed(2)+'%'||'—'}
                  sub={price?.ma30w_slope>0
                    ?'Rising':'Falling'}
                  color={price?.ma30w_slope>0
                    ?C.green:C.red}/>
                <MetricCard label="RSI"
                  value={price?.rsi?.toFixed(1)||'—'}
                  sub={price?.rsi>70?'Overbought':
                       price?.rsi<30?'Oversold':
                       'Neutral zone'}
                  color={price?.rsi>70?C.red:
                         price?.rsi<30?C.green:C.muted}/>
                <MetricCard label="RS vs Nifty"
                  value={fmtPct(price?.rs_vs_nifty)}
                  sub={price?.rs_vs_nifty>0
                    ?'Outperforming':'Underperforming'}
                  color={price?.rs_vs_nifty>0
                    ?C.green:C.red}/>
                <MetricCard label="OBV Trend"
                  value={price?.obv_slope>0.02
                    ?'↑ Rising'
                    :price?.obv_slope<-0.02
                    ?'↓ Falling':'→ Flat'}
                  color={price?.obv_slope>0.02?C.green:
                         price?.obv_slope<-0.02
                         ?C.red:C.muted}/>
                <MetricCard label="52W High"
                  value={fmt(price?.high_52w)}
                  sub={price?.close&&price?.high_52w
                    ?fmtPct((price.close-price.high_52w)
                      /price.high_52w*100)
                      +' from high':null}
                  color={C.muted}/>
                <MetricCard label="52W Low"
                  value={fmt(price?.low_52w)}
                  sub={price?.close&&price?.low_52w
                    ?('+'+((price.close-price.low_52w)
                      /price.low_52w*100).toFixed(1)
                      +'% above low'):null}
                  color={C.muted}/>
              </div>
            </div>
          </div>
        )}

        {/* ════ DELIVERY ════ */}
        {activeTab==='delivery' && (
          <div style={{display:'flex',
            flexDirection:'column',gap:16}}>

            {sessionDate && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderRadius:8,padding:'14px 16px'}}>
                <SectionHeader
                  title={`Latest Session · ${fmtDeliveryDate(sessionDate)}`}/>
                <div style={{display:'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill,minmax(130px,1fr))',
                  gap:8}}>
                  {[
                    {label:'Delivery %',
                     value:sessionPct!=null
                       ? Number(sessionPct).toFixed(1)+'%'
                       :'—',
                     color:sessionPct>55?C.green:
                           sessionPct<30?C.red:C.text},
                    {label:'Delivered Volume',
                     value:fmtShares(sessionDelVol),
                     color:C.text},
                    {label:'Total Volume',
                     value:fmtShares(sessionTotalVol),
                     color:C.muted},
                    {label:'vs 30D Avg',
                     value:sessionVs30d!=null
                       ? Number(sessionVs30d).toFixed(2)+'x'
                       :'—',
                     color:sessionVs30d>1.2?C.green:
                           sessionVs30d<0.8?C.red:C.muted},
                  ].map(item=>(
                    <div key={item.label}
                      style={{background:C.card,
                        borderRadius:6,
                        padding:'10px 12px',
                        border:`1px solid ${C.border}`}}>
                      <div style={{fontSize:10,
                        color:C.muted,marginBottom:4,
                        textTransform:'uppercase',
                        letterSpacing:'0.06em'}}>
                        {item.label}
                      </div>
                      <div style={{fontSize:14,
                        fontWeight:700,color:item.color}}>
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {delivery && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderRadius:8,padding:'14px 16px'}}>
                <SectionHeader
                  title="Delivery Signals"/>

                {/* Period grid */}
                <div style={{display:'grid',
                  gridTemplateColumns:
                    'repeat(auto-fill,minmax(130px,1fr))',
                  gap:8,marginBottom:12}}>
                  {[
                    {label:'7D Avg Del%',
                     val:delivery.avg_delivery_7d,
                     fmt:(v)=>v?.toFixed(1)+'%',
                     good:(v)=>v>50},
                    {label:'30D Avg Del%',
                     val:delivery.avg_delivery_30d,
                     fmt:(v)=>v?.toFixed(1)+'%',
                     good:(v)=>v>50},
                    {label:'60D Avg Del%',
                     val:delivery.avg_delivery_60d,
                     fmt:(v)=>v?.toFixed(1)+'%',
                     good:(v)=>v>50},
                    {label:'90D Avg Del%',
                     val:delivery.avg_delivery_90d,
                     fmt:(v)=>v?.toFixed(1)+'%',
                     good:(v)=>v>50},
                    {label:'7D Avg Volume',
                     val:delivery.avg_volume_7d,
                     fmt:(v)=>fmtCr(v),
                     good:()=>null},
                    {label:'30D Avg Volume',
                     val:delivery.avg_volume_30d,
                     fmt:(v)=>fmtCr(v),
                     good:()=>null},
                    {label:'Vol Ratio',
                     val:delivery.vol_ratio,
                     fmt:(v)=>v?.toFixed(2)+'x',
                     good:(v)=>v>1.5},
                    {label:'Del Trend (30D)',
                     val:delivery.delivery_trend_30d,
                     fmt:(v)=>v||'—',
                     good:(v)=>v==='rising'},
                  ].map(d=>{
                    const isGood=d.good(d.val)
                    return (
                      <div key={d.label}
                        style={{background:C.card,
                          borderRadius:6,
                          padding:'10px 12px',
                          border:`1px solid ${C.border}`}}>
                        <div style={{fontSize:10,
                          color:C.muted,marginBottom:4,
                          textTransform:'uppercase',
                          letterSpacing:'0.06em'}}>
                          {d.label}
                        </div>
                        <div style={{fontSize:14,
                          fontWeight:700,
                          color:isGood===true?C.green:
                                isGood===false?C.red:
                                C.text}}>
                          {d.val!=null
                            ?d.fmt(d.val):'—'}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Signal badges */}
                <div style={{display:'flex',
                  gap:8,flexWrap:'wrap'}}>
                  {[
                    {show:delivery.is_accumulation,
                     label:'Accumulation',
                     color:C.green,
                     bg:'rgba(0,200,5,.1)'},
                    {show:delivery.is_distribution,
                     label:'Distribution',
                     color:C.red,
                     bg:'rgba(255,59,48,.1)'},
                    {show:delivery.breakout_30wma,
                     label:'30W MA Breakout',
                     color:C.green,
                     bg:'rgba(0,200,5,.1)'},
                    {show:delivery.breakdown_30wma,
                     label:'30W MA Breakdown',
                     color:C.red,
                     bg:'rgba(255,59,48,.1)'},
                    {show:delivery.breakout_50dma,
                     label:'50D MA Breakout',
                     color:C.blue,
                     bg:'rgba(96,165,250,.1)'},
                    {show:delivery.breakdown_50dma,
                     label:'50D MA Breakdown',
                     color:C.amber,
                     bg:'rgba(251,191,36,.1)'},
                  ].filter(s=>s.show).map((s,i)=>(
                    <span key={i} style={{
                      background:s.bg,color:s.color,
                      border:`1px solid ${s.color}44`,
                      fontSize:11,fontWeight:600,
                      padding:'4px 12px',
                      borderRadius:20}}>
                      {s.label}
                    </span>
                  ))}
                  {![delivery.is_accumulation,
                     delivery.is_distribution,
                     delivery.breakout_30wma,
                     delivery.breakdown_30wma,
                     delivery.breakout_50dma,
                     delivery.breakdown_50dma]
                    .some(Boolean) && (
                    <span style={{color:C.hint,
                      fontSize:12}}>
                      No active signals
                    </span>
                  )}
                </div>
              </div>
            )}

            <div style={{background:C.surface,
              border:`1px solid ${C.border}`,
              borderRadius:8,padding:'14px 16px'}}>
              <SectionHeader title="Detailed Delivery Data"/>
              <DeliveryPanel
                companyId={company.id}
                symbol={sym}
                latestStage={price?.stage}
                embedded
                hideExplain
              />
            </div>
          </div>
        )}

        {/* ════ FINANCIALS ════ */}
        {activeTab==='financials' && (
          <div style={{display:'flex',
            flexDirection:'column',gap:16}}>

            {/* TTM Summary */}
            <div>
              <SectionHeader
                title="Trailing 12 Months (TTM)"/>
              <div style={{display:'grid',
                gridTemplateColumns:
                  'repeat(auto-fill,minmax(155px,1fr))',
                gap:8}}>
                <MetricCard label="Revenue TTM"
                  value={fmtCr(ttm_rev)}
                  sub="Last 4 quarters"/>
                <MetricCard label="PAT TTM"
                  value={fmtCr(ttm_pat)}
                  sub="Net profit TTM"
                  color={ttm_pat>0?C.green:C.red}/>
                {financials[0]?.margin!=null && (
                  <MetricCard label="Oper. Margin"
                    value={financials[0].margin
                      ?.toFixed(1)+'%'}
                    color={financials[0].margin>20
                      ?C.green:financials[0].margin>10
                      ?C.text:C.red}/>
                )}
                {financials[0]?.revenue_growth_yoy
                  !=null && (
                  <MetricCard label="Rev Growth YoY"
                    value={fmtPct(
                      financials[0].revenue_growth_yoy)}
                    color={financials[0]
                      .revenue_growth_yoy>0
                      ?C.green:C.red}/>
                )}
                {financials[0]?.pat_growth_yoy
                  !=null && (
                  <MetricCard label="PAT Growth YoY"
                    value={fmtPct(
                      financials[0].pat_growth_yoy)}
                    color={financials[0]
                      .pat_growth_yoy>0
                      ?C.green:C.red}/>
                )}
                {financials[0]?.eps!=null && (
                  <MetricCard label="EPS (Latest Q)"
                    value={'₹'+financials[0].eps
                      ?.toFixed(2)}/>
                )}
              </div>
            </div>

            {/* Quarterly table */}
            {financials.length>0 && (
              <div style={{background:C.surface,
                border:`1px solid ${C.border}`,
                borderRadius:8,overflow:'hidden'}}>
                <div style={{padding:'12px 16px',
                  borderBottom:
                    `1px solid ${C.border}`}}>
                  <SectionHeader
                    title="Quarterly Results"/>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',
                    borderCollapse:'collapse',
                    minWidth:600}}>
                    <thead>
                      <tr style={{background:C.card,
                        borderBottom:
                          `1px solid ${C.border}`}}>
                        {['Quarter','Revenue',
                          'PAT','Margin',
                          'Rev YoY','PAT YoY']
                          .map(h=>(
                          <th key={h} style={{
                            padding:'8px 14px',
                            fontSize:10,color:C.hint,
                            fontWeight:400,
                            textTransform:'uppercase',
                            textAlign:h==='Quarter'
                              ?'left':'right'}}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {financials.map((r,i)=>(
                        <tr key={i} style={{
                          borderBottom:
                            `1px solid ${C.card}`}}
                          onMouseEnter={e=>
                            e.currentTarget.style
                              .background=C.card}
                          onMouseLeave={e=>
                            e.currentTarget.style
                              .background='transparent'}>
                          <td style={{padding:'9px 14px',
                            fontSize:12,color:C.muted,
                            fontWeight:500}}>
                            {r.quarter}
                          </td>
                          <td style={{padding:'9px 14px',
                            fontSize:12,
                            textAlign:'right',
                            color:C.text}}>
                            {fmtCr(r.revenue)}
                          </td>
                          <td style={{padding:'9px 14px',
                            fontSize:12,
                            textAlign:'right',
                            fontWeight:600,
                            color:r.pat>0?C.green:C.red}}>
                            {fmtCr(r.pat)}
                          </td>
                          <td style={{padding:'9px 14px',
                            fontSize:12,
                            textAlign:'right',
                            color:r.margin>20?C.green:
                                  r.margin>10?C.text:
                                  C.red}}>
                            {r.margin?.toFixed(1)||'—'}%
                          </td>
                          <td style={{padding:'9px 14px',
                            fontSize:12,
                            textAlign:'right',
                            fontWeight:500,
                            color:r.revenue_growth_yoy>0
                              ?C.green:
                               r.revenue_growth_yoy<0
                              ?C.red:C.muted}}>
                            {r.revenue_growth_yoy!=null
                              ?fmtPct(r.revenue_growth_yoy)
                              :'—'}
                          </td>
                          <td style={{padding:'9px 14px',
                            fontSize:12,
                            textAlign:'right',
                            fontWeight:500,
                            color:r.pat_growth_yoy>0
                              ?C.green:
                               r.pat_growth_yoy<0
                              ?C.red:C.muted}}>
                            {r.pat_growth_yoy!=null
                              ?fmtPct(r.pat_growth_yoy)
                              :'—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {financials.length===0 && (
              <div style={{textAlign:'center',
                padding:'32px',color:C.hint,
                fontSize:13}}>
                No financial data available yet
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{
          background:#1E2530;border-radius:2px}
        button{transition:opacity .15s}
        button:hover{opacity:.8}
      `}</style>
    </div>
  )
}