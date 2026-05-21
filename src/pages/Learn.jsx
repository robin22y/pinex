import { useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'

const P = (arr) => arr.map(([x, y]) => `${x},${y}`).join(' ')

// ─── Module 1 charts ─────────────────────────────────────────────────────────

function JourneyChart({ big }) {
  const h = big ? 100 : 82
  const zones = [
    { x: 0,   w: 70,  color: C.textMuted, bg: 'rgba(148,158,171,0.07)', label: 'Stage 1' },
    { x: 70,  w: 95,  color: C.green,     bg: 'rgba(52,211,153,0.07)',  label: 'Stage 2' },
    { x: 165, w: 50,  color: C.amber,     bg: 'rgba(251,191,36,0.07)',  label: 'Stage 3' },
    { x: 215, w: 65,  color: C.red,       bg: 'rgba(248,113,113,0.07)', label: 'Stage 4' },
  ]
  const s1 = [[0,52],[12,49],[24,55],[36,50],[48,55],[60,51],[70,50]]
  const s2 = [[70,50],[84,46],[98,41],[111,36],[124,30],[137,24],[149,20],[159,17],[165,15]]
  const s3 = [[165,15],[173,24],[179,13],[188,27],[194,14],[203,28],[210,16],[215,22]]
  const s4 = [[215,22],[225,30],[232,26],[243,38],[252,45],[260,41],[270,54],[280,67]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox={`0 0 280 ${h}`} width="100%" style={{ display: 'block' }}>
        {zones.map((z, i) => <rect key={i} x={z.x} y={0} width={z.w} height={h} fill={z.bg} />)}
        {[70, 165, 215].map(x => <line key={x} x1={x} y1={0} x2={x} y2={h} stroke={C.border} strokeWidth="0.5" />)}
        {zones.map((z, i) => (
          <text key={i} x={z.x + z.w / 2} y={big ? 14 : 12} textAnchor="middle"
            fontSize={big ? 9 : 8} fontWeight="700" fill={z.color} fontFamily="system-ui,sans-serif">{z.label}</text>
        ))}
        <polyline points={P(s1)} fill="none" stroke={C.textMuted} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s2)} fill="none" stroke={C.green}     strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s3)} fill="none" stroke={C.amber}     strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s4)} fill="none" stroke={C.red}       strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Stage1Chart() {
  const p = [[0,40],[18,36],[32,43],[46,38],[60,44],[74,39],[88,43],[102,37],[116,43],[130,38],[144,44],[158,39],[172,43],[186,37],[200,43],[214,39],[228,44],[242,38],[256,43],[280,40]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 60" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1="40" x2="280" y2="40" stroke={C.border} strokeWidth="0.8" strokeDasharray="5,4" />
        <polyline points={P(p)} fill="none" stroke={C.textMuted} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="8" y="12" fontSize="8" fill={C.textMuted} fontFamily="system-ui,sans-serif" opacity="0.7">Price →</text>
      </svg>
    </div>
  )
}

function Stage2Chart() {
  const price = [[0,58],[22,54],[27,57],[48,49],[63,45],[68,48],[88,39],[104,34],[109,37],[130,27],[146,21],[151,25],[170,16],[186,11],[191,15],[210,8],[225,5],[256,3],[280,3]]
  const ma    = [[0,62],[50,56],[100,48],[150,34],[200,19],[250,8],[280,5]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 68" width="100%" style={{ display: 'block' }}>
        <polyline points={P(ma)} fill="none" stroke={C.green} strokeWidth="1.5" strokeDasharray="6,3" strokeLinejoin="round" opacity="0.4" />
        <polyline points={P(price)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="268" y="22" textAnchor="end" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.65">30W MA ↗</text>
      </svg>
    </div>
  )
}

function Stage3Chart() {
  const p = [[0,35],[14,22],[24,12],[34,28],[44,18],[54,33],[64,19],[74,38],[84,23],[94,42],[104,26],[114,45],[124,30],[134,48],[144,33],[154,46],[164,29],[174,43],[184,26],[194,38],[204,23],[214,35],[224,23],[234,36],[244,24],[254,38],[264,27],[274,34],[280,37]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 60" width="100%" style={{ display: 'block' }}>
        <polyline points={P(p)} fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function Stage4Chart() {
  const p = [[0,8],[16,12],[21,9],[37,17],[51,14],[63,22],[73,20],[88,27],[98,25],[113,32],[123,30],[138,38],[148,36],[163,43],[178,41],[188,48],[203,45],[218,52],[228,50],[243,57],[258,55],[271,62],[280,66]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 75" width="100%" style={{ display: 'block' }}>
        <polyline points={P(p)} fill="none" stroke={C.red} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="272" y1="56" x2="272" y2="70" stroke={C.red} strokeWidth="2" strokeLinecap="round" opacity="0.75" />
        <path d="M266,64 L272,72 L278,64" fill="none" stroke={C.red} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
      </svg>
    </div>
  )
}

// ─── Module 2 charts — Nifty 50 & Market ─────────────────────────────────────

function MelaChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 82" width="100%" style={{ display: 'block' }}>
        <rect x="8" y="4" width="264" height="74" rx="6" fill={C.surface} stroke={C.border} strokeWidth="1" />
        <rect x="8" y="4" width="264" height="16" rx="0" fill={C.border} opacity="0.5" />
        <text x="20" y="15" fontSize="8" fill={C.textMuted} fontFamily="monospace,system-ui" fontWeight="700" letterSpacing="0.5">NSE  ·  LIVE MARKET</text>
        <line x1="16" y1="36" x2="272" y2="36" stroke={C.border} strokeWidth="0.5" />
        <line x1="16" y1="57" x2="272" y2="57" stroke={C.border} strokeWidth="0.5" />
        <text x="18" y="30" fontSize="10" fill={C.text}     fontFamily="system-ui,sans-serif" fontWeight="700">TCS</text>
        <text x="108" y="30" fontSize="9"  fill={C.textMuted} fontFamily="monospace,system-ui">3,842.50</text>
        <text x="220" y="30" fontSize="10" fill={C.green}   fontFamily="system-ui,sans-serif" fontWeight="700">+1.4% ↑</text>
        <text x="18" y="51" fontSize="10" fill={C.text}     fontFamily="system-ui,sans-serif" fontWeight="700">RELIANCE</text>
        <text x="148" y="51" fontSize="9"  fill={C.textMuted} fontFamily="monospace,system-ui">2,910.00</text>
        <text x="220" y="51" fontSize="10" fill={C.red}     fontFamily="system-ui,sans-serif" fontWeight="700">-0.8% ↓</text>
        <text x="18" y="70" fontSize="10" fill={C.text}     fontFamily="system-ui,sans-serif" fontWeight="700">HDFC BK</text>
        <text x="148" y="70" fontSize="9"  fill={C.textMuted} fontFamily="monospace,system-ui">1,620.75</text>
        <text x="220" y="70" fontSize="10" fill={C.green}   fontFamily="system-ui,sans-serif" fontWeight="700">+2.1% ↑</text>
      </svg>
    </div>
  )
}

function NiftyPodiumChart() {
  const names = ['TCS', 'RELIANCE', 'HDFC BANK', 'INFOSYS', '+ 46 more...']
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        {names.map((name, i) => (
          <g key={i}>
            <rect x="8" y={7 + i * 14} width="98" height="11" rx="3" fill={C.border} opacity={i === 4 ? 0.3 : 0.55} />
            <text x="14" y={16 + i * 14} fontSize={i === 4 ? 7 : 8.5}
              fill={i === 4 ? C.textFaint : C.text}
              fontFamily="system-ui,sans-serif" fontWeight={i < 4 ? '600' : '400'}>{name}</text>
          </g>
        ))}
        <path d="M110,12 Q118,12 118,20 L118,34 Q118,44 124,44 Q118,44 118,54 L118,68 Q118,76 110,76"
          fill="none" stroke={C.textMuted} strokeWidth="1.5" strokeLinejoin="round" opacity="0.45" />
        <text x="200" y="28" textAnchor="middle" fontSize="14" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="800">NIFTY 50</text>
        <text x="200" y="41" textAnchor="middle" fontSize="8" fill={C.textMuted} fontFamily="system-ui,sans-serif">Average of top 50</text>
        <path d="M182,70 L200,56 L218,70" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="200" y="79" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif">All doing well → Nifty rises</text>
      </svg>
    </div>
  )
}

function TideChart() {
  const upLines = [
    [[5,60],[25,54],[48,47],[70,40],[92,34],[115,28],[132,22]],
    [[5,64],[25,58],[48,52],[70,46],[92,40],[115,34],[132,28]],
    [[5,67],[25,62],[48,57],[70,52],[92,47],[115,42],[132,37]],
  ]
  const downLines = [
    [[148,22],[168,28],[190,35],[212,41],[234,48],[256,54],[275,60]],
    [[148,28],[168,34],[190,41],[212,47],[234,53],[256,59],[275,65]],
    [[148,32],[168,38],[190,45],[212,51],[234,57],[256,63],[275,68]],
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <rect x="0"   y="0" width="140" height="80" fill="rgba(52,211,153,0.06)" />
        <rect x="140" y="0" width="140" height="80" fill="rgba(248,113,113,0.06)" />
        <line x1="140" y1="0" x2="140" y2="80" stroke={C.border} strokeWidth="0.8" />
        <text x="70"  y="13" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Nifty ↑  Rising Tide</text>
        <text x="210" y="13" textAnchor="middle" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Nifty ↓  Falling Tide</text>
        {upLines.map((pts, i) => (
          <polyline key={i} points={P(pts)} fill="none" stroke={C.green} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={0.4 + i * 0.15} />
        ))}
        {downLines.map((pts, i) => (
          <polyline key={i} points={P(pts)} fill="none" stroke={C.red} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={0.4 + i * 0.15} />
        ))}
        <text x="70"  y="75" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.75">Most stocks rise</text>
        <text x="210" y="75" textAnchor="middle" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif" opacity="0.75">Most stocks fall</text>
      </svg>
    </div>
  )
}

function NiftyStagesChart() {
  const h = 92
  const zones = [
    { x: 0,   w: 70,  color: C.textMuted, bg: 'rgba(148,158,171,0.07)', label: 'Stage 1' },
    { x: 70,  w: 95,  color: C.green,     bg: 'rgba(52,211,153,0.07)',  label: 'Stage 2' },
    { x: 165, w: 50,  color: C.amber,     bg: 'rgba(251,191,36,0.07)',  label: 'Stage 3' },
    { x: 215, w: 65,  color: C.red,       bg: 'rgba(248,113,113,0.07)', label: 'Stage 4' },
  ]
  const s1 = [[0,64],[12,61],[24,67],[36,62],[48,67],[60,63],[70,62]]
  const s2 = [[70,62],[84,57],[98,52],[111,46],[124,40],[137,34],[149,29],[159,25],[165,23]]
  const s3 = [[165,23],[173,32],[179,21],[188,35],[194,22],[203,36],[210,24],[215,30]]
  const s4 = [[215,30],[225,38],[232,34],[243,46],[252,53],[260,49],[270,62],[280,70]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox={`0 0 280 ${h}`} width="100%" style={{ display: 'block' }}>
        {zones.map((z, i) => <rect key={i} x={z.x} y={0} width={z.w} height={h} fill={z.bg} />)}
        {[70, 165, 215].map(x => <line key={x} x1={x} y1={0} x2={x} y2={h} stroke={C.border} strokeWidth="0.5" />)}
        {zones.map((z, i) => (
          <text key={i} x={z.x + z.w / 2} y={12} textAnchor="middle" fontSize="7.5" fontWeight="700" fill={z.color} fontFamily="system-ui,sans-serif">{z.label}</text>
        ))}
        <text x="117" y="23" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Bull Market</text>
        <text x="117" y="32" textAnchor="middle" fontSize="7"   fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.75">Buy stocks</text>
        <text x="247" y="23" textAnchor="middle" fontSize="7.5" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Bear Market</text>
        <text x="247" y="32" textAnchor="middle" fontSize="7"   fill={C.red}   fontFamily="system-ui,sans-serif" opacity="0.75">Be careful</text>
        <text x="8" y={h - 3} fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" opacity="0.5">Nifty 50</text>
        <polyline points={P(s1)} fill="none" stroke={C.textMuted} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s2)} fill="none" stroke={C.green}     strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s3)} fill="none" stroke={C.amber}     strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s4)} fill="none" stroke={C.red}       strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function SensexNiftyChart() {
  const sensexPts = [[14,52],[30,47],[46,50],[62,42],[78,37],[94,41],[110,31],[124,25]]
  const niftyPts  = [[158,52],[174,46],[190,49],[206,41],[222,36],[238,40],[254,30],[268,24]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 72" width="100%" style={{ display: 'block' }}>
        <rect x="4"   y="4" width="128" height="64" rx="6" fill={C.surface} stroke={C.border} strokeWidth="0.8" />
        <text x="14"  y="18" fontSize="10" fill={C.textHeading} fontFamily="system-ui,sans-serif" fontWeight="800">SENSEX</text>
        <text x="14"  y="28" fontSize="7.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">BSE · Top 30 companies</text>
        <polyline points={P(sensexPts)} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="14"  y="64" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">same direction ↑</text>
        <text x="140" y="36" textAnchor="middle" fontSize="18" fill={C.textMuted} fontFamily="system-ui,sans-serif">≈</text>
        <text x="140" y="50" textAnchor="middle" fontSize="7"  fill={C.textFaint} fontFamily="system-ui,sans-serif">same story</text>
        <rect x="148" y="4" width="128" height="64" rx="6" fill={C.surface} stroke={C.border} strokeWidth="0.8" />
        <text x="158" y="18" fontSize="10" fill={C.textHeading} fontFamily="system-ui,sans-serif" fontWeight="800">NIFTY 50</text>
        <text x="158" y="28" fontSize="7.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">NSE · Top 50 companies</text>
        <polyline points={P(niftyPts)} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="158" y="64" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">same direction ↑</text>
      </svg>
    </div>
  )
}

function NiftySummaryChart() {
  const p = [
    [0,52],[14,49],[28,54],[42,50],[56,52],
    [70,47],[84,42],[98,36],[112,30],[126,24],[140,19],[154,15],[168,11],[183,8],
    [195,11],[205,17],[215,25],[225,35],[235,44],[245,53],[255,59],[265,65],[280,68],
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 78" width="100%" style={{ display: 'block' }}>
        <rect x="55"  y="0" width="140" height="78" fill="rgba(52,211,153,0.07)" />
        <rect x="193" y="0" width="87"  height="78" fill="rgba(248,113,113,0.07)" />
        <line x1="55"  y1="0" x2="55"  y2="78" stroke={C.border} strokeWidth="0.5" />
        <line x1="193" y1="0" x2="193" y2="78" stroke={C.border} strokeWidth="0.5" />
        <text x="125" y="12" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Bull Market</text>
        <text x="125" y="22" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.7">Buy confidently</text>
        <text x="236" y="12" textAnchor="middle" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Bear Market</text>
        <text x="236" y="22" textAnchor="middle" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif" opacity="0.7">Protect money</text>
        <polyline points={P(p)} fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="8" y="73" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" opacity="0.5">Nifty 50</text>
      </svg>
    </div>
  )
}

// ─── Module 3 charts — Relative Strength vs Nifty ────────────────────────────

function RSBarChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <line x1="30" y1="73" x2="250" y2="73" stroke={C.border} strokeWidth="1" />
        {/* Nifty bar — shorter */}
        <rect x="50" y="49" width="68" height="24" rx="4" fill={C.blueBg} stroke={C.blue} strokeWidth="1.5" />
        <text x="84" y="45" textAnchor="middle" fontSize="9" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="700">+10%</text>
        <text x="84" y="84" textAnchor="middle" fontSize="9" fill={C.blue} fontFamily="system-ui,sans-serif">Nifty</text>
        {/* Stock bar — taller */}
        <rect x="162" y="13" width="68" height="60" rx="4" fill="rgba(52,211,153,0.15)" stroke={C.green} strokeWidth="1.5" />
        <text x="196" y="9" textAnchor="middle" fontSize="9" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">+25%</text>
        <text x="196" y="84" textAnchor="middle" fontSize="9" fill={C.green} fontFamily="system-ui,sans-serif">Stock</text>
        {/* Arrow label */}
        <line x1="130" y1="38" x2="157" y2="38" stroke={C.green} strokeWidth="1.2" strokeDasharray="3,2" />
        <path d="M154,34 L160,38 L154,42" fill="none" stroke={C.green} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="127" y="32" textAnchor="end" fontSize="8.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Strong RS ↑</text>
        <text x="127" y="44" textAnchor="end" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.8">beating the market</text>
      </svg>
    </div>
  )
}

function RaceChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 78" width="100%" style={{ display: 'block' }}>
        {/* Lane backgrounds */}
        <rect x="8" y="6"  width="234" height="20" rx="3" fill="rgba(52,211,153,0.08)"  stroke="rgba(52,211,153,0.25)"  strokeWidth="0.5" />
        <rect x="8" y="30" width="234" height="20" rx="3" fill="rgba(56,189,248,0.08)"  stroke="rgba(56,189,248,0.25)"  strokeWidth="0.5" />
        <rect x="8" y="54" width="234" height="20" rx="3" fill="rgba(248,113,113,0.08)" stroke="rgba(248,113,113,0.25)" strokeWidth="0.5" />
        {/* Finish line */}
        <line x1="242" y1="4" x2="242" y2="76" stroke={C.textMuted} strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
        <text x="245" y="11" fontSize="7" fill={C.textFaint} fontFamily="system-ui,sans-serif">🏁</text>
        {/* Lane labels */}
        <text x="16" y="16" dominantBaseline="central" fontSize="8.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">High RS Stock</text>
        <text x="16" y="40" dominantBaseline="central" fontSize="8.5" fill={C.blue}  fontFamily="system-ui,sans-serif" fontWeight="700">Nifty (Market)</text>
        <text x="16" y="64" dominantBaseline="central" fontSize="8.5" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Low RS Stock</text>
        {/* Runners */}
        <circle cx="207" cy="16" r="8" fill={C.green} opacity="0.18" />
        <circle cx="207" cy="16" r="6" fill={C.green} opacity="0.85" />
        <text x="207" y="16" textAnchor="middle" dominantBaseline="central" fontSize="7" fill="#000" fontFamily="system-ui,sans-serif" fontWeight="800">1</text>
        <circle cx="158" cy="40" r="8" fill={C.blue} opacity="0.18" />
        <circle cx="158" cy="40" r="6" fill={C.blue} opacity="0.85" />
        <text x="158" y="40" textAnchor="middle" dominantBaseline="central" fontSize="7" fill="#000" fontFamily="system-ui,sans-serif" fontWeight="800">2</text>
        <circle cx="104" cy="64" r="8" fill={C.red} opacity="0.18" />
        <circle cx="104" cy="64" r="6" fill={C.red} opacity="0.85" />
        <text x="104" y="64" textAnchor="middle" dominantBaseline="central" fontSize="7" fill="#000" fontFamily="system-ui,sans-serif" fontWeight="800">3</text>
      </svg>
    </div>
  )
}

function PriceVsRSChart() {
  const pricePts = [[14,38],[45,33],[75,28],[105,22],[135,18],[165,14],[195,10],[230,7]]
  const rsPts    = [[14,56],[45,59],[75,62],[105,66],[135,69],[165,73],[195,77],[230,82]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 96" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0" width="280" height="44" fill="rgba(52,211,153,0.04)" />
        <rect x="0" y="48" width="280" height="48" fill="rgba(248,113,113,0.04)" />
        <line x1="0" y1="46" x2="280" y2="46" stroke={C.border} strokeWidth="1" strokeDasharray="4,3" />
        <text x="10" y="12" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Price ↑  (looks good)</text>
        <polyline points={P(pricePts)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="10" y="59" fontSize="8" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">RS vs Nifty ↓  (actually weak)</text>
        <polyline points={P(rsPts)} fill="none" stroke={C.red} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="140" y="93" textAnchor="middle" fontSize="8" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Price rising ≠ RS rising. Always check RS.</text>
      </svg>
    </div>
  )
}

function GoldenComboChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 86" width="100%" style={{ display: 'block' }}>
        {/* Stage 2 box */}
        <rect x="8" y="8" width="112" height="42" rx="8" fill="rgba(52,211,153,0.12)" stroke={C.green} strokeWidth="1.5" />
        <text x="64" y="26" textAnchor="middle" fontSize="11" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="800">Stage 2</text>
        <text x="64" y="38" textAnchor="middle" fontSize="8"  fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.8">Uptrend ↗</text>
        <text x="64" y="48" textAnchor="middle" fontSize="7"  fill={C.textMuted} fontFamily="system-ui,sans-serif">Price above 30W MA</text>
        {/* Plus */}
        <text x="140" y="29" textAnchor="middle" dominantBaseline="central" fontSize="20" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">+</text>
        {/* Rising RS box */}
        <rect x="160" y="8" width="112" height="42" rx="8" fill="rgba(56,189,248,0.12)" stroke={C.blue} strokeWidth="1.5" />
        <text x="216" y="26" textAnchor="middle" fontSize="11" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="800">Rising RS</text>
        <text x="216" y="38" textAnchor="middle" fontSize="8"  fill={C.blue} fontFamily="system-ui,sans-serif" opacity="0.8">Beating Nifty ↗</text>
        <text x="216" y="48" textAnchor="middle" fontSize="7"  fill={C.textMuted} fontFamily="system-ui,sans-serif">RS line going up</text>
        {/* Arrow down */}
        <line x1="140" y1="52" x2="140" y2="62" stroke={C.green} strokeWidth="1.5" />
        <path d="M133,58 L140,65 L147,58" fill="none" stroke={C.green} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* Best Buy Zone */}
        <rect x="36" y="66" width="208" height="16" rx="8" fill="rgba(52,211,153,0.2)" stroke={C.green} strokeWidth="1.5" />
        <text x="140" y="74" textAnchor="middle" dominantBaseline="central" fontSize="10.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="800">🎯  Best Buy Zone</text>
      </svg>
    </div>
  )
}

function WeakRSChart() {
  const strongPrice = [[8,76],[28,66],[52,56],[76,46],[100,36],[124,26],[136,20]]
  const strongRS    = [[8,80],[28,73],[52,66],[76,59],[100,52],[124,46],[136,41]]
  const weakPrice   = [[148,74],[168,70],[192,66],[216,61],[238,57],[262,53],[272,51]]
  const weakRS      = [[148,60],[168,64],[192,68],[216,72],[238,77],[262,81],[272,84]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <line x1="140" y1="4" x2="140" y2="86" stroke={C.border} strokeWidth="0.8" />
        {/* Strong stock */}
        <text x="72"  y="13" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Strong Stock ✅</text>
        <polyline points={P(strongPrice)} fill="none" stroke={C.green} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(strongRS)}    fill="none" stroke={C.green} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4,3" opacity="0.55" />
        <text x="10" y="87" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">Price ↑  RS ↑</text>
        {/* Weak stock */}
        <text x="210" y="13" textAnchor="middle" fontSize="8" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Weak Stock ⚠️</text>
        <polyline points={P(weakPrice)} fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(weakRS)}    fill="none" stroke={C.red}   strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="4,3" opacity="0.7" />
        <text x="148" y="87" fontSize="7" fill={C.red} fontFamily="system-ui,sans-serif">Price ↑  RS ↓  Risky!</text>
      </svg>
    </div>
  )
}

function RSScorecardChart() {
  const rows = [
    { label: 'Stage',  strong: 'Stage 2',      weak: 'Stage 1 / 3 / 4'  },
    { label: 'RS',     strong: 'Rising ↑',     weak: 'Flat / Falling ↓' },
    { label: 'Action', strong: 'Buy! ✅',       weak: 'Avoid ❌'          },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 92" width="100%" style={{ display: 'block' }}>
        {/* Header */}
        <rect x="8"   y="4" width="60"  height="14" rx="2" fill={C.border} opacity="0.4" />
        <rect x="72"  y="4" width="94"  height="14" rx="2" fill="rgba(52,211,153,0.2)" />
        <rect x="170" y="4" width="102" height="14" rx="2" fill="rgba(248,113,113,0.2)" />
        <text x="119" y="11" textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={C.green}     fontFamily="system-ui,sans-serif" fontWeight="700">Strong Stock ✅</text>
        <text x="221" y="11" textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={C.red}       fontFamily="system-ui,sans-serif" fontWeight="700">Weak Stock ❌</text>
        {/* Data rows */}
        {rows.map((row, i) => (
          <g key={i}>
            <rect x="8"   y={22 + i * 22} width="60"  height="18" rx="2" fill={C.surface}              stroke={C.border}                  strokeWidth="0.5" />
            <rect x="72"  y={22 + i * 22} width="94"  height="18" rx="2" fill="rgba(52,211,153,0.07)"  stroke="rgba(52,211,153,0.2)"      strokeWidth="0.5" />
            <rect x="170" y={22 + i * 22} width="102" height="18" rx="2" fill="rgba(248,113,113,0.07)" stroke="rgba(248,113,113,0.2)"     strokeWidth="0.5" />
            <text x="38"  y={31 + i * 22} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="600">{row.label}</text>
            <text x="119" y={31 + i * 22} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={C.green}     fontFamily="system-ui,sans-serif" fontWeight="600">{row.strong}</text>
            <text x="221" y={31 + i * 22} textAnchor="middle" dominantBaseline="central" fontSize="8.5" fill={C.red}       fontFamily="system-ui,sans-serif" fontWeight="600">{row.weak}</text>
          </g>
        ))}
        <text x="140" y="88" textAnchor="middle" fontSize="7.5" fill={C.accent} fontFamily="system-ui,sans-serif" opacity="0.85">SwingX on PineX filters for Strong Stock automatically</text>
      </svg>
    </div>
  )
}

// ─── Content data — Module 1 ─────────────────────────────────────────────────

const M1_STAGES = [
  { label: 'Stage 1', color: C.textMuted, bg: 'rgba(148,158,171,0.12)', border: 'rgba(148,158,171,0.25)' },
  { label: 'Stage 2', color: C.green,     bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
  { label: 'Stage 3', color: C.amber,     bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.30)'  },
  { label: 'Stage 4', color: C.red,       bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
]

const LESSONS = [
  {
    id: 'intro', icon: '🌱',
    title: 'Every stock has a life cycle',
    body: [
      'Think of a stock like a mango tree.',
      'First the tree just sits there — no fruit. Then it slowly starts to grow. Then it blooms and gives the best mangoes. Then it gets tired and the fruit starts to fall.',
      'Stocks do the same thing. They go through 4 stages, one after the other — every single time.',
      'Learning these 4 stages is the most important thing you can do as an investor. Everything else flows from here.',
    ],
  },
  {
    id: 'stage1', icon: '😴', stageIdx: 0,
    title: 'Stage 1 — Sleeping',
    body: [
      'The stock price is going nowhere. Up a little, down a little, no real direction. It looks boring.',
      'Think of a coconut tree in the dry season — it is alive, but it is not flowering yet.',
      'Investors who have been holding this stock for a long time are slowly selling and getting out. New investors are slowly buying. The two sides are balanced — that is why the price is flat.',
    ],
    rule: '⛔  Do not buy here. Boring is not safe — it is just waiting.',
  },
  {
    id: 'stage2', icon: '🚀', stageIdx: 1,
    title: 'Stage 2 — Rising',
    body: [
      'The stock starts climbing steadily. It makes a new high, pulls back a little, then makes another new high. This is what a healthy rising stock looks like.',
      'The coconut tree is now in full bloom — it is the best time to climb up and pick the coconuts.',
      'More people are noticing the stock. Big fund houses are buying. This buying pressure pushes the price higher week after week.',
    ],
    rule: '✅  This is the best time to buy. PineX focuses on these stocks.',
  },
  {
    id: 'stage3', icon: '😓', stageIdx: 2,
    title: 'Stage 3 — Tired',
    body: [
      'The stock has been rising for a while. Now it starts making big swings — up one week, down the next. The coconuts are still there but the tree is getting shaky.',
      'The big fund houses who bought early are now quietly selling their shares. But new buyers, who heard about the stock from friends, are still buying.',
      'This tug-of-war causes those big swings you see.',
    ],
    rule: '⚠️  Think about exiting. Stage 3 often turns into Stage 4.',
  },
  {
    id: 'stage4', icon: '📉', stageIdx: 3,
    title: 'Stage 4 — Falling',
    body: [
      'The stock is now falling month after month. Everyone who wanted to sell has sold.',
      'Your friend says: "Bhai, look — it was ₹500, now it is ₹200. So cheap! Just buy it."',
      'This is the most dangerous trap in investing. Catching a falling knife looks easy but you will almost always cut your hand.',
      'A stock can fall from ₹200 to ₹50, and then to ₹10. "Cheap" does not mean safe.',
    ],
    rule: '🚫  Never buy just because it looks cheap. Wait for Stage 1 to finish.',
  },
  {
    id: 'summary', icon: '🗺️',
    title: 'The Simple Rule',
    body: ['You do not need to predict the future. You just need to identify which stage a stock is in right now.'],
    stageStrip: true,
    rule: '📌  Buy in Stage 2. Start thinking of exit in Stage 3. Never chase Stage 4.',
  },
  {
    id: 'quiz-intro', icon: '🧠',
    title: 'Quick Check — 2 Questions',
    body: [
      'Let us see if the stages make sense to you.',
      'There are just 2 questions. Each has 4 choices. You will see the answer and explanation right away.',
      'No scores, no pressure — just a quick check.',
    ],
    tip: 'Read each question slowly before picking.',
  },
]

const QUIZ = [
  {
    question: 'A stock has been falling steadily for 3 months. Your friend says: "It was ₹500, now it is ₹150 — so cheap, just buy it!" Which stage is this stock most likely in?',
    options: ['Stage 1 — Sleeping', 'Stage 2 — Rising', 'Stage 3 — Tired', 'Stage 4 — Falling'],
    correct: 3,
    explanation: 'A stock falling steadily for months is clearly in Stage 4. "Cheap" is a trap — Stage 4 stocks can keep falling much lower. Always wait for the stock to build a base (Stage 1) and then start rising (Stage 2) before buying.',
  },
  {
    question: 'A stock has been rising steadily for the past 2 months. Every week it makes a new high, pulls back a little, and then goes higher again. Which stage is this?',
    options: ['Stage 1 — Sleeping', 'Stage 2 — Rising', 'Stage 3 — Tired', 'Stage 4 — Falling'],
    correct: 1,
    explanation: 'Steady rising price with higher highs each week is textbook Stage 2. This is exactly what PineX looks for — healthy uptrends where you can buy with confidence.',
  },
]

// ─── Content data — Module 2 ─────────────────────────────────────────────────

const M2_LESSONS = [
  {
    id: 'm2-mela', icon: '🏪',
    title: 'What is the Stock Market?',
    body: [
      'Imagine a giant mela — a fair — where thousands of companies are selling small pieces of themselves.',
      'When you buy a piece of a company (called a share), you become a part-owner. If the company does well, the price of your piece goes up. If it does badly, the price falls.',
      'The stock market is just this mela, happening every day, Monday to Friday, from 9:15 AM to 3:30 PM.',
      'Anyone with a phone and a demat account can participate.',
    ],
    rule: '📌  Stock market = daily mela where company shares are bought and sold.',
  },
  {
    id: 'm2-nifty', icon: '🏆',
    title: 'What is Nifty 50?',
    body: [
      'Think of India\'s cricket team. There are thousands of cricketers in India, but only the best 11 are picked for a match.',
      'Nifty 50 is similar — it is the top 50 companies in India by size and importance. TCS, Reliance, HDFC Bank, Infosys and 46 more.',
      'When these 50 companies are doing well on average, Nifty goes up. When they are struggling, Nifty goes down.',
      'Nifty is the report card of the Indian stock market.',
    ],
    rule: '📌  Nifty 50 = top 50 Indian companies. It is the heartbeat of the market.',
  },
  {
    id: 'm2-tide', icon: '🌊',
    title: 'Why does Nifty matter to you?',
    body: [
      'The market has moods. When Nifty is rising, investors are happy and most stocks go up — even average ones.',
      'When Nifty is falling, investors are scared and most stocks fall — even good companies.',
      'Think of it like the tide. When the tide rises, all boats go up. When the tide falls, even good boats go down.',
      'So before buying any stock, always ask: what is Nifty doing right now?',
    ],
    rule: '⚠️  Never buy aggressively when Nifty is falling. Wait for the tide to rise.',
  },
  {
    id: 'm2-stages', icon: '📊',
    title: 'Nifty has 4 stages too!',
    body: [
      'Just like individual stocks, Nifty itself goes through the same 4 stages.',
      'Stage 2 Nifty = bull market. Investors are confident, most stocks are rising. Good time to buy.',
      'Stage 4 Nifty = bear market. Fear is everywhere, most stocks are falling. Even good companies struggle.',
      'On PineX, we check Nifty\'s stage before trusting individual stock signals. A Stage 2 stock in a Stage 4 Nifty is much riskier.',
    ],
    rule: '🔑  Always check Nifty\'s stage first. A good stock in a bad market is still risky.',
  },
  {
    id: 'm2-sensex', icon: '📺',
    title: 'Sensex vs Nifty — same story',
    body: [
      'You will hear both words on TV and in the news. They sound different but tell almost the same story.',
      'Sensex = top 30 companies on the BSE (Bombay Stock Exchange). Nifty = top 50 companies on the NSE (National Stock Exchange).',
      'Both go up and down together — like two thermometers in the same room. They move almost identically.',
      'PineX uses Nifty because NSE is where most active trading happens in India.',
    ],
    rule: '💡  Sensex and Nifty move almost identically. Same story, different scorecards.',
  },
  {
    id: 'm2-mkt-summary', icon: '🗺️',
    title: 'Market Basics — Summary',
    body: ['Everything in the stock market connects back to one thing: the direction of Nifty.'],
    mktStrip: true,
    rule: '📌  On PineX: always check Nifty\'s stage. Buy stocks confidently only in a bull market.',
  },
]

const M2_QUIZ = [
  {
    question: 'Nifty has been falling for 2 months and is now below its 30-week moving average. Your friend wants to buy a Stage 2 stock right now. What would you tell him?',
    options: [
      'Go ahead — Stage 2 stocks always work regardless of Nifty',
      'Be careful — when Nifty is falling, even good stocks struggle',
      'Buy only if the stock looks cheap',
      'It does not matter what Nifty is doing',
    ],
    correct: 1,
    explanation: 'When Nifty is in a downtrend (Stage 4), even great Stage 2 stocks can get dragged down. The tide pulls all boats. It is safer to wait for Nifty to stabilise and start rising before buying aggressively.',
  },
  {
    question: 'What is Nifty 50?',
    options: [
      'The top 50 stocks on BSE with the highest share price',
      'An index of the top 50 companies on NSE, representing the overall Indian market',
      'The 50 cheapest stocks listed in India',
      'A mutual fund managed by the government of India',
    ],
    correct: 1,
    explanation: 'Nifty 50 is an index — a basket of the top 50 companies listed on the NSE, chosen by size and importance. It represents the overall health of the Indian stock market. When Nifty goes up, the market is generally doing well.',
  },
]

// ─── Content data — Module 3 ─────────────────────────────────────────────────

const M3_LESSONS = [
  {
    id: 'm3-rs-intro', icon: '📊',
    title: 'What is Relative Strength?',
    body: [
      'Imagine your whole class got a difficult exam. The class average was 50 marks. But you scored 75. That means you did better than the class — you have strong relative performance.',
      'Relative Strength (RS) is the same idea for stocks. If Nifty went up 10% this year but a stock went up 25% — that stock has strong RS. It is beating the market.',
      'RS is not about how much a stock went up in price. It is about how much it went up compared to Nifty.',
    ],
    rule: '📌  RS = how a stock performs compared to Nifty. High RS = beating the market.',
  },
  {
    id: 'm3-rs-why', icon: '🏃',
    title: 'Why does RS matter?',
    body: [
      'Think of it like a race. When the gun fires (bull market starts), the strongest runners pull ahead first.',
      'Stocks with strong RS are the leaders — they go up more when the market rises, and fall less when the market falls.',
      'These are the stocks that big mutual funds and FIIs are quietly buying. Weak RS stocks? Institutions are avoiding them or slowly selling. That is the hidden message in the RS line.',
    ],
    rule: '🔑  Strong RS = institutions buying. Weak RS = institutions selling.',
  },
  {
    id: 'm3-rs-calc', icon: '🧮',
    title: 'How is RS calculated?',
    body: [
      'Do not worry — PineX calculates this for you. But here is the simple idea.',
      'Divide the stock\'s price by Nifty\'s value. Plot this number over time. If this line is going UP — the stock is getting stronger vs Nifty. If going DOWN — the stock is getting weaker, even if its price is rising.',
      'A stock can go up 5% while Nifty goes up 10%. The price rose, but RS fell. That is a weak stock hiding in a strong market. The price rise was just the tide — not real strength.',
    ],
    rule: '⚠️  Price going up does NOT mean RS is strong. Always check the RS line.',
  },
  {
    id: 'm3-golden', icon: '🎯',
    title: 'The Golden Combination',
    body: [
      'The most powerful signal in Weinstein\'s method: Stage 2 stock + Rising RS.',
      'This means the stock is in an uptrend AND beating the market at the same time. These are the stocks that give the biggest returns.',
      'On PineX, SwingX stocks are filtered for exactly this — Stage 2 + strong RS + volume confirmation. The chart below shows what this setup looks like.',
    ],
    rule: '✅  Stage 2 + Rising RS together = the best buy setup.',
  },
  {
    id: 'm3-weak-rs', icon: '⚠️',
    title: 'What weak RS looks like',
    body: [
      'If a stock is rising but its RS line is flat or falling — be careful.',
      'It means the stock is just being lifted by the overall market tide. It has no real buying interest of its own.',
      'When the tide (Nifty) turns down, weak RS stocks fall the hardest and the fastest. Always prefer stocks where RS is rising — they have real institutional buying behind them.',
    ],
    rule: '🚫  Rising price + falling RS = riding the tide. Avoid when Nifty turns.',
  },
  {
    id: 'm3-summary', icon: '🗺️',
    title: 'Relative Strength — Summary',
    body: [
      'RS = how a stock performs compared to Nifty.',
      'Rising RS = stock beating the market = institutions buying.',
      'Falling RS = stock weaker than market = avoid or exit.',
      'Price going up does NOT mean RS is strong.',
      'Best stocks: Stage 2 + Rising RS together.',
      'PineX and SwingX already filter for this — you do not calculate manually.',
    ],
    rule: '📌  On PineX: look for Stage 2 stocks with rising RS. That is the golden setup.',
  },
]

const M3_QUIZ = [
  {
    question: 'Nifty went up 15% this year. Stock A went up 8%. Stock B went up 30%. Which stock has stronger Relative Strength?',
    options: [
      'Stock A — it also went up, just steadily',
      'Stock B — it went up 30% while Nifty only went up 15%',
      'Both are equal — both went up this year',
      'Neither — only Nifty matters for RS',
    ],
    correct: 1,
    explanation: 'Stock B went up 30% while Nifty only went up 15%. Stock B is beating the market — that is strong RS. Stock A only went up 8%, which is less than Nifty\'s 15%. Stock A actually has weak RS — it underperformed the market even though its price rose.',
  },
  {
    question: 'A stock\'s price is rising slowly but its RS line is falling. What does this tell you?',
    options: [
      'The stock is very strong — buy immediately',
      'The stock is weaker than Nifty. It is rising only because the market is rising',
      'RS does not matter as long as price is going up',
      'The stock is in Stage 2 — a perfect buy',
    ],
    correct: 1,
    explanation: 'A rising price with a falling RS line means the stock is not keeping up with Nifty. It is only going up because the overall market is rising. When Nifty falls, this stock will fall harder. This is a weak stock riding the tide — not a real buy.',
  },
]

// ─── Shared constants ─────────────────────────────────────────────────────────

const COMING_SOON = [
  { num: 4, title: 'Support & Resistance',       desc: 'Price floors, ceilings, and the Flip Rule.' },
  { num: 5, title: 'Volume — The Hidden Signal', desc: 'Why volume tells you what price cannot.' },
  { num: 6, title: 'How PineX Ranks Stocks',     desc: 'Understanding the RS score and Stage filters.' },
  { num: 7, title: 'Your First Trade Plan',      desc: 'Entry, stop-loss, and target — a simple framework.' },
  { num: 8, title: 'Reading Candlesticks',       desc: 'What each candle tells you about buyers and sellers.' },
  { num: 9, title: 'Portfolio Management',       desc: 'How many stocks to own and how much to invest.' },
]

// ─── Chart lookup ─────────────────────────────────────────────────────────────

function LessonChart({ id }) {
  if (id === 'intro')            return <JourneyChart />
  if (id === 'stage1')           return <Stage1Chart />
  if (id === 'stage2')           return <Stage2Chart />
  if (id === 'stage3')           return <Stage3Chart />
  if (id === 'stage4')           return <Stage4Chart />
  if (id === 'summary')          return <JourneyChart big />
  if (id === 'm2-mela')          return <MelaChart />
  if (id === 'm2-nifty')         return <NiftyPodiumChart />
  if (id === 'm2-tide')          return <TideChart />
  if (id === 'm2-stages')        return <NiftyStagesChart />
  if (id === 'm2-sensex')        return <SensexNiftyChart />
  if (id === 'm2-mkt-summary')   return <NiftySummaryChart />
  if (id === 'm3-rs-intro')      return <RSBarChart />
  if (id === 'm3-rs-why')        return <RaceChart />
  if (id === 'm3-rs-calc')       return <PriceVsRSChart />
  if (id === 'm3-golden')        return <GoldenComboChart />
  if (id === 'm3-weak-rs')       return <WeakRSChart />
  if (id === 'm3-summary')       return <RSScorecardChart />
  return null
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StageBadge({ idx }) {
  const s = M1_STAGES[idx]
  return (
    <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, color: s.color, background: s.bg, border: `1px solid ${s.border}`, letterSpacing: '0.04em' }}>
      {s.label}
    </span>
  )
}

function StageStrip() {
  const labels = ['Sleeping', 'Rising', 'Tired',  'Falling']
  const rules  = ['Wait',     'Buy ✅', 'Exit?',  'Avoid']
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, margin: '12px 0' }}>
      {M1_STAGES.map((s, i) => (
        <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: '10px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.label}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 6, lineHeight: 1.4 }}>{labels[i]}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color }}>{rules[i]}</div>
        </div>
      ))}
    </div>
  )
}

function MktStrip() {
  const items = [
    { label: 'Stock Market', desc: '9:15 AM – 3:30 PM',  action: 'Mon to Fri',      color: C.blue,   bg: 'rgba(56,189,248,0.10)',  border: 'rgba(56,189,248,0.30)'  },
    { label: 'Nifty 50',     desc: 'Top 50 on NSE',      action: 'Market pulse',    color: C.accent, bg: 'rgba(45,212,191,0.10)',  border: 'rgba(45,212,191,0.30)'  },
    { label: 'Bull Market',  desc: 'Nifty Stage 2',      action: 'Buy confidently', color: C.green,  bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)'  },
    { label: 'Bear Market',  desc: 'Nifty Stage 4',      action: 'Protect money',   color: C.red,    bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.30)' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8, margin: '12px 0' }}>
      {items.map((item, i) => (
        <div key={i} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 10, padding: '10px', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: item.color, marginBottom: 3 }}>{item.label}</div>
          <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 4, lineHeight: 1.4 }}>{item.desc}</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: item.color }}>{item.action}</div>
        </div>
      ))}
    </div>
  )
}

function LessonCard({ lesson, onNext, isLast }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 40, marginBottom: 10, lineHeight: 1 }}>{lesson.icon}</div>
        {lesson.stageIdx != null && <div style={{ marginBottom: 10 }}><StageBadge idx={lesson.stageIdx} /></div>}
        <h2 style={{ fontSize: 21, fontWeight: 800, color: C.textHeading, margin: '0 0 14px', lineHeight: 1.25 }}>
          {lesson.title}
        </h2>
        <LessonChart id={lesson.id} />
        {lesson.body.map((para, i) => (
          <p key={i} style={{ fontSize: 15, color: C.text, lineHeight: 1.7, margin: '0 0 12px' }}>{para}</p>
        ))}
        {lesson.stageStrip && <StageStrip />}
        {lesson.mktStrip   && <MktStrip />}
        {lesson.tip && (
          <div style={{ background: C.blueBg, border: `1px solid ${C.blue}22`, borderRadius: 8, padding: '10px 14px', marginTop: 4 }}>
            <span style={{ fontSize: 13, color: C.blue }}>💡 {lesson.tip}</span>
          </div>
        )}
        {lesson.rule && (
          <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', marginTop: 14, fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>
            {lesson.rule}
          </div>
        )}
      </div>
      <button onClick={onNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
        {isLast ? 'Start Quiz →' : 'Next →'}
      </button>
    </div>
  )
}

function QuizCard({ q, qNum, total, onNext, isLast }) {
  const [picked, setPicked] = useState(null)
  const isCorrect = picked === q.correct
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Question {qNum} of {total}
        </div>
        <p style={{ fontSize: 16, fontWeight: 600, color: C.textHeading, lineHeight: 1.6, margin: '0 0 20px' }}>{q.question}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {q.options.map((opt, i) => {
            let bg = C.surface2, border = C.border, color = C.text
            if (picked !== null) {
              if (i === q.correct)   { bg = C.greenBg; border = C.greenBorder; color = C.green }
              else if (i === picked) { bg = C.redBg;   border = C.redBorder;   color = C.red   }
            }
            const letterColor = picked === null ? C.blue : (i === q.correct ? C.green : (i === picked ? C.red : C.textMuted))
            return (
              <button key={i} onClick={() => picked === null && setPicked(i)}
                style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: picked === null ? 'pointer' : 'default', color, fontSize: 14, fontWeight: 500, lineHeight: 1.4, transition: 'all 0.15s' }}>
                <span style={{ fontWeight: 700, marginRight: 8, color: letterColor }}>{String.fromCharCode(65 + i)}.</span>
                {opt}
              </button>
            )
          })}
        </div>
        {picked !== null && (
          <div style={{ background: isCorrect ? C.greenBg : C.redBg, border: `1px solid ${isCorrect ? C.greenBorder : C.redBorder}`, borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: isCorrect ? C.green : C.red, marginBottom: 6 }}>
              {isCorrect ? '✅ Correct!' : '❌ Not quite — here is why:'}
            </div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.6, margin: 0 }}>{q.explanation}</p>
          </div>
        )}
      </div>
      {picked !== null && (
        <button onClick={onNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          {isLast ? 'See Results →' : 'Next Question →'}
        </button>
      )}
    </div>
  )
}

function CompletionScreen({ moduleNum, onStartNext, onHome }) {
  const modNames = {
    1: 'The Weinstein 4-Stage Method',
    2: 'Nifty 50 & the Market',
    3: 'Relative Strength vs Nifty',
  }
  const summaryText = {
    1: <>You now know the most important framework for stock investing. Every time you look at a stock, ask yourself: <strong style={{ color: C.textHeading }}>which stage is it in?</strong></>,
    2: <>You now understand how the Indian stock market works, what Nifty 50 is, and why checking Nifty's stage is essential before buying any stock.</>,
    3: <>You now know how to find stocks that are genuinely beating the market — not just rising because of Nifty. Always look for <strong style={{ color: C.textHeading }}>Stage 2 + Rising RS</strong> together.</>,
  }
  const upNextData = {
    2: { title: 'Nifty 50 & the Market',           desc: 'The Indian stock market, Nifty, and bull vs bear markets.' },
    3: { title: 'Relative Strength (RS) vs Nifty', desc: 'Why some stocks beat the market and how to find them.' },
  }
  const hasNext = moduleNum < 3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🎉</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: C.textHeading, margin: '0 0 8px' }}>Module {moduleNum} Done!</h2>
          <p style={{ fontSize: 15, color: C.textMuted, margin: '0 0 4px' }}>{modNames[moduleNum]}</p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 20, padding: '5px 14px' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.green }}>✓ Completed</span>
          </div>
        </div>

        <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <p style={{ fontSize: 14, color: C.text, lineHeight: 1.7, margin: 0 }}>{summaryText[moduleNum]}</p>
        </div>

        {hasNext && (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Up Next</div>
            <div onClick={onStartNext} style={{ background: C.blueBg, border: `1px solid ${C.blue}44`, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 20 }}>
              <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, background: `${C.blue}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: C.blue }}>{moduleNum + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.blue, marginBottom: 2 }}>{upNextData[moduleNum + 1].title}</div>
                <div style={{ fontSize: 12, color: C.textMuted }}>{upNextData[moduleNum + 1].desc}</div>
              </div>
              <span style={{ fontSize: 14, color: C.blue }}>→</span>
            </div>
          </>
        )}

        <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          {hasNext ? 'Coming Later' : 'Coming Next'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {COMING_SOON.slice(0, 4).map(m => (
            <div key={m.num} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: 0.6 }}>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{m.num}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, marginBottom: 2 }}>{m.title}</div>
                <div style={{ fontSize: 12, color: C.textFaint }}>{m.desc}</div>
                <div style={{ fontSize: 11, color: C.blue, marginTop: 4, fontWeight: 600 }}>Coming Soon</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasNext ? (
        <>
          <button onClick={onStartNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
            Start Module {moduleNum + 1} →
          </button>
          <button onClick={onHome} style={{ marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, border: `1px solid ${C.border}`, cursor: 'pointer', background: 'transparent', color: C.textMuted, fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
            Go Home
          </button>
        </>
      ) : (
        <button onClick={onHome} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          Go Home
        </button>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate()
  const [activeModule, setActiveModule] = useState(1)
  const [moduleSteps, setModuleSteps]   = useState({ 1: 0, 2: 0, 3: 0 })

  const lessons = activeModule === 1 ? LESSONS : activeModule === 2 ? M2_LESSONS : M3_LESSONS
  const quiz    = activeModule === 1 ? QUIZ    : activeModule === 2 ? M2_QUIZ    : M3_QUIZ
  const step    = moduleSteps[activeModule]
  const total   = lessons.length + quiz.length

  const isDone   = step >= total
  const progress = isDone ? 1 : step / total

  const handleNext      = () => setModuleSteps(s => ({ ...s, [activeModule]: s[activeModule] + 1 }))
  const handleSwitchMod = (num) => setActiveModule(num)

  const currentLesson  = !isDone && step < lessons.length ? lessons[step] : null
  const currentQuizIdx = !isDone && step >= lessons.length ? step - lessons.length : null

  const modTitles = { 1: 'Weinstein Stages', 2: 'Nifty 50 & Market', 3: 'RS vs Nifty' }

  return (
    <>
      <Helmet>
        <title>Learn — Stock Market Basics | PineX</title>
        <meta name="description" content="Learn Weinstein stages, Nifty 50, and how the Indian stock market works. Simple English, tap-through lessons." />
      </Helmet>

      <div style={{ minHeight: '100vh', background: C.base, display: 'flex', flexDirection: 'column' }}>

        {/* Header + progress bar */}
        <div style={{ flexShrink: 0, padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate('/')} aria-label="Go back"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>
              Module {activeModule} · {modTitles[activeModule]}
              {!isDone && <span style={{ marginLeft: 8, color: C.blue }}>{step + 1} / {total}</span>}
            </div>
            <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: C.blue, width: `${progress * 100}%`, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>

        {/* Card body */}
        <div style={{ flex: 1, padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', maxWidth: 480, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {isDone ? (
            <CompletionScreen moduleNum={activeModule} onStartNext={() => setActiveModule(activeModule + 1)} onHome={() => navigate('/')} />
          ) : currentLesson ? (
            <LessonCard lesson={currentLesson} onNext={handleNext} isLast={step === lessons.length - 1} />
          ) : currentQuizIdx !== null ? (
            <QuizCard q={quiz[currentQuizIdx]} qNum={currentQuizIdx + 1} total={quiz.length} onNext={handleNext} isLast={currentQuizIdx === quiz.length - 1} />
          ) : null}
        </div>

        {/* Module strip — always visible */}
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}`, padding: '12px 16px', background: C.surface }}>
          <div style={{ fontSize: 11, color: C.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Modules</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {[
              { num: 1, title: 'Weinstein Stages' },
              { num: 2, title: 'Nifty 50 & Market' },
              { num: 3, title: 'RS vs Nifty' },
            ].map(m => (
              <div key={m.num} onClick={() => handleSwitchMod(m.num)}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', background: activeModule === m.num ? C.blueBg : 'transparent', border: `1px solid ${activeModule === m.num ? C.blue : C.border}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: activeModule === m.num ? C.blue : C.textMuted }}>{m.num}</span>
                <span style={{ fontSize: 11, color: activeModule === m.num ? C.blue : C.textMuted, whiteSpace: 'nowrap' }}>{m.title}</span>
              </div>
            ))}
            {COMING_SOON.map(m => (
              <div key={m.num} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.textFaint }}>{m.num}</span>
                <span style={{ fontSize: 11, color: C.textFaint, whiteSpace: 'nowrap' }}>{m.title}</span>
                <span style={{ fontSize: 10, color: C.textFaint }}>· Soon</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </>
  )
}
