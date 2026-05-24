import { useState, useMemo } from 'react'
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

// ─── Module 4 charts — 30-Week Moving Average ────────────────────────────────

function AverageChart() {
  const scores  = [60, 70, 50, 80, 90]
  const baseline = 70, chartH = 52, barW = 34, gap = 14, startX = 27
  const avgY = Math.round(baseline - 70 * chartH / 100)
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 88" width="100%" style={{ display: 'block' }}>
        <line x1="20" y1={baseline} x2="260" y2={baseline} stroke={C.border} strokeWidth="1" />
        {scores.map((s, i) => {
          const h = Math.round(s * chartH / 100)
          const x = startX + i * (barW + gap)
          return (
            <g key={i}>
              <rect x={x} y={baseline - h} width={barW} height={h} rx="3" fill={C.blueBg} stroke={C.blue} strokeWidth="1" opacity="0.9" />
              <text x={x + barW / 2} y={baseline - h - 4} textAnchor="middle" fontSize="8.5" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="700">{s}</text>
              <text x={x + barW / 2} y="82" textAnchor="middle" fontSize="7.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">T{i + 1}</text>
            </g>
          )
        })}
        <line x1="20" y1={avgY} x2="260" y2={avgY} stroke={C.accent} strokeWidth="1.8" strokeDasharray="6,3" />
        <text x="22" y={avgY - 3} fontSize="8" fill={C.accent} fontFamily="system-ui,sans-serif" fontWeight="700">Average = 70</text>
      </svg>
    </div>
  )
}

function MAWindowChart() {
  const price = [[10,44],[24,38],[38,50],[52,34],[66,44],[80,30],[94,40],[108,28],[122,38],[136,26],[150,36],[164,24],[178,32],[192,22],[206,30],[220,20],[234,28],[248,18],[262,26],[274,18]]
  const ma    = [[10,50],[60,46],[120,40],[180,32],[240,22],[274,18]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 82" width="100%" style={{ display: 'block' }}>
        <rect x="58" y="8" width="140" height="56" rx="4" fill={C.blueBg} opacity="0.55" stroke={C.blue} strokeWidth="0.8" strokeDasharray="3,2" />
        <text x="128" y="20" textAnchor="middle" fontSize="7.5" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="700">30-week window</text>
        <polyline points={P(price)} fill="none" stroke={C.text}   strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.6" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="2"   strokeDasharray="5,3" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M200,72 L220,72" fill="none" stroke={C.blue} strokeWidth="1.5" />
        <path d="M217,68 L223,72 L217,76" fill="none" stroke={C.blue} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x="130" y="76" textAnchor="middle" fontSize="7.5" fill={C.blue} fontFamily="system-ui,sans-serif">window slides forward each week →</text>
        <text x="12" y="76" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
      </svg>
    </div>
  )
}

function NoisyVsMAChart() {
  const dailyPts  = [[8,44],[14,28],[20,48],[26,20],[32,52],[38,16],[44,40],[50,24],[56,50],[62,14],[68,44],[74,20],[80,54],[86,18],[92,48],[98,22],[104,46],[110,24],[116,40],[122,26],[128,44]]
  const weeklyPts = [[152,46],[163,42],[174,36],[185,30],[196,26],[207,22],[218,20],[229,18],[240,16],[252,14],[265,13]]
  const maPts     = [[152,50],[175,44],[200,36],[225,26],[252,18],[265,14]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <rect x="4"   y="4" width="130" height="62" rx="5" fill="rgba(248,113,113,0.05)" stroke={C.border} strokeWidth="0.6" />
        <rect x="146" y="4" width="130" height="62" rx="5" fill="rgba(52,211,153,0.05)"  stroke={C.border} strokeWidth="0.6" />
        <text x="69"  y="15" textAnchor="middle" fontSize="8" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Daily — too noisy</text>
        <text x="211" y="15" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">30W MA — clear trend</text>
        <polyline points={P(dailyPts)}  fill="none" stroke={C.red}   strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
        <polyline points={P(weeklyPts)} fill="none" stroke={C.text}  strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.45" />
        <polyline points={P(maPts)}     fill="none" stroke={C.green} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="211" y="60" textAnchor="middle" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
        <text x="69"  y="74" textAnchor="middle" fontSize="7" fill={C.textFaint} fontFamily="system-ui,sans-serif">Same stock</text>
        <text x="211" y="74" textAnchor="middle" fontSize="7" fill={C.textFaint} fontFamily="system-ui,sans-serif">Same stock</text>
      </svg>
    </div>
  )
}

function MAZonesChart() {
  const allPts = [[0,56],[12,53],[24,59],[36,54],[48,59],[60,55],[70,54],[84,49],[98,44],[111,38],[124,32],[137,26],[149,21],[159,18],[165,16],[173,25],[179,14],[188,28],[194,15],[203,29],[210,17],[215,23],[225,31],[232,27],[243,39],[252,46],[260,42],[270,55],[280,69]]
  const ma     = [[0,58],[40,56],[75,54],[105,48],[135,40],[160,30],[185,23],[208,22],[225,24],[250,33],[270,43],[280,58]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="68"  y="0" width="148" height="90" fill="rgba(52,211,153,0.06)" />
        <rect x="214" y="0" width="66"  height="90" fill="rgba(248,113,113,0.06)" />
        <line x1="68"  y1="0" x2="68"  y2="90" stroke={C.border} strokeWidth="0.5" />
        <line x1="214" y1="0" x2="214" y2="90" stroke={C.border} strokeWidth="0.5" />
        <text x="142" y="11" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Buy Zone</text>
        <text x="247" y="11" textAnchor="middle" fontSize="7.5" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Danger</text>
        <polyline points={P(ma)}     fill="none" stroke={C.accent} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(allPts)} fill="none" stroke={C.text}   strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
        <circle cx="72"  cy="53" r="5" fill="none" stroke={C.green} strokeWidth="1.8" />
        <text x="72"  y="44" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">↑ Entry</text>
        <circle cx="218" cy="22" r="5" fill="none" stroke={C.red} strokeWidth="1.8" />
        <text x="218" y="14" textAnchor="middle" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Exit ↓</text>
        <text x="10" y="84" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif" opacity="0.8">30W MA</text>
      </svg>
    </div>
  )
}

function MAPullbackChart() {
  const price = [[0,72],[15,65],[30,57],[46,49],[60,41],[72,34],[82,26],[92,22],[100,24],[108,36],[112,46],[115,51],[118,47],[122,40],[130,32],[140,24],[150,18],[158,16],[166,24],[172,32],[176,38],[180,37],[184,33],[192,25],[204,16],[220,10],[245,7],[265,7]]
  const ma    = [[0,72],[50,64],[100,54],[150,44],[200,32],[260,22]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 82" width="100%" style={{ display: 'block' }}>
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <text x="8" y="74" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA = Moving Support</text>
        {/* Bounce 1 */}
        <path d="M112,57 L115,50 L118,57" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <text x="115" y="67" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        {/* Bounce 2 */}
        <path d="M177,43 L180,36 L183,43" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <text x="180" y="52" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
      </svg>
    </div>
  )
}

function ExtendedMAChart() {
  const rise     = [[0,74],[20,64],[40,53],[58,44],[74,34],[88,24],[100,16],[112,10],[120,6]]
  const pullback = [[120,6],[128,10],[136,16],[144,24],[152,30],[158,36],[163,40]]
  const ma       = [[0,74],[60,64],[120,52],[180,38],[240,24],[280,18]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 80" width="100%" style={{ display: 'block' }}>
        <polyline points={P(ma)}       fill="none" stroke={C.accent} strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(rise)}     fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(pullback)} fill="none" stroke={C.amber}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5,3" />
        {/* Extended gap marker at peak */}
        <line x1="120" y1="8"  x2="120" y2="50" stroke={C.amber} strokeWidth="1.2" strokeDasharray="3,2" />
        <path d="M116,12 L120,7  L124,12" fill="none" stroke={C.amber} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M116,46 L120,51 L124,46" fill="none" stroke={C.amber} strokeWidth="1.3" strokeLinejoin="round" />
        <text x="124" y="27" fontSize="7.5" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Extended!</text>
        <text x="124" y="37" fontSize="7"   fill={C.amber} fontFamily="system-ui,sans-serif">Risky entry</text>
        {/* Wait-here zone */}
        <circle cx="163" cy="40" r="4" fill="none" stroke={C.green} strokeWidth="1.5" />
        <text x="168" y="37" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">← Wait here</text>
        <text x="8"   y="74" fontSize="7"   fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
      </svg>
    </div>
  )
}

function MAHeroChart() {
  const price = [[0,80],[18,70],[36,60],[54,50],[70,42],[86,34],[100,26],[112,20],[122,14],[132,10],[140,8],[148,14],[154,22],[158,34],[160,40],[162,38],[166,30],[176,22],[190,14],[208,8],[232,5],[262,4]]
  const ma    = [[0,80],[50,70],[100,58],[150,44],[200,28],[260,16],[280,13]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 98" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0" width="280" height="98" fill="rgba(52,211,153,0.04)" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        {/* Zone label */}
        <text x="215" y="20" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2 — Buy Zone</text>
        <text x="215" y="30" textAnchor="middle" fontSize="7"  fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.7">Price above rising MA</text>
        {/* Pullback bounce at (160,40) */}
        <path d="M157,46 L160,39 L163,46" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <text x="160" y="56" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="160" y="65" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.8">Pullback to MA</text>
        {/* MA label */}
        <text x="10" y="92" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif" opacity="0.85">30W MA = Moving Support</text>
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

// ─── Module 5 charts — Volume & Delivery Volume ──────────────────────────────

function VolumeMarketChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="4" y="4" width="130" height="82" rx="5" fill="rgba(148,158,171,0.05)" stroke={C.border} strokeWidth="0.6" />
        <text x="69" y="16" textAnchor="middle" fontSize="8" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Low Volume</text>
        {[22, 52, 82].map((x, i) => (
          <g key={i}>
            <circle cx={x} cy={32} r={5} fill="none" stroke={C.textFaint} strokeWidth="1.2" />
            <line x1={x} y1={37} x2={x} y2={50} stroke={C.textFaint} strokeWidth="1.2" />
            <line x1={x - 6} y1={43} x2={x + 6} y2={43} stroke={C.textFaint} strokeWidth="1.2" />
            <line x1={x} y1={50} x2={x - 4} y2={62} stroke={C.textFaint} strokeWidth="1.2" />
            <line x1={x} y1={50} x2={x + 4} y2={62} stroke={C.textFaint} strokeWidth="1.2" />
          </g>
        ))}
        <rect x="100" y="42" width="10" height="12" rx="1" fill={C.textFaint} opacity="0.4" />
        <path d="M101,40 L105,34 L109,40" fill={C.textFaint} stroke={C.textFaint} strokeWidth="1" strokeLinejoin="round" opacity="0.5" />
        <text x="69" y="78" textAnchor="middle" fontSize="7" fill={C.textFaint} fontFamily="system-ui,sans-serif">nobody cares</text>
        <rect x="146" y="4" width="130" height="82" rx="5" fill="rgba(52,211,153,0.05)" stroke={C.border} strokeWidth="0.6" />
        <text x="211" y="16" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">High Volume</text>
        {[158,172,186,200,214,228,165,179,207].map((x, i) => {
          const y = i < 6 ? 32 : 46
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={4} fill="none" stroke={C.green} strokeWidth="1.2" opacity="0.7" />
              <line x1={x} y1={y + 4} x2={x} y2={y + 13} stroke={C.green} strokeWidth="1.2" opacity="0.5" />
            </g>
          )
        })}
        <rect x="248" y="26" width="12" height="28" rx="1" fill={C.green} opacity="0.75" />
        <path d="M249,24 L254,16 L259,24" fill={C.green} stroke={C.green} strokeWidth="1" strokeLinejoin="round" />
        <text x="211" y="78" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">something real is happening!</text>
      </svg>
    </div>
  )
}

function VolumeConfirmChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="4" y="4" width="130" height="82" rx="5" fill="rgba(52,211,153,0.05)" stroke={C.border} strokeWidth="0.6" />
        <text x="69" y="15" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">High vol — TRUST this</text>
        <line x1="63" y1="21" x2="63" y2="24" stroke={C.green} strokeWidth="1.5" />
        <rect x="55" y="24" width="16" height="28" rx="2" fill={C.green} opacity="0.8" />
        <line x1="63" y1="52" x2="63" y2="56" stroke={C.green} strokeWidth="1.5" />
        <line x1="20" y1="60" x2="110" y2="60" stroke={C.border} strokeWidth="0.8" />
        <rect x="55" y="38" width="16" height="22" rx="1" fill={C.green} opacity="0.45" />
        <text x="74" y="52" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">HIGH ↑</text>
        <text x="69" y="80" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Real move ✅</text>
        <rect x="146" y="4" width="130" height="82" rx="5" fill="rgba(251,191,36,0.05)" stroke={C.border} strokeWidth="0.6" />
        <text x="211" y="15" textAnchor="middle" fontSize="7.5" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Low vol — be careful</text>
        <line x1="205" y1="21" x2="205" y2="24" stroke={C.green} strokeWidth="1.5" />
        <rect x="197" y="24" width="16" height="28" rx="2" fill={C.green} opacity="0.8" />
        <line x1="205" y1="52" x2="205" y2="56" stroke={C.green} strokeWidth="1.5" />
        <line x1="162" y1="60" x2="252" y2="60" stroke={C.border} strokeWidth="0.8" />
        <rect x="197" y="57" width="16" height="3" rx="1" fill={C.amber} opacity="0.6" />
        <text x="216" y="59" fontSize="6.5" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">low ↓</text>
        <text x="211" y="80" textAnchor="middle" fontSize="7" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Suspicious ⚠</text>
      </svg>
    </div>
  )
}

function VolumeStage2Chart() {
  const price = [[10,56],[24,50],[38,54],[52,44],[66,48],[80,38],[94,42],[108,32],[122,36],[136,26],[150,30],[164,20],[178,16],[192,14]]
  const bars = [
    { x: 17, h: 14, up: true  }, { x: 31, h: 5,  up: false },
    { x: 45, h: 16, up: true  }, { x: 59, h: 4,  up: false },
    { x: 73, h: 18, up: true  }, { x: 87, h: 5,  up: false },
    { x: 101,h: 16, up: true  }, { x: 115,h: 4,  up: false },
    { x: 129,h: 20, up: true  }, { x: 143,h: 5,  up: false },
    { x: 157,h: 18, up: true  }, { x: 171,h: 4,  up: false },
    { x: 185,h: 16, up: true  }, { x: 197,h: 21, up: false, warn: true },
  ]
  const base = 70, bw = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 210 98" width="100%" style={{ display: 'block' }}>
        <line x1="6" y1={base} x2="204" y2={base} stroke={C.border} strokeWidth="0.8" />
        <polyline points={P(price)} fill="none" stroke={C.green} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {bars.map((b, i) => (
          <g key={i}>
            <rect x={b.x - bw / 2} y={base - b.h} width={bw} height={b.h} rx="1"
              fill={b.up ? C.green : C.red} opacity={b.warn ? 0.9 : (b.up ? 0.65 : 0.4)} />
            {b.warn && <text x={b.x} y={base - b.h - 4} textAnchor="middle" fontSize="8" fill={C.red} fontFamily="system-ui,sans-serif">⚠</text>}
          </g>
        ))}
        <text x="8" y="88" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">✅ High vol up + low vol down = healthy</text>
        <text x="8" y="97" fontSize="6.5" fill={C.red} fontFamily="system-ui,sans-serif">⚠ Big vol on red day = distribution warning</text>
      </svg>
    </div>
  )
}

function DeliveryVsIntradayChart() {
  const person = (cx, cy, color) => (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="none" stroke={color} strokeWidth="1.4" />
      <line x1={cx} y1={cy + 6} x2={cx} y2={cy + 20} stroke={color} strokeWidth="1.4" />
      <line x1={cx - 8} y1={cy + 13} x2={cx + 8} y2={cy + 13} stroke={color} strokeWidth="1.4" />
      <line x1={cx} y1={cy + 20} x2={cx - 5} y2={cy + 32} stroke={color} strokeWidth="1.4" />
      <line x1={cx} y1={cy + 20} x2={cx + 5} y2={cy + 32} stroke={color} strokeWidth="1.4" />
    </g>
  )
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="4" y="4" width="130" height="82" rx="5" fill="rgba(248,113,113,0.04)" stroke={C.border} strokeWidth="0.6" />
        <text x="69" y="15" textAnchor="middle" fontSize="7.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Intraday trader</text>
        {person(46, 24, C.textMuted)}
        <path d="M60,34 L76,30" stroke={C.green} strokeWidth="1.4" fill="none" markerEnd="url(#arr)" />
        <text x="79" y="30" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Buy →</text>
        <path d="M76,42 L60,38" stroke={C.red} strokeWidth="1.4" fill="none" />
        <path d="M63,35 L59,38 L63,41" fill="none" stroke={C.red} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        <text x="79" y="40" fontSize="6.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">← Sell</text>
        <text x="79" y="49" fontSize="6" fill={C.red} fontFamily="system-ui,sans-serif">same day!</text>
        <text x="69" y="76" textAnchor="middle" fontSize="6.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">No real conviction</text>
        <rect x="146" y="4" width="130" height="82" rx="5" fill="rgba(52,211,153,0.04)" stroke={C.border} strokeWidth="0.6" />
        <text x="211" y="15" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Delivery buyer</text>
        {person(175, 24, C.green)}
        <path d="M189,34 L204,34" stroke={C.green} strokeWidth="1.4" fill="none" />
        <path d="M200,31 L205,34 L200,37" fill="none" stroke={C.green} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
        <rect x="205" y="26" width="24" height="16" rx="3" fill="none" stroke={C.green} strokeWidth="1.4" />
        <text x="217" y="36" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">HOLD</text>
        <text x="211" y="62" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">held overnight ✓</text>
        <text x="211" y="72" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">PineX tracks this %</text>
        <text x="211" y="80" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.8">= serious money signal</text>
      </svg>
    </div>
  )
}

function DeliveryBreakoutChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="4" y="4" width="130" height="82" rx="5" fill="rgba(52,211,153,0.04)" stroke={C.border} strokeWidth="0.6" />
        <text x="69" y="14" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Strong breakout</text>
        <rect x="20" y="46" width="8" height="14" rx="1" fill={C.green} opacity="0.5" />
        <rect x="34" y="40" width="8" height="20" rx="1" fill={C.green} opacity="0.5" />
        <rect x="48" y="34" width="8" height="26" rx="1" fill={C.green} opacity="0.5" />
        <rect x="64" y="22" width="12" height="32" rx="2" fill={C.green} opacity="0.85" />
        <line x1="70" y1="18" x2="70" y2="22" stroke={C.green} strokeWidth="1.5" />
        <line x1="16" y1="58" x2="112" y2="58" stroke={C.border} strokeWidth="0.8" />
        <rect x="62" y="42" width="16" height="16" rx="1" fill={C.textFaint} opacity="0.25" />
        <rect x="62" y="50" width="16" height="8" rx="1" fill={C.green} opacity="0.7" />
        <text x="80" y="50" fontSize="6.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">Total</text>
        <text x="80" y="57" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Del 60%</text>
        <text x="69" y="74" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Real buying ✅</text>
        <rect x="146" y="4" width="130" height="82" rx="5" fill="rgba(251,191,36,0.04)" stroke={C.border} strokeWidth="0.6" />
        <text x="211" y="14" textAnchor="middle" fontSize="7.5" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Suspicious breakout</text>
        <rect x="162" y="46" width="8" height="14" rx="1" fill={C.green} opacity="0.5" />
        <rect x="176" y="40" width="8" height="20" rx="1" fill={C.green} opacity="0.5" />
        <rect x="190" y="34" width="8" height="26" rx="1" fill={C.green} opacity="0.5" />
        <rect x="206" y="22" width="12" height="32" rx="2" fill={C.green} opacity="0.85" />
        <line x1="212" y1="18" x2="212" y2="22" stroke={C.green} strokeWidth="1.5" />
        <line x1="158" y1="58" x2="254" y2="58" stroke={C.border} strokeWidth="0.8" />
        <rect x="204" y="42" width="16" height="16" rx="1" fill={C.textFaint} opacity="0.25" />
        <rect x="204" y="55" width="16" height="3" rx="1" fill={C.amber} opacity="0.7" />
        <text x="222" y="50" fontSize="6.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">Total</text>
        <text x="222" y="57" fontSize="6.5" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Del 20%</text>
        <text x="211" y="74" textAnchor="middle" fontSize="7" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Suspicious ⚠</text>
      </svg>
    </div>
  )
}

function VolumeDryUpChart() {
  const price = [[10,68],[22,60],[34,52],[46,44],[58,36],[68,30],[76,24],[84,20],[92,18],[100,22],[108,28],[114,34],[118,38],[122,36],[126,32],[132,26],[140,20],[150,14],[162,8],[178,4],[196,4]]
  const ma    = [[10,72],[60,62],[110,50],[160,34],[200,18]]
  const bars  = [
    { x: 16, h: 18 }, { x: 28, h: 20 }, { x: 40, h: 16 }, { x: 52, h: 22 }, { x: 64, h: 18 },
    { x: 76, h: 20 }, { x: 88, h: 16 },
    { x: 100,h:  4, dry: true }, { x: 112, h: 3, dry: true }, { x: 124, h: 4, dry: true }, { x: 136, h: 3, dry: true },
    { x: 148,h: 22, surge: true }, { x: 160, h: 24, surge: true }, { x: 172, h: 20 }, { x: 184, h: 22 },
  ]
  const base = 88, bw = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 210 112" width="100%" style={{ display: 'block' }}>
        <line x1="6" y1={base} x2="204" y2={base} stroke={C.border} strokeWidth="0.8" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="1.5" strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {bars.map((b, i) => (
          <rect key={i} x={b.x - bw / 2} y={base - b.h} width={bw} height={b.h} rx="1"
            fill={b.dry ? C.textFaint : (b.surge ? C.green : C.green)}
            opacity={b.dry ? 0.3 : 0.6} />
        ))}
        <rect x="90" y="80" width="54" height="14" rx="3" fill={C.surface} stroke={C.border} strokeWidth="0.8" />
        <text x="117" y="90" textAnchor="middle" fontSize="6.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Volume dry-up</text>
        <path d="M147,44 L150,36 L153,44" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <text x="150" y="32" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="150" y="24" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif">Vol surge!</text>
        <text x="8" y="105" fontSize="6.5" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
      </svg>
    </div>
  )
}

function VolumeHeroChart() {
  const price = [[10,68],[22,60],[34,52],[48,46],[62,38],[72,32],[80,26],[88,22],[96,20],[104,24],[110,30],[116,36],[120,40],[124,36],[130,28],[140,20],[152,12],[168,6],[188,4],[206,4]]
  const ma    = [[10,72],[55,62],[105,50],[155,34],[205,18]]
  const bars  = [
    { x: 16, h: 16, up: true  }, { x: 28, h: 5,  up: false },
    { x: 40, h: 18, up: true  }, { x: 54, h: 4,  up: false },
    { x: 68, h: 20, up: true  }, { x: 80, h: 4,  up: false },
    { x: 92, h: 4,  dry: true }, { x: 104,h: 3,  dry: true }, { x: 116,h: 4,  dry: true },
    { x: 128,h: 22, up: true, surge: true }, { x: 140,h: 5, up: false },
    { x: 154,h: 22, up: true  }, { x: 166,h: 4,  up: false },
    { x: 180,h: 20, up: true  }, { x: 192,h: 4,  up: false },
  ]
  const base = 84, bw = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 220 108" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0" width="220" height="108" fill="rgba(52,211,153,0.03)" />
        <line x1="6" y1={base} x2="214" y2={base} stroke={C.border} strokeWidth="0.8" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="1.8" strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {bars.map((b, i) => (
          <rect key={i} x={b.x - bw / 2} y={base - b.h} width={bw} height={b.h} rx="1"
            fill={b.dry ? C.textFaint : (b.up ? C.green : C.red)}
            opacity={b.dry ? 0.3 : (b.up ? 0.6 : 0.4)} />
        ))}
        <rect x="82" y="76" width="50" height="12" rx="3" fill={C.surface} stroke={C.border} strokeWidth="0.7" />
        <text x="107" y="85" textAnchor="middle" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif">dry-up zone</text>
        <path d="M124,45 L128,36 L132,45" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinejoin="round" />
        <text x="128" y="32" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="128" y="24" textAnchor="middle" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif">surge+delivery</text>
        <text x="8"  y="100" fontSize="6.5" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
        <text x="180" y="18" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2</text>
      </svg>
    </div>
  )
}

// ─── Content data — Module 4 ─────────────────────────────────────────────────

const M4_LESSONS = [
  {
    id: 'm4-avg',
    icon: '📐',
    title: 'What is an Average?',
    body: [
      'Before we talk about moving averages, let\'s get clear on what a simple average is.',
      'Imagine 5 students scored: 60, 70, 50, 80, 90 in a test. The average is (60+70+50+80+90) ÷ 5 = 70.',
      'The average gives you one number that represents the whole group. In markets, we use averages to represent a stock\'s price over a period of time — smoothing out the noise.',
    ],
    rule: 'An average turns many numbers into one representative number.',
  },
  {
    id: 'm4-ma-window',
    icon: '🪟',
    title: 'What is a Moving Average?',
    body: [
      'A Moving Average (MA) is an average that moves forward in time. Instead of averaging everything ever, it averages only the last N weeks.',
      'Think of it like a sliding window on a train. You only see the last few trees — the scenery keeps refreshing as you move forward.',
      'For a 30-Week Moving Average: each week, take the closing price from the last 30 weeks, add them up, divide by 30. As a new week arrives, drop the oldest week and include the newest.',
      'The result is a smooth line that follows the price trend — cutting through all the weekly noise.',
    ],
    tip: 'A moving average does not predict the future. It shows you the average direction of the recent past.',
  },
  {
    id: 'm4-why-30w',
    icon: '📅',
    title: 'Why 30 WEEKS and not days?',
    body: [
      'You could use a 30-day MA — but daily prices bounce around a lot. News, earnings, institutional activity — all create daily volatility that has nothing to do with the real trend.',
      'Weekly prices are calmer. Each weekly candle represents 5 trading days. A 30-week MA covers about 7 months — long enough to show a meaningful trend, short enough to react when things change.',
      'Stan Weinstein popularised the 30-Week MA in his book "Secrets for Profiting in Bull and Bear Markets." Decades of data show it reliably separates Stage 2 (rising) stocks from Stage 4 (falling) stocks.',
    ],
    rule: 'Use weekly charts. Use the 30-week MA. Ignore daily noise.',
  },
  {
    id: 'm4-4rules',
    icon: '📋',
    title: 'The 4 Rules of 30W MA',
    body: [
      'The 30-Week MA is the backbone of Weinstein\'s method. Here are the four rules that define each stage:',
      '① Price above a rising MA → Stage 2 (Bull trend). This is where you want to own stocks.',
      '② MA turns flat + price chops sideways → Stage 1 (Base). The stock is resting. Wait.',
      '③ MA turns flat + price chops after a big rise → Stage 3 (Top). Exit or do not buy.',
      '④ Price below a falling MA → Stage 4 (Bear trend). Do not buy. If you own it, sell.',
    ],
    rule: 'Above rising MA = Stage 2. Below falling MA = Stage 4. These two rules do most of the work.',
  },
  {
    id: 'm4-support',
    icon: '🧲',
    title: 'The MA is also Support',
    body: [
      'In a healthy Stage 2 uptrend, the 30W MA acts like a magnet — price dips down to it and then bounces back up.',
      'This is called a "pullback to the MA." It is one of the best times to enter a trade. The stock has already proven it is in Stage 2, and now it is offering you a lower price near a natural support level.',
      'Professional traders call this "buying on a pullback." Instead of chasing the price when it is extended, you wait for the market to bring the price back to a safer entry zone near the MA.',
    ],
    tip: 'Entry near the rising 30W MA during a pullback = lower risk, higher reward.',
  },
  {
    id: 'm4-extended',
    icon: '⚠️',
    title: 'What if price is far above the MA?',
    body: [
      'When a stock has been rising for many weeks without a pullback, the price can get far above the 30W MA. This is called being "overextended" or "stretched like a rubber band."',
      'The further the price is above the MA, the more likely it is to snap back. Buying here means you are paying top price and accepting the risk of a sharp pullback — even if the long-term trend is still up.',
      'The smart move: wait. Let the stock either pull back to the MA or consolidate sideways until the MA catches up. Patience here often means entering at a much better price.',
    ],
    rule: 'Never chase a stock that is 20–30%+ above its 30W MA. Wait for the rubber band to snap back.',
  },
  {
    id: 'm4-summary',
    icon: '🗺️',
    title: 'The 30W MA — Summary',
    body: [
      'You now have a powerful tool: the 30-Week Moving Average. Here is how to use it in one simple framework:',
      '① Find a stock in Stage 2 — price above a rising 30W MA.',
      '② Wait for a pullback to the MA, not an overextended price.',
      '③ Enter near the MA. Place your stop-loss just below it.',
      '④ Stay in the trade as long as price stays above the rising MA.',
      'Combined with Rising RS (from Module 3), this gives you a complete buying framework — Stage 2 + Rising RS + Pullback to 30W MA.',
    ],
    rule: 'Stage 2 + Rising RS + Pullback to 30W MA = high-quality entry setup.',
  },
]

const M4_QUIZ = [
  {
    question: 'A stock\'s price has been falling for months and is now trading well below its 30-Week MA, which is also pointing downward. What stage is this stock in?',
    options: [
      'Stage 2 — it is ready to buy, the MA confirms the uptrend',
      'Stage 4 — price below a falling MA means a downtrend, avoid',
      'Stage 1 — the stock is basing and preparing for a move up',
      'Stage 3 — the stock is topping out near the MA',
    ],
    correct: 1,
    explanation: 'Price below a falling 30W MA is the definition of Stage 4 — a downtrend. You should not buy here. The MA is declining, confirming that sellers are in control. Wait for a new Stage 1 base to form before even watching this stock again.',
  },
  {
    question: 'A Stage 2 stock with rising RS has just pulled back to its rising 30W MA at ₹420. It is holding there. Is this a good entry?',
    options: [
      'Yes — Stage 2 + rising RS + pullback to rising MA is a textbook entry',
      'No — you should only buy when price is far above the MA',
      'No — pullbacks always signal the end of the uptrend',
      'Yes, but only if Nifty is in Stage 4',
    ],
    correct: 0,
    explanation: 'A pullback to the rising 30W MA in a Stage 2 stock with strong RS is exactly the setup you want. The MA is acting as support, giving you a low-risk entry point. Your stop-loss goes just below the MA — if the stock breaks below it, the Stage 2 trend may be ending.',
  },
]

// ─── Module 6 charts — Support & Resistance ──────────────────────────────────

function SupportBounceChart() {
  const price = [[0,30],[15,38],[30,52],[42,62],[58,44],[72,28],[84,36],[98,52],[110,62],[124,44],[138,28],[152,36],[168,54],[180,62],[198,42],[220,18],[248,8],[270,5]]
  const bounces = [[42,62],[110,62],[180,62]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 78" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1={62} x2="280" y2={62} stroke={C.green} strokeWidth="1.5" strokeDasharray="6,3" />
        <text x="8" y={57} fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Support</text>
        <polyline points={P(price)} fill="none" stroke={C.text} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        {bounces.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5} fill="none" stroke={C.green} strokeWidth="1.8" />)}
        <text x="140" y="74" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">More bounces = stronger support</text>
      </svg>
    </div>
  )
}

function ResistanceRejectionChart() {
  const price = [[0,68],[18,52],[32,36],[46,18],[60,34],[74,54],[88,40],[102,22],[114,18],[126,34],[140,56],[154,42],[168,24],[178,18],[192,34],[212,54],[238,62],[265,68]]
  const rejections = [[46,18],[114,18],[178,18]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 78" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1={18} x2="280" y2={18} stroke={C.red} strokeWidth="1.5" strokeDasharray="6,3" />
        <text x="8" y={30} fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">Resistance</text>
        <polyline points={P(price)} fill="none" stroke={C.text} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        {rejections.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={5} fill="none" stroke={C.red} strokeWidth="1.8" />)}
        <text x="140" y="74" textAnchor="middle" fontSize="7" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">Trapped sellers create resistance</text>
      </svg>
    </div>
  )
}

function SRPsychologyChart() {
  const price = [[0,48],[22,68],[38,42],[58,20],[74,48],[94,68],[112,42],[132,20],[148,54],[168,68]]
  const suppY = 68, resY = 20
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 88" width="100%" style={{ display: 'block' }}>
        <rect x="0" y={suppY - 2} width="280" height="20" fill="rgba(52,211,153,0.10)" />
        <rect x="0" y="0"         width="280" height={resY + 4} fill="rgba(248,113,113,0.10)" />
        <line x1="0" y1={suppY} x2="280" y2={suppY} stroke={C.green} strokeWidth="1.4" strokeDasharray="6,3" />
        <line x1="0" y1={resY}  x2="280" y2={resY}  stroke={C.red}   strokeWidth="1.4" strokeDasharray="6,3" />
        <polyline points={P(price)} fill="none" stroke={C.accent} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {[200, 220, 240].map((x, i) => (
          <g key={'res'+i}>
            <circle cx={x} cy={resY - 8} r={4} fill="none" stroke={C.red}   strokeWidth="1.2" />
            <line x1={x} y1={resY - 4} x2={x} y2={resY + 2} stroke={C.red}   strokeWidth="1.2" />
          </g>
        ))}
        {[200, 220, 240].map((x, i) => (
          <g key={'sup'+i}>
            <circle cx={x} cy={suppY + 6} r={4} fill="none" stroke={C.green} strokeWidth="1.2" />
            <line x1={x} y1={suppY + 10} x2={x} y2={suppY + 18} stroke={C.green} strokeWidth="1.2" />
          </g>
        ))}
        <text x="8" y={resY - 6}    fontSize="7.5" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Sellers exit ↓  — relief selling</text>
        <text x="8" y={suppY + 22}  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Buyers step in ↑ — fear of missing out</text>
      </svg>
    </div>
  )
}

function FlipRuleChart() {
  const sec1 = [[0,68],[15,54],[28,40],[40,30],[52,46],[66,68],[76,52],[88,30]]
  const sec3 = [[122,6],[136,12],[150,22],[160,30],[165,26],[174,18],[188,8],[210,4],[245,2],[275,2]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 82" width="100%" style={{ display: 'block' }}>
        <line x1="0"   y1={30} x2={106} y2={30} stroke={C.red}   strokeWidth="1.4" strokeDasharray="5,3" />
        <line x1={106} y1={30} x2="280" y2={30} stroke={C.green} strokeWidth="1.4" strokeDasharray="5,3" />
        <line x1="96"  y1="0"  x2="96"  y2="56" stroke={C.border} strokeWidth="0.6" strokeDasharray="2,2" />
        <line x1="178" y1="0"  x2="178" y2="56" stroke={C.border} strokeWidth="0.6" strokeDasharray="2,2" />
        <polyline points={P(sec1)} fill="none" stroke={C.text}  strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
        <line x1="111" y1="3"  x2="111" y2="6"  stroke={C.green} strokeWidth="1.5" />
        <rect x="104"  y="6"   width="14" height="24" rx="2" fill={C.green} opacity="0.85" />
        <text x="111"  y="48" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Breakout!</text>
        <line x1="96"  y1="54" x2="178" y2="54" stroke={C.border} strokeWidth="0.7" />
        <rect x="104"  y="38"  width="14" height="16" rx="1" fill={C.green} opacity="0.4" />
        <polyline points={P(sec3)} fill="none" stroke={C.green} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="160" cy="30" r="5" fill="none" stroke={C.green} strokeWidth="1.8" />
        <text x="8"   y="26" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Resistance</text>
        <text x="182" y="26" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">New Support ✓</text>
        <text x="48"  y="74" textAnchor="middle" fontSize="6.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">keeps failing</text>
        <text x="137" y="74" textAnchor="middle" fontSize="6.5" fill={C.green}     fontFamily="system-ui,sans-serif">breaks through</text>
        <text x="224" y="74" textAnchor="middle" fontSize="6.5" fill={C.green}     fontFamily="system-ui,sans-serif">re-test holds ↑</text>
      </svg>
    </div>
  )
}

function SRwithMAChart() {
  const price = [[0,80],[22,70],[44,60],[65,52],[80,44],[94,36],[106,28],[116,22],[122,16],[128,22],[132,34],[136,46],[139,56],[142,52],[146,42],[156,28],[170,16],[190,6],[218,3],[255,2]]
  const ma    = [[0,82],[50,74],[100,64],[150,50],[200,32],[260,14]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 96" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1={56} x2="280" y2={56} stroke={C.green} strokeWidth="1.2" strokeDasharray="5,3" opacity="0.55" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="1.8" strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <rect x="126" y="46" width="28" height="18" rx="4" fill="rgba(52,211,153,0.18)" stroke={C.green} strokeWidth="1" strokeDasharray="3,2" />
        <path d="M137,68 L140,60 L143,68" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinejoin="round" />
        <text x="140" y="76" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="140" y="84" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">Double support zone</text>
        <text x="140" y="92" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.8">30W MA + horiz. level</text>
        <text x="8"   y={52} fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" opacity="0.7">Support level</text>
        <text x="230" y="28" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
      </svg>
    </div>
  )
}

function SRLevelsChart() {
  const price = [[0,68],[18,54],[34,40],[46,40],[58,54],[72,68],[86,54],[100,40],[116,56],[130,68],[145,56],[158,40],[170,28],[180,16],[192,22],[204,28],[215,22],[228,12],[248,8],[270,5]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 82" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1="68" x2="280" y2="68" stroke={C.green}  strokeWidth="1.5" strokeDasharray="6,3" />
        <line x1="0" y1="40" x2="280" y2="40" stroke={C.amber}  strokeWidth="1.2" strokeDasharray="5,3" opacity="0.8" />
        <line x1="0" y1="16" x2="280" y2="16" stroke={C.blue}   strokeWidth="1.2" strokeDasharray="4,3" opacity="0.8" />
        <polyline points={P(price)} fill="none" stroke={C.text} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        {[[72,68],[130,68]].map(([x,y],i) => <circle key={'sg'+i} cx={x} cy={y} r={4} fill="none" stroke={C.green} strokeWidth="1.5" />)}
        {[[46,40],[100,40]].map(([x,y],i) => <circle key={'sh'+i} cx={x} cy={y} r={4} fill="none" stroke={C.amber} strokeWidth="1.5" />)}
        <circle cx="180" cy="16" r="4" fill="none" stroke={C.blue} strokeWidth="1.5" />
        <text x="8" y="63" fontSize="7" fill={C.green}  fontFamily="system-ui,sans-serif" fontWeight="700">Strong support — tested 3x</text>
        <text x="8" y="35" fontSize="7" fill={C.amber}  fontFamily="system-ui,sans-serif" fontWeight="700">Old resistance — now support (Flip Rule)</text>
        <text x="8" y="12" fontSize="7" fill={C.blue}   fontFamily="system-ui,sans-serif" fontWeight="700">52W high breakout — key level</text>
      </svg>
    </div>
  )
}

function SRHeroChart() {
  const price1 = [[0,68],[15,56],[28,44],[40,30],[52,48],[64,68],[76,54],[88,42],[97,30]]
  const price2 = [[97,30],[106,22],[114,12],[120,6]]
  const price3 = [[120,6],[132,12],[144,22],[154,30],[160,26],[170,16],[186,6],[210,3],[248,2],[275,2]]
  const ma     = [[0,80],[55,72],[110,60],[165,44],[220,24],[275,8]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 96" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0" width="280" height="96" fill="rgba(52,211,153,0.03)" />
        <line x1="0"   y1="68" x2="280" y2="68" stroke={C.green} strokeWidth="1.2" strokeDasharray="6,3" opacity="0.55" />
        <line x1="0"   y1="30" x2="100" y2="30" stroke={C.red}   strokeWidth="1.3" strokeDasharray="5,3" />
        <line x1="100" y1="30" x2="280" y2="30" stroke={C.green} strokeWidth="1.3" strokeDasharray="5,3" />
        <polyline points={P(ma)}     fill="none" stroke={C.accent} strokeWidth="2"   strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price1)} fill="none" stroke={C.text}   strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
        <polyline points={P(price2)} fill="none" stroke={C.green}  strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(price3)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="64"  cy="68" r="4"  fill="none" stroke={C.green} strokeWidth="1.5" />
        <circle cx="154" cy="30" r="5"  fill="none" stroke={C.green} strokeWidth="1.8" />
        <path d="M151,38 L154,30 L157,38" fill="none" stroke={C.green} strokeWidth="1.8" strokeLinejoin="round" />
        <text x="154" y="48" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="8"   y="63" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">Support</text>
        <text x="8"   y="26" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif">Resistance →</text>
        <text x="166" y="26" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">New Support</text>
        <text x="8"   y="88" fontSize="7" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA</text>
        <text x="200" y="18" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2 uptrend</text>
      </svg>
    </div>
  )
}

// ─── Content data — Module 5 ─────────────────────────────────────────────────

const M5_LESSONS = [
  {
    id: 'm5-vol-intro',
    icon: '🏪',
    title: 'What is Volume?',
    body: [
      'Imagine a vegetable market. On a normal day, 100 people come and buy tomatoes. One day suddenly 1,000 people show up — and the price shoots up. That surge in buyers tells you something real is happening.',
      'Volume in stocks = how many shares were bought and sold that day. If 5 lakh shares traded today, that is the volume.',
      'High volume = many people are interested. Something is happening. Low volume = quiet day, nobody cares much.',
      'Volume alone does not tell you if a stock will go up or down. But combined with price, it tells you whether a move is real or fake.',
    ],
    rule: 'Volume = the crowd\'s interest level. More people = more conviction.',
  },
  {
    id: 'm5-vol-confirm',
    icon: '🏏',
    title: 'Volume confirms price moves',
    body: [
      'This is the most important rule: a price move with HIGH volume = real and trustworthy. A price move with LOW volume = suspicious, may not last.',
      'Think of a cricket match. If only 3 people clap when a batsman hits a six — was it really a great shot? But if 50,000 people roar — you know it was special.',
      'Volume is the crowd\'s reaction to the price move. A big price jump on tiny volume is like a tree falling in an empty forest — did it really matter?',
    ],
    rule: 'Big price move + high volume = trust it. Big price move + low volume = question it.',
  },
  {
    id: 'm5-vol-stage2',
    icon: '📈',
    title: 'Volume during Stage 2',
    body: [
      'In a healthy Stage 2 uptrend, you want to see a specific pattern: high volume on up days and low volume on down days.',
      'High volume on up days = institutions (mutual funds, FIIs) are actively buying. Low volume on down days = nobody is panicking and selling hard — just normal resting.',
      'If you see HIGH volume on a DOWN day in a Stage 2 stock, that is a warning sign. Big players may be quietly selling into strength — this is called distribution.',
    ],
    rule: 'Healthy Stage 2 = high vol up days + low vol down days. High vol on red days = warning.',
  },
  {
    id: 'm5-delivery',
    icon: '📦',
    title: 'What is Delivery Volume?',
    body: [
      'When you buy a stock you have two choices. Intraday: buy and sell the same day — no real ownership, just trading. Delivery: you actually take the stock into your demat account — you believe in it enough to hold it.',
      'Delivery volume = only the shares that were actually delivered (held overnight). This filters out all the day-traders and shows only the serious buyers.',
      'High delivery % means real investors are buying and holding — not just traders playing for the day. This is a much stronger signal.',
    ],
    tip: 'PineX tracks Delivery % for every stock. It is the "serious money" indicator.',
  },
  {
    id: 'm5-delivery-pinex',
    icon: '🔬',
    title: 'How PineX uses Delivery Volume',
    body: [
      'On PineX, every Stage 2 stock shows delivery volume data alongside total volume. Here is what to look for:',
      'Delivery % above 50% on a breakout day = strong signal. Real buyers are accumulating. Consistently high delivery over multiple days = institutions building a position.',
      'Low delivery % (below 30%) even on big up days = operators or intraday traders driving the price. This is not sustainable — the move will likely fade.',
      'SwingX entries require strong delivery volume as one of the confirmation filters before flagging a stock as a buy candidate.',
    ],
    rule: 'Delivery % > 50% on breakout = real buying. Delivery % < 30% = be careful.',
  },
  {
    id: 'm5-dryup',
    icon: '🌵',
    title: 'Volume Dry-Up — the secret signal',
    body: [
      'Before a big move up, volume often dries up during a pullback. Price pulls back gently on very low volume — like the stock is just resting, taking a breath. Nobody is selling hard.',
      'Then suddenly volume surges and price breaks out again. This pattern — low volume pullback followed by high volume surge — is one of the most reliable signals in the Weinstein method.',
      'Combined with a pullback to the rising 30W MA, a volume dry-up is one of the best entry setups available. PineX tracks this pattern automatically.',
    ],
    rule: 'Volume dry-up during pullback to 30W MA = stock resting before next move. Watch closely.',
  },
  {
    id: 'm5-summary',
    icon: '🗺️',
    title: 'Volume & Delivery — Summary',
    body: [
      'You now have three powerful confirmation tools working together. Here is the complete framework:',
      '① Volume confirms price moves — high vol + price up = real. Low vol + price up = suspicious.',
      '② Delivery % shows serious buyers — above 50% on breakout = institutions buying and holding.',
      '③ Volume dry-up on pullback = stock resting before next leg up — best entry zone.',
      'Add these to your checklist: Stage 2 + Rising RS + Pullback to 30W MA + High Delivery % = the highest quality entry setup.',
    ],
    rule: 'Stage 2 + Rising RS + 30W MA pullback + High Delivery % = complete buy signal.',
  },
]

const M5_QUIZ = [
  {
    question: 'A Stage 2 stock breaks out to a new 52-week high today. But the volume is only 30% of its normal average, and delivery is just 18%. Should you buy immediately?',
    options: [
      'Yes — a new 52-week high is always a strong buy signal',
      'No — low total volume and very low delivery % means this breakout is weak and likely not backed by institutions',
      'Yes — delivery % does not matter, only price matters',
      'No — you should never buy breakouts, only pullbacks',
    ],
    correct: 1,
    explanation: 'Low total volume (30% of average) and very low delivery (18%) means institutions are not behind this move. It could be operators or intraday traders pushing the price. A real, sustainable breakout needs high volume and high delivery %. Wait for confirmation before entering.',
  },
  {
    question: 'A stock pulls back from ₹300 to ₹265 over 5 days. The 30W MA is at ₹260. During these 5 days the volume bars are very small — much lower than usual. What does this tell you?',
    options: [
      'The stock is in Stage 4 — sell immediately',
      'This is a volume dry-up on a pullback to the MA — a bullish resting pattern. Watch for a volume surge to enter',
      'Low volume means no one wants this stock — avoid',
      'The stock will definitely keep falling to ₹200',
    ],
    correct: 1,
    explanation: 'A low-volume pullback to the rising 30W MA is one of the most bullish patterns in the Weinstein method. Nobody is selling hard — the stock is just resting. If volume surges and price bounces from the ₹260 MA level, that is a high-quality entry point with a clear stop just below the MA.',
  },
]

// ─── Module 7 charts — How to Read a Stock Chart ────────────────────────────

function StoryArcChart() {
  const s1 = [[0,54],[12,50],[24,56],[36,50],[48,56],[60,50],[70,50]]
  const s2 = [[70,50],[84,44],[98,38],[112,32],[126,26],[138,20],[150,14],[162,10],[175,8]]
  const s3 = [[175,8],[182,18],[188,8],[196,22],[202,12],[210,20]]
  const s4 = [[210,20],[222,30],[232,26],[244,38],[256,44],[268,52],[280,62]]
  const zones = [
    { x: 0,   w: 70,  color: C.textMuted, bg: 'rgba(148,158,171,0.07)', stage: 'Stage 1', emotion: 'Nobody cares' },
    { x: 70,  w: 105, color: C.green,     bg: 'rgba(52,211,153,0.07)',  stage: 'Stage 2', emotion: 'Smart money buys' },
    { x: 175, w: 35,  color: C.amber,     bg: 'rgba(251,191,36,0.07)',  stage: 'Stage 3', emotion: 'Everyone excited' },
    { x: 210, w: 70,  color: C.red,       bg: 'rgba(248,113,113,0.07)', stage: 'Stage 4', emotion: 'Everyone selling' },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 84" width="100%" style={{ display: 'block' }}>
        {zones.map((z, i) => <rect key={i} x={z.x} y={0} width={z.w} height={84} fill={z.bg} />)}
        {[70, 175, 210].map(x => <line key={x} x1={x} y1={0} x2={x} y2={84} stroke={C.border} strokeWidth="0.5" />)}
        {zones.map((z, i) => (
          <g key={i}>
            <text x={z.x + z.w / 2} y={72} textAnchor="middle" fontSize="7" fill={z.color} fontFamily="system-ui,sans-serif" fontWeight="700">{z.stage}</text>
            <text x={z.x + z.w / 2} y={80} textAnchor="middle" fontSize="6.5" fill={z.color} fontFamily="system-ui,sans-serif" opacity="0.8">{z.emotion}</text>
          </g>
        ))}
        <polyline points={P(s1)} fill="none" stroke={C.textMuted} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s2)} fill="none" stroke={C.green}     strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s3)} fill="none" stroke={C.amber}     strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(s4)} fill="none" stroke={C.red}       strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function CandlestickDiagramChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 102" width="100%" style={{ display: 'block' }}>
        {/* Green candle */}
        <line x1="60" y1="8"  x2="60" y2="18" stroke={C.green} strokeWidth="1.5" />
        <rect x="48" y="18"  width="24" height="36" rx="2" fill={C.green} opacity="0.85" />
        <line x1="60" y1="54" x2="60" y2="68" stroke={C.green} strokeWidth="1.5" />
        <line x1="62" y1="8"  x2="80"  y2="8"  stroke={C.textFaint} strokeWidth="0.7" />
        <text x="82"  y="11"  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">High</text>
        <line x1="72" y1="18" x2="80"  y2="18" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="82"  y="21"  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif">Close</text>
        <line x1="72" y1="36" x2="80"  y2="36" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="82"  y="39"  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Body</text>
        <line x1="72" y1="54" x2="80"  y2="54" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="82"  y="57"  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif">Open</text>
        <line x1="62" y1="68" x2="80"  y2="68" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="82"  y="71"  fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Low</text>
        <text x="60"  y="82"  textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">GREEN = Buyers won</text>
        {/* Red candle */}
        <line x1="220" y1="10" x2="220" y2="22" stroke={C.red} strokeWidth="1.5" />
        <rect x="208"  y="22"  width="24" height="36" rx="2" fill={C.red} opacity="0.85" />
        <line x1="220" y1="58" x2="220" y2="72" stroke={C.red} strokeWidth="1.5" />
        <line x1="207" y1="10" x2="190" y2="10" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="188"  y="13"  textAnchor="end" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">High</text>
        <line x1="208" y1="22" x2="190" y2="22" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="188"  y="25"  textAnchor="end" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif">Open</text>
        <line x1="208" y1="40" x2="190" y2="40" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="188"  y="43"  textAnchor="end" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">Body</text>
        <line x1="208" y1="58" x2="190" y2="58" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="188"  y="61"  textAnchor="end" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif">Close</text>
        <line x1="207" y1="72" x2="190" y2="72" stroke={C.textFaint} strokeWidth="0.7" />
        <text x="188"  y="75"  textAnchor="end" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">Low</text>
        <text x="220"  y="84"  textAnchor="middle" fontSize="7" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">RED = Sellers won</text>
        <text x="140"  y="96"  textAnchor="middle" fontSize="6.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Long wick at bottom = buyers fought back strongly</text>
      </svg>
    </div>
  )
}

function DecisionFlowChart() {
  const cx = 140
  const qs = [{ y: 4, w: 80, x: 100, text: 'Is it Stage 2?' }, { y: 32, w: 108, x: 86, text: 'Above rising 30W MA?' }, { y: 60, w: 80, x: 100, text: 'RS rising?' }]
  const rY = 88
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 110" width="100%" style={{ display: 'block' }}>
        {qs.map((q, i) => (
          <g key={i}>
            <rect x={q.x} y={q.y} width={q.w} height={18} rx="5" fill="rgba(56,189,248,0.12)" stroke={C.blue} strokeWidth="1.2" />
            <text x={cx} y={q.y + 12} textAnchor="middle" fontSize="8" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="700">{q.text}</text>
            {/* Yes arrow down */}
            {i < 2 && <>
              <line x1={cx} y1={q.y + 18} x2={cx} y2={qs[i + 1].y - 1} stroke={C.green} strokeWidth="1.2" />
              <path d={`M${cx-4},${qs[i+1].y-4} L${cx},${qs[i+1].y} L${cx+4},${qs[i+1].y-4}`} fill="none" stroke={C.green} strokeWidth="1.2" strokeLinejoin="round" />
              <text x={cx + 6} y={q.y + 27} fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif">Yes ↓</text>
            </>}
            {i === 2 && <>
              <line x1={cx} y1={78} x2={cx} y2={rY - 1} stroke={C.green} strokeWidth="1.2" />
              <path d={`M${cx-4},${rY-4} L${cx},${rY} L${cx+4},${rY-4}`} fill="none" stroke={C.green} strokeWidth="1.2" strokeLinejoin="round" />
              <text x={cx + 6} y={84} fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif">Yes ↓</text>
            </>}
            {/* No exit right */}
            {[() => {
              const rx = q.x + q.w, ry = q.y + 9
              return (
                <g>
                  <line x1={rx} y1={ry} x2={218} y2={ry} stroke={C.red} strokeWidth="1.1" />
                  <path d={`M215,${ry-3} L219,${ry} L215,${ry+3}`} fill="none" stroke={C.red} strokeWidth="1.1" strokeLinejoin="round" />
                  <rect x="220" y={q.y + 1} width="54" height="16" rx="4" fill={C.redBg} stroke={C.red} strokeWidth="1" />
                  <text x="247" y={q.y + 12} textAnchor="middle" fontSize="7.5" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">❌ Skip</text>
                  <text x={rx + 2} y={ry - 2} fontSize="6.5" fill={C.red} fontFamily="system-ui,sans-serif">No →</text>
                </g>
              )
            }][0]()}
          </g>
        ))}
        {/* ✅ Result */}
        <rect x="97" y={rY} width="86" height="20" rx="5" fill={C.greenBg} stroke={C.green} strokeWidth="1.4" />
        <text x={cx} y={rY + 14} textAnchor="middle" fontSize="9" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">✅ Look closer!</text>
        <text x="8" y="107" fontSize="6" fill={C.textFaint} fontFamily="system-ui,sans-serif">Modules 1 · 4 · 3</text>
      </svg>
    </div>
  )
}

function StaircaseChart() {
  const price = [[0,66],[10,64],[20,68],[35,58],[50,44],[62,40],[74,52],[86,58],[100,46],[115,32],[128,28],[140,40],[152,50],[158,48],[164,42],[170,36],[174,34],[178,36],[182,34],[188,26],[204,16],[220,10],[244,8],[268,6]]
  const ma    = [[0,70],[55,62],[110,52],[165,38],[225,20],[270,8]]
  const vols  = [
    { x: 50,  h: 16, g: true }, { x: 128, h: 18, g: true }, { x: 204, h: 22, g: true },
    { x: 86,  h: 4,  g: false }, { x: 152, h: 3,  g: false },
  ]
  const base = 82, bw = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 96" width="100%" style={{ display: 'block' }}>
        <line x1="0" y1={base} x2="280" y2={base} stroke={C.border} strokeWidth="0.8" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="1.8" strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2"   strokeLinejoin="round" strokeLinecap="round" />
        {vols.map((v, i) => (
          <rect key={i} x={v.x - bw / 2} y={base - v.h} width={bw} height={v.h} rx="1"
            fill={v.g ? C.green : C.red} opacity={v.g ? 0.6 : 0.4} />
        ))}
        <rect x="154" y="30" width="36" height="22" rx="3" fill="rgba(56,189,248,0.10)" stroke={C.blue} strokeWidth="0.8" strokeDasharray="3,2" />
        <text x="172" y="26" textAnchor="middle" fontSize="6.5" fill={C.blue} fontFamily="system-ui,sans-serif">Flat base</text>
        <text x="50"  y="38" textAnchor="middle" fontSize="7"   fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">H1</text>
        <text x="128" y="22" textAnchor="middle" fontSize="7"   fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">H2</text>
        <text x="204" y="10" textAnchor="middle" fontSize="7"   fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">H3</text>
        <text x="20"  y="77" textAnchor="middle" fontSize="7"   fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">L1</text>
        <text x="86"  y="67" textAnchor="middle" fontSize="7"   fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">L2</text>
        <text x="152" y="59" textAnchor="middle" fontSize="7"   fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">L3</text>
        <text x="8"   y="92" fontSize="6.5" fill={C.accent} fontFamily="system-ui,sans-serif">30W MA (M4)</text>
        <text x="172" y="92" fontSize="6.5" fill={C.green}  fontFamily="system-ui,sans-serif">H↑ L↑ = Healthy staircase ✓</text>
      </svg>
    </div>
  )
}

function VolumeHealthChart() {
  const hPrice = [[10,54],[20,48],[30,40],[40,32],[50,24],[58,20],[64,26],[68,34],[72,40],[80,36],[84,28],[88,22],[94,18],[102,14],[112,10]]
  const hBars  = [
    { x: 20, h: 14, g: true }, { x: 30, h: 16, g: true }, { x: 40, h: 18, g: true }, { x: 50, h: 18, g: true },
    { x: 64, h: 3, g: false }, { x: 72, h: 3, g: false }, { x: 84, h: 3, g: false },
    { x: 94, h: 22, g: true }, { x: 102,h: 20, g: true },
  ]
  const wPrice = [[152,52],[162,46],[172,38],[182,30],[192,22],[200,18],[208,22],[214,30],[220,38],[226,44],[232,54],[238,62]]
  const wBars  = [
    { x: 162, h: 16, g: true }, { x: 172, h: 12, g: true }, { x: 182, h: 8, g: true }, { x: 192, h: 4, g: true },
    { x: 208, h: 5, g: false }, { x: 220, h: 4, g: false },
    { x: 232, h: 22, g: false }, { x: 238, h: 18, g: false },
  ]
  const base = 68, bw = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 90" width="100%" style={{ display: 'block' }}>
        <rect x="4"   y="4"  width="134" height="82" rx="5" fill="rgba(52,211,153,0.05)"  stroke={C.border} strokeWidth="0.6" />
        <rect x="142" y="4"  width="134" height="82" rx="5" fill="rgba(248,113,113,0.05)" stroke={C.border} strokeWidth="0.6" />
        <text x="71"  y="15" textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Healthy ✅</text>
        <text x="209" y="15" textAnchor="middle" fontSize="8" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">Warning ⚠</text>
        <line x1="10"  y1={base} x2="130" y2={base} stroke={C.border} strokeWidth="0.7" />
        <line x1="148" y1={base} x2="270" y2={base} stroke={C.border} strokeWidth="0.7" />
        <polyline points={P(hPrice)} fill="none" stroke={C.green} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={P(wPrice)} fill="none" stroke={C.text}  strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" opacity="0.8" />
        {hBars.map((v, i) => <rect key={'h'+i} x={v.x - bw/2} y={base - v.h} width={bw} height={v.h} rx="1" fill={v.g ? C.green : C.red} opacity={v.g ? 0.6 : 0.4} />)}
        {wBars.map((v, i) => <rect key={'w'+i} x={v.x - bw/2} y={base - v.h} width={bw} height={v.h} rx="1" fill={v.g ? C.green : C.red} opacity={v.g ? 0.55 : (i >= 6 ? 0.85 : 0.4)} />)}
        <text x="84"  y="44" fontSize="6.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">dry-up</text>
        <text x="177" y="40" fontSize="6.5" fill={C.amber}     fontFamily="system-ui,sans-serif">vol shrinking</text>
        <text x="235" y="44" fontSize="6.5" fill={C.red}       fontFamily="system-ui,sans-serif">big sell!</text>
        <text x="71"  y="80" textAnchor="middle" fontSize="7"  fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Accumulation</text>
        <text x="209" y="80" textAnchor="middle" fontSize="7"  fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">Distribution</text>
      </svg>
    </div>
  )
}

function ChecklistCardChart() {
  const items = [
    { text: 'Stage 2 — price above rising 30W MA',  mod: 'M1+M4' },
    { text: 'RS line rising vs Nifty',               mod: 'M3'    },
    { text: 'Higher highs + higher lows',            mod: 'M7'    },
    { text: 'Breakout or pullback to support',       mod: 'M6'    },
    { text: 'High delivery % on breakout',           mod: 'M5'    },
    { text: 'Nifty itself in Stage 2',               mod: 'M2'    },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 152" width="100%" style={{ display: 'block' }}>
        <text x="14" y="14" fontSize="9" fill={C.textHeading} fontFamily="system-ui,sans-serif" fontWeight="800">Entry Checklist</text>
        {items.map((item, i) => {
          const y = 20 + i * 18
          return (
            <g key={i}>
              <rect x="12" y={y} width="12" height="12" rx="3" fill={C.greenBg} stroke={C.green} strokeWidth="1.2" />
              <text x="18" y={y + 9} textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">✓</text>
              <text x="30" y={y + 9} fontSize="8" fill={C.text} fontFamily="system-ui,sans-serif">{item.text}</text>
              <text x="268" y={y + 9} textAnchor="end" fontSize="6.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">{item.mod}</text>
            </g>
          )
        })}
        <text x="14"  y="134" fontSize="7.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Confidence:</text>
        <rect x="14"  y="138" width="68"  height="12" rx="3" fill={C.redBg}   stroke={C.red}   strokeWidth="1" />
        <rect x="88"  y="138" width="68"  height="12" rx="3" fill={C.amberBg} stroke={C.amber} strokeWidth="1" />
        <rect x="162" y="138" width="106" height="12" rx="3" fill={C.greenBg} stroke={C.green} strokeWidth="1" />
        <text x="48"  y="147" textAnchor="middle" fontSize="7" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="700">1–2 ❌ Skip</text>
        <text x="122" y="147" textAnchor="middle" fontSize="7" fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">3–4 🟡 Wait</text>
        <text x="215" y="147" textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">5–6 ✅ High confidence</text>
      </svg>
    </div>
  )
}

function MasterChart() {
  const price = [[0,64],[18,58],[30,52],[45,46],[58,40],[70,36],[82,44],[92,52],[100,56],[112,46],[124,38],[134,28],[142,18],[148,12],[154,18],[160,28],[164,34],[168,30],[176,22],[190,12],[210,6],[240,4],[270,3]]
  const ma    = [[0,66],[50,58],[100,48],[150,34],[205,16],[265,6]]
  const suppY = 36
  const vols  = [
    { x: 45,  h: 10, g: true  }, { x: 70,  h: 12, g: true  },
    { x: 92,  h: 4,  g: false }, { x: 100, h: 4,  g: false },
    { x: 134, h: 18, g: true  }, { x: 148, h: 20, g: true  },
    { x: 160, h: 3,  g: false }, { x: 168, h: 3,  g: false },
    { x: 190, h: 14, g: true  }, { x: 210, h: 12, g: true  },
  ]
  const vbase = 84, bw = 10
  const rs = [[0,108],[50,106],[100,103],[150,100],[200,96],[260,93]]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 122" width="100%" style={{ display: 'block' }}>
        <rect x="0" y="0" width="280" height="122" fill="rgba(52,211,153,0.025)" />
        <line x1="0"    y1={suppY} x2={130} y2={suppY} stroke={C.red}   strokeWidth="1"   strokeDasharray="4,3" opacity="0.65" />
        <line x1={130}  y1={suppY} x2="280" y2={suppY} stroke={C.green} strokeWidth="1"   strokeDasharray="4,3" opacity="0.65" />
        <polyline points={P(ma)}    fill="none" stroke={C.accent} strokeWidth="2"   strokeDasharray="5,3" strokeLinejoin="round" />
        <polyline points={P(price)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="0" y1={vbase} x2="280" y2={vbase} stroke={C.border} strokeWidth="0.7" />
        {vols.map((v, i) => <rect key={i} x={v.x - bw/2} y={vbase - v.h} width={bw} height={v.h} rx="1" fill={v.g ? C.green : C.red} opacity={v.g ? 0.6 : 0.4} />)}
        <line x1="0" y1="90" x2="280" y2="90" stroke={C.border} strokeWidth="0.6" />
        <text x="8" y="98" fontSize="6" fill={C.purple} fontFamily="system-ui,sans-serif" fontWeight="700">RS</text>
        <polyline points={P(rs)} fill="none" stroke={C.purple} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M143,24 L147,16 L151,24" fill="none" stroke={C.green} strokeWidth="1.6" strokeLinejoin="round" />
        <text x="147" y="12" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Breakout!</text>
        <circle cx="162" cy="34" r="4"  fill="none" stroke={C.green} strokeWidth="1.5" />
        <text x="162"  y="48"  textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Entry ↑</text>
        <text x="8"    y="62"  fontSize="6"  fill={C.accent} fontFamily="system-ui,sans-serif">30W MA (M4)</text>
        <text x="8"    y="32"  fontSize="6"  fill={C.red}    fontFamily="system-ui,sans-serif">Resistance →</text>
        <text x="172"  y="32"  fontSize="6"  fill={C.green}  fontFamily="system-ui,sans-serif">New Support (M6)</text>
        <text x="232"  y="14"  textAnchor="middle" fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2 ↗</text>
        <text x="35"   y="118" fontSize="6"  fill={C.purple} fontFamily="system-ui,sans-serif">RS rising ↗ (M3)</text>
        <text x="160"  y="118" fontSize="6"  fill={C.textFaint} fontFamily="system-ui,sans-serif">Volume: high on breaks, low on pulls (M5)</text>
      </svg>
    </div>
  )
}

// ─── Module 8 charts ──────────────────────────────────────────────────────────

function BreadthCricketChart() {
  const leftBars  = [18, 16, 20, 15, 19, 17, 21, 14, 18, 16, 20]
  const rightBars = [52, 48, 4, 3, 5, 4, 3, 4, 3, 5, 3]
  const base = 64, bw = 7, gap = 10
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 84" width="100%" style={{ display: 'block' }}>
        {/* Left panel — good breadth */}
        <rect x="0" y="0" width="132" height="84" fill="rgba(52,211,153,0.04)" />
        <text x="66" y="9" textAnchor="middle" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Good Breadth ✅</text>
        {leftBars.map((h, i) => (
          <rect key={'l'+i} x={6 + i * (bw + 2.2)} y={base - h} width={bw} height={h} rx="2" fill={C.green} opacity="0.7" />
        ))}
        <text x="66" y="76" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">All 11 players contributing</text>
        <text x="66" y="83" textAnchor="middle" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">Healthy rally ↑</text>
        {/* Divider */}
        <line x1="136" y1="4" x2="136" y2="80" stroke={C.border} strokeWidth="1" />
        {/* Right panel — poor breadth */}
        <rect x="138" y="0" width="142" height="84" fill="rgba(248,113,113,0.04)" />
        <text x="209" y="9" textAnchor="middle" fontSize="6" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">Poor Breadth ⚠</text>
        {rightBars.map((h, i) => (
          <rect key={'r'+i} x={142 + i * (bw + 2.2)} y={base - h} width={bw} height={h} rx="2" fill={i < 2 ? C.red : C.border} opacity={i < 2 ? 0.8 : 0.5} />
        ))}
        <text x="209" y="76" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Only 2 players scoring big</text>
        <text x="209" y="83" textAnchor="middle" fontSize="5" fill={C.red} fontFamily="system-ui,sans-serif">Weak rally — risky</text>
      </svg>
    </div>
  )
}

function ADLineChart() {
  const nifty = [[0,12],[30,10],[60,8],[90,7],[120,5],[150,4],[180,4],[210,3],[250,2]]
  const adGreen = [[0,72],[40,69],[80,66],[120,63]]
  const adRed   = [[120,63],[160,66],[200,70],[250,74]]
  const P2 = arr => arr.map(([x,y]) => `${x},${y}`).join(' ')
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 110" width="100%" style={{ display: 'block' }}>
        {/* Nifty panel */}
        <text x="6" y="9" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">NIFTY</text>
        <polyline points={P2(nifty)} fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="round" />
        <text x="255" y="4"  textAnchor="end" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif">↗ New High</text>
        <line x1="0" y1="22" x2="280" y2="22" stroke={C.border} strokeWidth="0.7" />
        {/* Divergence zone highlight */}
        <rect x="120" y="0" width="130" height="22" fill="rgba(248,113,113,0.07)" />
        <text x="185" y="20" textAnchor="middle" fontSize="5.5" fill={C.red} fontFamily="system-ui,sans-serif">⚠ Nifty still rising</text>
        {/* A-D Line panel */}
        <text x="6" y="34" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">A-D LINE</text>
        <rect x="0"   y="24" width="122" height="46" fill="rgba(52,211,153,0.05)" />
        <rect x="122" y="24" width="158" height="46" fill="rgba(248,113,113,0.07)" />
        <polyline points={P2(adGreen)} fill="none" stroke={C.green}  strokeWidth="2.2" strokeLinejoin="round" />
        <polyline points={P2(adRed)}  fill="none" stroke={C.red}    strokeWidth="2.2" strokeLinejoin="round" strokeDasharray="5,3" />
        <text x="60"  y="44" textAnchor="middle" fontSize="5.5" fill={C.green}    fontFamily="system-ui,sans-serif" fontWeight="700">Healthy ✅</text>
        <text x="60"  y="52" textAnchor="middle" fontSize="5"   fill={C.textMuted} fontFamily="system-ui,sans-serif">Broad participation</text>
        <text x="185" y="44" textAnchor="middle" fontSize="5.5" fill={C.red}      fontFamily="system-ui,sans-serif" fontWeight="700">⚠ Divergence</text>
        <text x="185" y="52" textAnchor="middle" fontSize="5"   fill={C.textMuted} fontFamily="system-ui,sans-serif">A-D falling, Nifty rising</text>
        <line x1="120" y1="24" x2="120" y2="70" stroke={C.red} strokeWidth="1" strokeDasharray="3,2" opacity="0.6" />
        <line x1="0"   y1="70" x2="280" y2="70" stroke={C.border} strokeWidth="0.7" />
        {/* Explanation */}
        <text x="140" y="82" textAnchor="middle" fontSize="6"   fill={C.red}    fontFamily="system-ui,sans-serif" fontWeight="700">Rally losing steam — danger ahead</text>
        <text x="140" y="92" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Tighten stops. Avoid new buys.</text>
        <rect x="2" y="98" width="276" height="11" rx="4" fill="rgba(248,113,113,0.1)" stroke={C.red} strokeWidth="0.6" opacity="0.7" />
        <text x="140" y="106" textAnchor="middle" fontSize="5.5" fill={C.red} fontFamily="system-ui,sans-serif">⚠ Breadth divergence = often weeks/months before market top</text>
      </svg>
    </div>
  )
}

function BreadthGaugeChart() {
  /* Semi-circle gauge. cx=140, cy=92, r=70. Arc spans 180° (left=180°, right=0°). */
  const cx = 140, cy = 90, r = 62
  const rad = (deg) => (deg * Math.PI) / 180
  /* Each zone: startDeg (from left, 180° = left), endDeg, color */
  const zones = [
    { s: 180, e: 144, fill: '#7f1d1d', label: 'Extreme\nBear', lx: 58,  ly: 84, pct: '0–20%' },
    { s: 144, e: 108, fill: C.red,     label: 'Bear',          lx: 82,  ly: 54, pct: '20–40%' },
    { s: 108, e:  72, fill: C.amber,   label: 'Mixed',         lx: 132, ly: 34, pct: '40–60%' },
    { s:  72, e:  36, fill: C.green,   label: 'Bull',          lx: 182, ly: 54, pct: '60–80%' },
    { s:  36, e:   0, fill: '#6ee7b7', label: 'Strong\nBull',  lx: 208, ly: 84, pct: '80–100%' },
  ]
  const arc = (s, e) => {
    const x1 = cx + r * Math.cos(rad(s)), y1 = cy - r * Math.sin(rad(s))
    const x2 = cx + r * Math.cos(rad(e)), y2 = cy - r * Math.sin(rad(e))
    const ri = r - 20
    const ix1 = cx + ri * Math.cos(rad(s)), iy1 = cy - ri * Math.sin(rad(s))
    const ix2 = cx + ri * Math.cos(rad(e)), iy2 = cy - ri * Math.sin(rad(e))
    return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0,0 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${ri},${ri} 0 0,1 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`
  }
  /* Needle at 65% → angle = 180 - 65*1.8 = 63° */
  const needleDeg = 180 - 65 * 1.8
  const nx = cx + (r - 8) * Math.cos(rad(needleDeg))
  const ny = cy - (r - 8) * Math.sin(rad(needleDeg))
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 108" width="100%" style={{ display: 'block' }}>
        {zones.map((z, i) => (
          <path key={'gz'+i} d={arc(z.s, z.e)} fill={z.fill} opacity="0.85" />
        ))}
        {/* Zone labels */}
        <text x="22"  y="92" textAnchor="middle" fontSize="5" fill={C.textFaint} fontFamily="system-ui,sans-serif">0–20%</text>
        <text x="22"  y="98" textAnchor="middle" fontSize="5" fill={C.textFaint} fontFamily="system-ui,sans-serif">Extreme Bear</text>
        <text x="258" y="92" textAnchor="middle" fontSize="5" fill={C.textFaint} fontFamily="system-ui,sans-serif">80–100%</text>
        <text x="258" y="98" textAnchor="middle" fontSize="5" fill={C.textFaint} fontFamily="system-ui,sans-serif">Strong Bull</text>
        <text x="140" y="30" textAnchor="middle" fontSize="5" fill={C.amber}     fontFamily="system-ui,sans-serif">40–60% Mixed</text>
        {/* Needle */}
        <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill={C.surface} stroke="#fff" strokeWidth="1.5" />
        {/* Center readout */}
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="800">65%</text>
        <text x={cx} y={cy + 23} textAnchor="middle" fontSize="6"  fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Bull Market</text>
        <text x={cx} y={cy - 65} textAnchor="middle" fontSize="6.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">% of stocks above 30W MA</text>
        {/* Scale ticks */}
        {[0,20,40,60,80,100].map(pct => {
          const deg = 180 - pct * 1.8
          const tx = cx + (r + 6) * Math.cos(rad(deg))
          const ty = cy - (r + 6) * Math.sin(rad(deg))
          return <text key={pct} x={tx.toFixed(1)} y={ty.toFixed(1)} textAnchor="middle" fontSize="5" fill={C.textFaint} fontFamily="system-ui,sans-serif">{pct}</text>
        })}
        {/* Threshold labels at bottom */}
        <text x="70"  y="107" textAnchor="middle" fontSize="5" fill={C.red}   fontFamily="system-ui,sans-serif">Below 40% = Bear</text>
        <text x="140" y="107" textAnchor="middle" fontSize="5" fill={C.amber} fontFamily="system-ui,sans-serif">40–60% = Selective</text>
        <text x="210" y="107" textAnchor="middle" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">Above 60% = Buy</text>
      </svg>
    </div>
  )
}

function Stage2CountChart() {
  const bars = [
    { x: 14,  h: 28, g: true  }, { x: 40,  h: 34, g: true  }, { x: 66,  h: 40, g: true  },
    { x: 92,  h: 50, g: true  }, { x: 118, h: 58, g: true  }, { x: 144, h: 52, g: true  },
    { x: 170, h: 40, g: false }, { x: 196, h: 28, g: false }, { x: 222, h: 18, g: false },
    { x: 248, h: 12, g: false },
  ]
  const base = 70, bw = 20
  const hi30 = base - (base * 0.42)   // 30% threshold — approx y
  const hi15 = base - (base * 0.21)   // 15% threshold
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 100" width="100%" style={{ display: 'block' }}>
        <text x="140" y="9" textAnchor="middle" fontSize="6.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2 Stock Count (of 2123 NSE stocks)</text>
        {/* Threshold zones */}
        <rect x="0" y="12" width="280" height={hi30 - 12} fill="rgba(52,211,153,0.05)" />
        <rect x="0" y={hi30} width="280" height={hi15 - hi30} fill="rgba(251,191,36,0.05)" />
        <rect x="0" y={hi15} width="280" height={base - hi15} fill="rgba(248,113,113,0.05)" />
        {/* Threshold lines */}
        <line x1="0" y1={hi30} x2="280" y2={hi30} stroke={C.green}  strokeWidth="0.8" strokeDasharray="4,3" opacity="0.7" />
        <line x1="0" y1={hi15} x2="280" y2={hi15} stroke={C.red}    strokeWidth="0.8" strokeDasharray="4,3" opacity="0.7" />
        <text x="276" y={hi30 - 2} textAnchor="end" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">30%+</text>
        <text x="276" y={hi15 - 2} textAnchor="end" fontSize="5" fill={C.red}   fontFamily="system-ui,sans-serif">15%</text>
        {/* Bars */}
        {bars.map((b, i) => (
          <rect key={i} x={b.x - bw/2} y={base - b.h} width={bw} height={b.h} rx="3"
            fill={b.g ? C.green : C.amber} opacity={b.g ? 0.75 : 0.6} />
        ))}
        <line x1="0" y1={base} x2="280" y2={base} stroke={C.border} strokeWidth="0.8" />
        {/* Labels */}
        <text x="88"  y={base + 10} textAnchor="middle" fontSize="6"   fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">↑ Bull phase — buy aggressively</text>
        <text x="210" y={base + 10} textAnchor="middle" fontSize="6"   fill={C.amber} fontFamily="system-ui,sans-serif" fontWeight="700">↓ Bear phase — be selective</text>
        <text x="140" y={base + 20} textAnchor="middle" fontSize="5.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">Each bar = one month · 2123 stocks tracked</text>
        {/* Highlight peak */}
        <text x="118" y={base - 62} textAnchor="middle" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Peak</text>
        <line x1="118" y1={base - 60} x2="118" y2={base - 56} stroke={C.green} strokeWidth="1" />
      </svg>
    </div>
  )
}

function BreadthDivergenceChart() {
  const nifty = [[0,20],[40,17],[80,14],[115,11],[130,13],[160,10],[200,8],[240,6],[270,4]]
  const adLine = [[0,68],[40,65],[80,62],[115,59],[130,62],[160,64],[200,66],[240,68],[270,70]]
  const P2 = arr => arr.map(([x,y]) => `${x},${y}`).join(' ')
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 112" width="100%" style={{ display: 'block' }}>
        {/* Divergence zone */}
        <rect x="128" y="0" width="152" height="112" fill="rgba(248,113,113,0.06)" />
        {/* Nifty panel */}
        <text x="6" y="9" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">NIFTY</text>
        <polyline points={P2(nifty)} fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="round" />
        {/* HH markers */}
        <circle cx="115" cy="11" r="3" fill="none" stroke={C.green} strokeWidth="1.2" />
        <text x="115" y="7"  textAnchor="middle" fontSize="5.5" fill={C.green} fontFamily="system-ui,sans-serif">HH1</text>
        <circle cx="270" cy="4"  r="3" fill="none" stroke={C.green} strokeWidth="1.2" />
        <text x="270" y="2"  textAnchor="middle" fontSize="5.5" fill={C.green} fontFamily="system-ui,sans-serif">HH2 ↑</text>
        <line x1="0" y1="26" x2="280" y2="26" stroke={C.border} strokeWidth="0.7" />
        {/* AD panel */}
        <text x="6" y="36" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">A-D LINE</text>
        <polyline points="0,68 40,65 80,62 115,59" fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="round" />
        <polyline points="115,59 130,62 160,64 200,66 240,68 270,70" fill="none" stroke={C.red} strokeWidth="2" strokeLinejoin="round" strokeDasharray="5,3" />
        {/* H markers on A-D */}
        <circle cx="115" cy="59" r="3" fill="none" stroke={C.green} strokeWidth="1.2" />
        <text x="115" y="55" textAnchor="middle" fontSize="5.5" fill={C.green} fontFamily="system-ui,sans-serif">H1</text>
        <circle cx="270" cy="70" r="3" fill="none" stroke={C.red} strokeWidth="1.2" />
        <text x="270" y="66" textAnchor="middle" fontSize="5.5" fill={C.red} fontFamily="system-ui,sans-serif">Lower ↓</text>
        <line x1="0" y1="80" x2="280" y2="80" stroke={C.border} strokeWidth="0.7" />
        {/* Divergence label */}
        <text x="200" y="91"  textAnchor="middle" fontSize="6" fill={C.red} fontFamily="system-ui,sans-serif" fontWeight="700">⚠ Divergence!</text>
        <text x="200" y="99"  textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Nifty at new high, A-D not confirming</text>
        <text x="200" y="109" textAnchor="middle" fontSize="5"   fill={C.red} fontFamily="system-ui,sans-serif">→ Tighten stops. Stop new buying.</text>
        <text x="52"  y="91"  textAnchor="middle" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Healthy</text>
        <text x="52"  y="99"  textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Both Nifty and A-D rising</text>
        <line x1="128" y1="27" x2="128" y2="80" stroke={C.red} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.7" />
      </svg>
    </div>
  )
}

function BreadthTrafficLightChart() {
  const levels = [
    { y: 8,  col: C.green,  dot: C.green,  title: 'Strong Breadth — Buy Confidently',  bullets: ['A-D Line rising', '60%+ stocks above 30W MA', 'Stage 2 count above 30%'] },
    { y: 38, col: C.amber,  dot: C.amber,  title: 'Mixed Breadth — Be Selective',       bullets: ['A-D Line flat or choppy', '40–60% above 30W MA', 'Only buy highest RS stocks'] },
    { y: 68, col: '#f97316',dot: '#f97316', title: 'Weak Breadth — Protect Positions',   bullets: ['A-D Line falling', 'Stage 2 count dropping', 'Tighten stops, no new buys'] },
    { y: 98, col: C.red,    dot: C.red,    title: 'Very Weak — Stay in Cash',            bullets: ['Nifty Stage 4', 'Below 40% above 30W MA', 'Capital protection = strategy'] },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 128" width="100%" style={{ display: 'block' }}>
        {levels.map((l) => (
          <g key={l.y}>
            <circle cx="16" cy={l.y + 10} r="8" fill={l.dot} opacity="0.85" />
            <text x="30" y={l.y + 7}  fontSize="6.5" fill={l.col}      fontFamily="system-ui,sans-serif" fontWeight="700">{l.title}</text>
            {l.bullets.map((b, bi) => (
              <text key={bi} x="32" y={l.y + 14 + bi * 7} fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">· {b}</text>
            ))}
          </g>
        ))}
      </svg>
    </div>
  )
}

function BreadthDashboardChart() {
  /* 4-panel 2×2 dashboard */
  const adH = [[0,36],[20,34],[40,32],[55,30]]
  const adD = [[55,30],[70,32],[85,34],[100,36]]
  const P2 = arr => arr.map(([x,y]) => `${x},${y}`).join(' ')
  const cx = 196, cy = 47, r = 22
  const rad = d => d * Math.PI / 180
  const needleDeg = 180 - 65 * 1.8
  const nx = cx + (r - 4) * Math.cos(rad(needleDeg))
  const ny = cy - (r - 4) * Math.sin(rad(needleDeg))
  const arc = (s, e, col) => {
    const ri = r - 6
    const x1 = cx + r*Math.cos(rad(s)), y1 = cy - r*Math.sin(rad(s))
    const x2 = cx + r*Math.cos(rad(e)), y2 = cy - r*Math.sin(rad(e))
    const ix1 = cx + ri*Math.cos(rad(s)), iy1 = cy - ri*Math.sin(rad(s))
    const ix2 = cx + ri*Math.cos(rad(e)), iy2 = cy - ri*Math.sin(rad(e))
    return <path key={s} d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0,0 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${ri},${ri} 0 0,1 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`} fill={col} opacity="0.8" />
  }
  const s2bars = [{ x: 20, h: 16 }, { x: 36, h: 20 }, { x: 52, h: 26 }, { x: 68, h: 30 }, { x: 84, h: 28 }, { x: 100, h: 22 }]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 130" width="100%" style={{ display: 'block' }}>
        <text x="140" y="9" textAnchor="middle" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Market Breadth Dashboard</text>
        {/* Panel outlines */}
        <rect x="2"   y="14" width="130" height="54" rx="6" fill={C.base} stroke={C.border} strokeWidth="0.8" />
        <rect x="138" y="14" width="140" height="54" rx="6" fill={C.base} stroke={C.border} strokeWidth="0.8" />
        <rect x="2"   y="72" width="130" height="54" rx="6" fill={C.base} stroke={C.border} strokeWidth="0.8" />
        <rect x="138" y="72" width="140" height="54" rx="6" fill={C.base} stroke={C.border} strokeWidth="0.8" />
        {/* Panel 1 — A-D Line */}
        <text x="67"  y="23" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">A-D Line</text>
        <polyline points={P2(adH)} fill="none" stroke={C.green} strokeWidth="2" strokeLinejoin="round" />
        <polyline points={P2(adD)} fill="none" stroke={C.red}   strokeWidth="2" strokeLinejoin="round" strokeDasharray="4,2" />
        <text x="28"  y="54" textAnchor="middle" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">✅ Rising</text>
        <text x="78"  y="54" textAnchor="middle" fontSize="5" fill={C.red}   fontFamily="system-ui,sans-serif">⚠ Diverging</text>
        {/* Panel 2 — Gauge */}
        <text x="208" y="23" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">% Above 30W MA</text>
        {arc(180,144,'#7f1d1d')}{arc(144,108,C.red)}{arc(108,72,C.amber)}{arc(72,36,C.green)}{arc(36,0,'#6ee7b7')}
        <line x1={cx} y1={cy} x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3" fill={C.surface} stroke="#fff" strokeWidth="1" />
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="800">65%</text>
        <text x={cx} y={cy + 18} textAnchor="middle" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">Bull Market ✅</text>
        {/* Panel 3 — Stage 2 count bars */}
        <text x="67"  y="81" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Stage 2 Count</text>
        {s2bars.map((b, i) => (
          <rect key={i} x={b.x} y={122 - b.h} width="10" height={b.h} rx="2" fill={i < 4 ? C.green : C.amber} opacity="0.75" />
        ))}
        <line x1="10" y1="122" x2="120" y2="122" stroke={C.border} strokeWidth="0.7" />
        <text x="67" y="120" textAnchor="middle" fontSize="5" fill={C.green} fontFamily="system-ui,sans-serif">Rising ✅</text>
        {/* Panel 4 — Traffic light */}
        <text x="208" y="81" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Signal</text>
        <circle cx="208" cy="96"  r="8" fill={C.green}  opacity="0.9" />
        <circle cx="208" cy="108" r="8" fill={C.border} opacity="0.4" />
        <circle cx="208" cy="120" r="8" fill={C.border} opacity="0.4" />
        <text x="208" y="99.5" textAnchor="middle" fontSize="6" fill="#000" fontFamily="system-ui,sans-serif" fontWeight="800">GO</text>
        <text x="222" y="99"   fontSize="5.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">Buy</text>
        <text x="222" y="111"  fontSize="5"   fill={C.textFaint} fontFamily="system-ui,sans-serif">Selective</text>
        <text x="222" y="123"  fontSize="5"   fill={C.textFaint} fontFamily="system-ui,sans-serif">Cash</text>
        {/* Footer */}
        <text x="140" y="128" textAnchor="middle" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">All four panels green = ideal buying conditions ✅</text>
      </svg>
    </div>
  )
}

// ─── Module 9 charts ──────────────────────────────────────────────────────────

function SwingXFunnelChart() {
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 118" width="100%" style={{ display: 'block' }}>
        {/* Top — all stocks */}
        <rect x="10" y="4" width="260" height="22" rx="4" fill="rgba(56,189,248,0.10)" stroke={C.blue} strokeWidth="0.8" />
        <text x="140" y="19" textAnchor="middle" fontSize="8" fill={C.blue} fontFamily="system-ui,sans-serif" fontWeight="700">2123 NSE stocks</text>
        {/* Funnel sides */}
        <polygon points="10,26 40,54 240,54 270,26" fill="rgba(45,212,191,0.08)" stroke={C.accent} strokeWidth="0.8" />
        {/* Filter box */}
        <rect x="40" y="54" width="200" height="26" rx="4" fill="rgba(45,212,191,0.12)" stroke={C.accent} strokeWidth="1" />
        <text x="140" y="64" textAnchor="middle" fontSize="7.5" fill={C.accent} fontFamily="system-ui,sans-serif" fontWeight="700">SwingX — Weinstein Technical Filter</text>
        <text x="140" y="74" textAnchor="middle" fontSize="6"   fill={C.textMuted} fontFamily="system-ui,sans-serif">Stage · 30W MA · RS · Volume · Delivery · Market</text>
        {/* Lower funnel sides */}
        <polygon points="40,80 80,102 200,102 240,80" fill="rgba(45,212,191,0.08)" stroke={C.accent} strokeWidth="0.8" />
        {/* Output */}
        <rect x="80" y="102" width="120" height="12" rx="3" fill="rgba(52,211,153,0.12)" stroke={C.green} strokeWidth="0.8" />
        <text x="140" y="111" textAnchor="middle" fontSize="6.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="700">5–15 stocks matching criteria</text>
        {/* Disclaimer */}
        <rect x="4" y="114" width="272" height="2" rx="1" fill={C.border} />
        <text x="140" y="130" textAnchor="middle" fontSize="0" fill="none" />
      </svg>
      <div style={{ padding: '6px 12px 10px', background: 'rgba(251,191,36,0.06)', borderTop: `1px solid ${C.amber}44` }}>
        <p style={{ margin: 0, fontSize: 11, color: C.amber, lineHeight: 1.5 }}>For further study only — not a recommendation to buy or sell</p>
      </div>
    </div>
  )
}

function SwingXMethodChart() {
  const criteria = [
    { mod: 'M1', label: 'Stage 2 — stock in clear uptrend',         col: C.green  },
    { mod: 'M2', label: 'Nifty Stage 2 — market context positive',  col: C.blue   },
    { mod: 'M3', label: 'RS rising vs Nifty — stock outperforming', col: C.purple },
    { mod: 'M4', label: 'Price above rising 30W MA — trend intact', col: C.accent },
    { mod: 'M5', label: 'Volume + delivery confirm interest',        col: C.amber  },
    { mod: 'M6', label: 'Near key technical level — clear structure',col: C.red    },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 112" width="100%" style={{ display: 'block' }}>
        <text x="140" y="10" textAnchor="middle" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">SwingX = All 6 criteria met simultaneously</text>
        {criteria.map((c, i) => (
          <g key={'mc'+i}>
            <rect x="6" y={14 + i * 14} width="232" height="12" rx="3" fill={`${c.col}18`} stroke={`${c.col}44`} strokeWidth="0.7" />
            <text x="14" y={23 + i * 14} fontSize="6" fill={c.col} fontFamily="system-ui,sans-serif" fontWeight="700">{c.mod}</text>
            <text x="30" y={23 + i * 14} fontSize="6.5" fill={C.text} fontFamily="system-ui,sans-serif">{c.label}</text>
            <text x="242" y={23 + i * 14} fontSize="7" fill={C.green} fontFamily="system-ui,sans-serif">✓</text>
          </g>
        ))}
        <path d="M120,100 L140,108 L160,100" fill="none" stroke={C.accent} strokeWidth="1.5" />
        <rect x="60" y="100" width="160" height="11" rx="4" fill="rgba(45,212,191,0.12)" stroke={C.accent} strokeWidth="0.8" />
        <text x="140" y="109" textAnchor="middle" fontSize="6.5" fill={C.accent} fontFamily="system-ui,sans-serif" fontWeight="700">Matches criteria — for your further study</text>
      </svg>
    </div>
  )
}

function SwingXScanChart() {
  const stages = [
    { label: '2123 stocks total',               count: '2123', w: 260, col: C.blue    },
    { label: 'Stage 2 filter',                  count: '~725', w: 210, col: C.green   },
    { label: '+ 30W MA filter',                 count: '~400', w: 168, col: C.accent  },
    { label: '+ RS rising filter',              count: '~120', w: 130, col: C.purple  },
    { label: '+ Volume + Delivery filter',      count: '~40',  w:  96, col: C.amber   },
    { label: '+ Market breadth — all criteria', count: '5–15', w:  68, col: C.green   },
  ]
  const base = 8
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 106" width="100%" style={{ display: 'block' }}>
        <text x="140" y="8" textAnchor="middle" fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif">Daily scan — approximate counts</text>
        {stages.map((s, i) => {
          const x = (280 - s.w) / 2
          const y = base + 6 + i * 16
          return (
            <g key={'ss'+i}>
              <rect x={x} y={y} width={s.w} height="13" rx="3" fill={`${s.col}15`} stroke={`${s.col}55`} strokeWidth="0.7" />
              <text x={x + 6}  y={y + 9}  fontSize="5.5" fill={s.col}      fontFamily="system-ui,sans-serif">{s.label}</text>
              <text x={x + s.w - 4} y={y + 9} textAnchor="end" fontSize="6" fill={s.col} fontFamily="system-ui,sans-serif" fontWeight="700">{s.count}</text>
            </g>
          )
        })}
        <text x="140" y="104" textAnchor="middle" fontSize="5.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">For educational study — not a recommendation</text>
      </svg>
    </div>
  )
}

function SwingXScreenTypesChart() {
  const bkPrice = [[0,50],[18,44],[34,36],[48,36],[60,36],[74,36],[88,28],[100,18],[112,10],[124,5],[138,4]]
  const plPrice = [[142,10],[158,14],[172,20],[186,30],[200,38],[210,42],[218,44],[224,50],[232,58],[242,62],[254,60]]
  const P2 = arr => arr.map(([x,y]) => `${x},${y}`).join(' ')
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 88" width="100%" style={{ display: 'block' }}>
        {/* Panel backgrounds */}
        <rect x="2"   y="4" width="134" height="80" rx="5" fill="rgba(56,189,248,0.05)"  stroke={C.border} strokeWidth="0.6" />
        <rect x="142" y="4" width="136" height="80" rx="5" fill="rgba(45,212,191,0.05)"  stroke={C.border} strokeWidth="0.6" />
        {/* Breakout type */}
        <text x="69"  y="15" textAnchor="middle" fontSize="7" fill={C.blue}    fontFamily="system-ui,sans-serif" fontWeight="700">Breakout Screen</text>
        <line x1="10" y1="36" x2="120" y2="36" stroke={C.red} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7" />
        <polyline points={P2(bkPrice)} fill="none" stroke={C.blue} strokeWidth="2" strokeLinejoin="round" />
        <text x="69"  y="62" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Price above resistance</text>
        <text x="69"  y="70" textAnchor="middle" fontSize="5.5" fill={C.blue}     fontFamily="system-ui,sans-serif">Above avg volume ↑</text>
        <text x="69"  y="78" textAnchor="middle" fontSize="5"   fill={C.textFaint} fontFamily="system-ui,sans-serif">Study point only</text>
        {/* Pullback type */}
        <text x="210" y="15" textAnchor="middle" fontSize="7" fill={C.accent}  fontFamily="system-ui,sans-serif" fontWeight="700">Pullback Screen</text>
        <polyline points={P2(plPrice)} fill="none" stroke={C.accent} strokeWidth="2" strokeLinejoin="round" />
        <line x1="142" y1="62" x2="278" y2="62" stroke={C.accent} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7" />
        <text x="210" y="70" textAnchor="middle" fontSize="5.5" fill={C.textMuted} fontFamily="system-ui,sans-serif">Near rising 30W MA</text>
        <text x="210" y="78" textAnchor="middle" fontSize="5.5" fill={C.accent}    fontFamily="system-ui,sans-serif">Below avg volume ↓</text>
      </svg>
    </div>
  )
}

function SwingXRiskChart() {
  const price = [[0,54],[20,48],[36,40],[52,32],[64,24],[78,18],[90,14],[102,10],[112,8],[120,10],[130,14],[138,20],[144,26],[148,32],[152,38],[158,44],[164,52],[170,58],[180,66],[196,72],[220,78],[250,80]]
  const risks = [
    { x: 132, y: 10, label: 'Operator reversal', col: C.red    },
    { x: 150, y: 26, label: 'Promoter selling',  col: C.amber  },
    { x: 168, y: 50, label: 'Earnings miss',     col: C.red    },
    { x: 200, y: 72, label: 'Market reversal',   col: C.amber  },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 100" width="100%" style={{ display: 'block' }}>
        <text x="6" y="9" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Technically strong chart — then sudden drop</text>
        {/* Green rising section */}
        <polyline points="0,54 20,48 36,40 52,32 64,24 78,18 90,14 102,10 112,8 120,10" fill="none" stroke={C.green} strokeWidth="2.2" strokeLinejoin="round" />
        {/* Red drop section */}
        <polyline points="120,10 130,14 138,20 144,26 148,32 152,38 158,44 164,52 170,58 180,66 196,72 220,78 250,80" fill="none" stroke={C.red} strokeWidth="2" strokeLinejoin="round" />
        {/* Divider line */}
        <line x1="120" y1="4" x2="120" y2="88" stroke={C.amber} strokeWidth="0.8" strokeDasharray="3,2" opacity="0.8" />
        <text x="110" y="7" textAnchor="end" fontSize="6" fill={C.green} fontFamily="system-ui,sans-serif">Criteria met ✓</text>
        <text x="122" y="7" fontSize="6" fill={C.red} fontFamily="system-ui,sans-serif">Event ⚠</text>
        {/* Risk labels */}
        {risks.map((r, i) => (
          <g key={'rk'+i}>
            <circle cx={r.x} cy={r.y} r="3" fill={r.col} opacity="0.85" />
            <line x1={r.x} y1={r.y - 3} x2={r.x} y2={r.y - 10} stroke={r.col} strokeWidth="0.8" opacity="0.7" />
            <text x={r.x} y={r.y - 12} textAnchor="middle" fontSize="5" fill={r.col} fontFamily="system-ui,sans-serif">{r.label}</text>
          </g>
        ))}
        <rect x="2" y="88" width="276" height="11" rx="3" fill="rgba(251,191,36,0.08)" stroke={C.amber} strokeWidth="0.6" />
        <text x="140" y="96.5" textAnchor="middle" fontSize="5.5" fill={C.amber} fontFamily="system-ui,sans-serif">Technical screens cannot predict these events — always do further research</text>
      </svg>
    </div>
  )
}

function SwingXProcessChart() {
  const steps = [
    { n: '1', label: 'Technical study (SwingX)',               sub: 'Use everything from this course',   col: C.blue   },
    { n: '2', label: 'Fundamental check',                      sub: 'What does the company do? Is it growing?', col: C.accent },
    { n: '3', label: 'News & events',                          sub: 'Results, promoter activity, sector news', col: C.purple },
    { n: '4', label: 'Personal risk assessment',               sub: 'Can you afford to lose this amount?', col: C.amber  },
    { n: '5', label: 'Consult SEBI registered advisor',        sub: '⬅ Most important step',              col: C.green  },
  ]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 112" width="100%" style={{ display: 'block' }}>
        <text x="140" y="9" textAnchor="middle" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Responsible study process</text>
        {steps.map((s, i) => (
          <g key={'sp'+i}>
            <circle cx="20" cy={18 + i * 19} r="7" fill={`${s.col}22`} stroke={s.col} strokeWidth="1.2" />
            <text x="20" cy={18 + i * 19} y={22 + i * 19} textAnchor="middle" fontSize="7" fill={s.col} fontFamily="system-ui,sans-serif" fontWeight="800">{s.n}</text>
            <rect x="34" y={10 + i * 19} width="240" height="17" rx="4" fill={i === 4 ? `${s.col}18` : `${s.col}0a`} stroke={`${s.col}${i === 4 ? '66' : '33'}`} strokeWidth={i === 4 ? 1 : 0.6} />
            <text x="42" y={21 + i * 19} fontSize={i === 4 ? 7 : 6.5} fill={i === 4 ? s.col : C.text} fontFamily="system-ui,sans-serif" fontWeight={i === 4 ? '700' : '600'}>{s.label}</text>
            <text x="42" y={28 + i * 19} fontSize="5.5" fill={C.textFaint} fontFamily="system-ui,sans-serif">{s.sub}</text>
            {i < 4 && <line x1="20" y1={25 + i * 19} x2="20" y2={29 + i * 19} stroke={s.col} strokeWidth="1" opacity="0.5" />}
          </g>
        ))}
      </svg>
    </div>
  )
}

function SwingXNotChart() {
  const notList = ['A buy or sell recommendation', 'A guarantee of returns', 'Investment advice', 'Substitute for a SEBI advisor', 'A prediction of future price']
  const isList  = ['A technical screening tool', 'Educational Weinstein practice', 'Study of real NSE stocks', 'A starting point for research', 'Observable, measurable criteria']
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 110" width="100%" style={{ display: 'block' }}>
        {/* Headers */}
        <rect x="2"   y="2" width="134" height="14" rx="3" fill="rgba(248,113,113,0.15)" />
        <rect x="142" y="2" width="136" height="14" rx="3" fill="rgba(52,211,153,0.15)"  />
        <text x="69"  y="12" textAnchor="middle" fontSize="7.5" fill={C.red}   fontFamily="system-ui,sans-serif" fontWeight="800">SwingX is NOT ❌</text>
        <text x="210" y="12" textAnchor="middle" fontSize="7.5" fill={C.green} fontFamily="system-ui,sans-serif" fontWeight="800">SwingX IS ✅</text>
        {notList.map((t, i) => (
          <g key={'nl'+i}>
            <text x="8"  y={26 + i * 16} fontSize="7" fill={C.red}      fontFamily="system-ui,sans-serif">❌</text>
            <text x="20" y={26 + i * 16} fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif">{t}</text>
          </g>
        ))}
        {isList.map((t, i) => (
          <g key={'il'+i}>
            <text x="148" y={26 + i * 16} fontSize="7" fill={C.green}     fontFamily="system-ui,sans-serif">✅</text>
            <text x="160" y={26 + i * 16} fontSize="6" fill={C.textMuted} fontFamily="system-ui,sans-serif">{t}</text>
          </g>
        ))}
        <rect x="2" y="99" width="276" height="11" rx="3" fill="rgba(251,191,36,0.08)" stroke={C.amber} strokeWidth="0.6" />
        <text x="140" y="107" textAnchor="middle" fontSize="5.5" fill={C.amber} fontFamily="system-ui,sans-serif">Always consult a SEBI registered financial advisor</text>
      </svg>
    </div>
  )
}

function SwingXGraduationChart() {
  const mods = [
    { label: 'Weinstein Stages', angle: -90  },
    { label: 'Nifty 50',         angle: -50  },
    { label: 'RS vs Nifty',      angle: -10  },
    { label: '30W MA',           angle:  30  },
    { label: 'Volume',           angle:  70  },
    { label: 'S & R',            angle: 110  },
    { label: 'Chart Reading',    angle: 150  },
    { label: 'Breadth',          angle: 190  },
    { label: 'SwingX',           angle: 230  },
  ]
  const cx = 140, cy = 60, r = 44, ri = 22
  const rad = d => d * Math.PI / 180
  const segColors = [C.green, C.blue, C.purple, C.accent, C.amber, C.red, C.green, C.blue, C.accent]
  return (
    <div style={{ background: C.surface2, borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      <svg viewBox="0 0 280 120" width="100%" style={{ display: 'block' }}>
        <text x="140" y="9" textAnchor="middle" fontSize="7" fill={C.textMuted} fontFamily="system-ui,sans-serif" fontWeight="700">Complete Weinstein Framework</text>
        {mods.map((m, i) => {
          const startA = -90 + i * 40
          const endA   = startA + 38
          const midA   = (startA + endA) / 2
          const x1 = cx + r  * Math.cos(rad(startA)), y1 = cy + r  * Math.sin(rad(startA))
          const x2 = cx + r  * Math.cos(rad(endA)),   y2 = cy + r  * Math.sin(rad(endA))
          const ix1= cx + ri * Math.cos(rad(startA)), iy1= cy + ri * Math.sin(rad(startA))
          const ix2= cx + ri * Math.cos(rad(endA)),   iy2= cy + ri * Math.sin(rad(endA))
          const tx = cx + (r + 12) * Math.cos(rad(midA))
          const ty = cy + (r + 12) * Math.sin(rad(midA))
          const col = segColors[i]
          return (
            <g key={'gw'+i}>
              <path d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0,1 ${x2.toFixed(1)},${y2.toFixed(1)} L${ix2.toFixed(1)},${iy2.toFixed(1)} A${ri},${ri} 0 0,0 ${ix1.toFixed(1)},${iy1.toFixed(1)} Z`} fill={`${col}22`} stroke={col} strokeWidth="1" />
              <text x={tx.toFixed(1)} y={ty.toFixed(1)} textAnchor="middle" dominantBaseline="central" fontSize="4.8" fill={col} fontFamily="system-ui,sans-serif" fontWeight="700">{m.label}</text>
            </g>
          )
        })}
        {/* Center hub */}
        <circle cx={cx} cy={cy} r={ri - 2} fill="rgba(45,212,191,0.12)" stroke={C.accent} strokeWidth="1.5" />
        <text x={cx} y={cy - 4}  textAnchor="middle" fontSize="6.5" fill={C.accent} fontFamily="system-ui,sans-serif" fontWeight="800">SwingX</text>
        <text x={cx} y={cy + 5}  textAnchor="middle" fontSize="5"   fill={C.textMuted} fontFamily="system-ui,sans-serif">Technical</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="5"   fill={C.textMuted} fontFamily="system-ui,sans-serif">Screener</text>
        {/* Disclaimer */}
        <rect x="2" y="110" width="276" height="9" rx="3" fill="rgba(251,191,36,0.08)" stroke={C.amber} strokeWidth="0.5" />
        <text x="140" y="117" textAnchor="middle" fontSize="5" fill={C.amber} fontFamily="system-ui,sans-serif">Educational tool only — not SEBI registered investment advice</text>
      </svg>
    </div>
  )
}

// ─── Content data — Module 6 ─────────────────────────────────────────────────

const M6_LESSONS = [
  {
    id: 'm6-support',
    icon: '🏠',
    title: 'What is Support?',
    body: [
      'Think of a floor in your house. When a ball falls, it bounces back up from the floor. Support works the same way — it is a price level where a falling stock tends to stop and bounce back up.',
      'Why does this happen? Because at that price, many buyers step in. They remember this price was good value before, so they buy again. All that buying pressure pushes the price back up.',
      'The more times a stock bounces from the same price level, the stronger that support is. A level tested once is weak. A level tested three or four times is very strong — many buyers are defending it.',
    ],
    rule: 'Support = a price floor. More bounces from the same level = stronger the floor.',
  },
  {
    id: 'm6-resistance',
    icon: '🔒',
    title: 'What is Resistance?',
    body: [
      'Now think of the ceiling. When you throw a ball up, it hits the ceiling and falls back down. Resistance is a price level where a rising stock keeps getting rejected and falling back.',
      'Why does resistance form? Because many people bought the stock at that price before and are now sitting at a loss. When price comes back up to their buy price, they sell immediately to "get out" — this selling pressure pushes price back down.',
      'These trapped sellers are your ceiling. Until they are all done selling, the stock cannot break through. Like the support floor, the more times a level has been tested, the more powerful it is.',
    ],
    rule: 'Resistance = a price ceiling. Trapped sellers create the ceiling.',
  },
  {
    id: 'm6-psychology',
    icon: '🧠',
    title: 'Why do these levels exist?',
    body: [
      'It is all human emotion — and emotions repeat. Support exists because of the fear of missing out. Buyers who missed the stock at a good price rush in when it comes back.',
      'Resistance exists because of relief selling. Investors who bought at a high price and are sitting at a loss finally get the chance to "break even" — they sell the moment price reaches their cost.',
      'These emotions play out predictably, which is why the same price levels work again and again — sometimes for years. Big institutions also place large orders at these well-known levels, making them even stronger.',
    ],
    tip: 'Support and resistance are not just chart lines — they are maps of fear and greed.',
  },
  {
    id: 'm6-flip',
    icon: '🔄',
    title: 'The Flip Rule — resistance becomes support',
    body: [
      'Here is one of the most powerful patterns in all of technical analysis: when a stock breaks ABOVE resistance with high volume — that resistance becomes the new support.',
      'The ceiling becomes the new floor. Why? All the trapped sellers who were waiting to exit have now sold. New buyers who bought the breakout are sitting with profits and will defend this level if price comes back.',
      'This is called the Flip Rule. When price pulls back to a broken resistance level and holds, that is a classic re-test entry. Remember from Module 5 — the breakout needs high volume to be real. Low volume breakouts often fail.',
    ],
    rule: 'Broken resistance with high volume = new support. Pullback to it = ideal entry.',
  },
  {
    id: 'm6-ma-sr',
    icon: '🔗',
    title: 'Support, Resistance and the 30W MA',
    body: [
      'Remember the 30-Week Moving Average from Module 4? In a Stage 2 uptrend, the 30W MA acts as a dynamic support line — it moves up with the stock like a rising floor.',
      'Fixed support and resistance levels are horizontal lines. The 30W MA is diagonal — it rises with the trend. Both matter, and when they align, you get a very powerful setup.',
      'The best entries combine both: a stock above its rising 30W MA (dynamic support) pulling back to a known horizontal support level. When the horizontal support and the 30W MA are close together, you have double support — two layers of buyers defending the same zone.',
    ],
    rule: '30W MA (dynamic) + horizontal support = double support zone. Lower risk entry.',
  },
  {
    id: 'm6-spotting',
    icon: '🔍',
    title: 'How to spot Support & Resistance',
    body: [
      'Look for price levels where the stock has reversed multiple times. Draw a horizontal line through those turning points — that is your level.',
      'Round numbers work naturally. ₹100, ₹500, ₹1,000 — people place orders at round numbers. These often become strong support and resistance.',
      '52-week highs are key: when a stock breaks above its 52-week high with volume, that high becomes strong support. Previous breakout levels are also powerful — old resistance that was broken with volume, now acting as support.',
      'The more times a level has been tested and held, the more important it is. Three or more touches = strong level worth watching.',
    ],
    tip: 'Round numbers and 52-week highs are natural support/resistance — always mark them.',
  },
  {
    id: 'm6-summary',
    icon: '🗺️',
    title: 'Support & Resistance — Summary',
    body: [
      'You now have a complete picture of price floors and ceilings. Here is the full framework:',
      '① Support = price floor. Buyers step in, stock bounces. More bounces = stronger.',
      '② Resistance = price ceiling. Sellers step in, stock gets pushed down.',
      '③ Flip Rule: resistance broken with high volume becomes new support.',
      '④ 30W MA = dynamic (moving) support during Stage 2 — rising with the trend.',
      '⑤ Best entry: price near horizontal support AND near the 30W MA.',
      'Add this to your checklist: Stage 2 + Rising RS + Pullback to 30W MA + At support level + High Delivery % = the strongest possible setup.',
    ],
    rule: 'Where 30W MA and horizontal support align = the highest quality entry zone.',
  },
]

const M6_QUIZ = [
  {
    question: 'A stock has bounced from ₹150 four times over the past year. Today it is falling toward ₹150 again with low volume. What is ₹150 and what might happen next?',
    options: [
      '₹150 is a resistance level — the stock will likely break down below it',
      '₹150 is a strong support level. Low volume fall + 4 prior bounces = likely to bounce again. Good entry with stop below ₹150',
      '₹150 means nothing — only the 30W MA matters',
      '₹150 is a round number — round numbers are never real support',
    ],
    correct: 1,
    explanation: '₹150 has been tested and held four times — that is very strong support. A low volume fall means no panic selling. There is a high probability of another bounce from ₹150. This is a low-risk entry: buy near ₹150 with a stop-loss just below it. If the stock breaks below ₹150 on high volume, the support has failed.',
  },
  {
    question: 'A stock struggled to cross ₹400 for 8 months. Last week it broke above ₹400 with the highest volume in 6 months. This week price has pulled back to ₹400. What should you do?',
    options: [
      'Sell immediately — the stock is failing the breakout',
      'This is the Flip Rule. ₹400 was resistance — now it is support. High volume breakout + pullback re-test = ideal entry with stop just below ₹400',
      'Wait for the stock to go back to ₹300 before buying',
      'Ignore the pullback — only buy when price is making new highs',
    ],
    correct: 1,
    explanation: 'This is a textbook Flip Rule entry. ₹400 was strong resistance for 8 months — now broken with the highest volume in 6 months, which confirms real buying. The pullback to ₹400 is a re-test of the breakout level. This is where new buyers enter with low risk. Stop-loss: just below ₹400. If it holds, the stock is ready for the next leg up.',
  },
]

// ─── Content data — Module 7 ─────────────────────────────────────────────────

const M7_LESSONS = [
  {
    id: 'm7-story',
    icon: '📖',
    title: 'A chart is just a story',
    body: [
      'Every chart tells the story of a battle between buyers and sellers. Price goes up when buyers are in control. Price goes down when sellers are in control. Your job as a trader is simply to read who is winning.',
      'A single candle = one day\'s battle. A week of candles = one chapter. The full chart = the whole story. Zoom out and you will see the arc: accumulation → breakout → advance → distribution.',
      'Before you study any indicator, just ask: is this chart telling a story of buyers in control or sellers in control? The answer guides everything else.',
    ],
  },
  {
    id: 'm7-candle',
    icon: '🕯️',
    title: 'The Candlestick — one day\'s full story',
    body: [
      'Each candle has four parts: Open, High, Low, Close. The body (thick part) shows where price opened and closed. The wicks (thin lines) show the highest and lowest price touched that day.',
      'A green (or white) candle: price closed higher than it opened — buyers won the day. A red (or black) candle: price closed lower than it opened — sellers won.',
      'Long lower wick = sellers pushed price down hard but buyers fought back and closed it higher. This is a sign of buying strength. Long upper wick = buyers pushed price up but sellers rejected it — bearish signal.',
    ],
  },
  {
    id: 'm7-zoom',
    icon: '🔭',
    title: 'Zoom out first — always check the big picture',
    body: [
      'Before you analyse a daily chart, always look at the weekly chart first. A daily chart that looks like a great setup can be a trap if the weekly chart shows Stage 3 or Stage 4.',
      'The decision flow: Is it Stage 2? → Is it above the rising 30W MA? → Is RS rising? If any answer is No, skip the stock. Move on. Only after all three are Yes do you zoom into the daily chart for timing.',
      'Most beginners do the opposite — they fall in love with a daily chart first, then justify the weekly. Always go weekly → daily, never the reverse.',
    ],
  },
  {
    id: 'm7-staircase',
    icon: '🪜',
    title: 'What to look for on the price chart',
    body: [
      'A healthy Stage 2 uptrend looks like a staircase: Higher Highs (H1, H2, H3) and Higher Lows (L1, L2, L3). Each pullback stops at a higher level than the last. That is the definition of an uptrend.',
      'The 30W MA should be rising below the price, acting as a support floor. Breakouts from flat bases (tight sideways consolidation) are the best entry points — they signal fresh energy entering the stock.',
      'If the staircase breaks down — if a new low goes below the previous low — that is a warning. The uptrend may be ending. Re-check the weekly stage.',
    ],
  },
  {
    id: 'm7-volume-story',
    icon: '📊',
    title: 'Reading the Volume story',
    body: [
      'Volume is the fuel of a price move. Healthy Stage 2: big green volume bars on up-days, small red bars on pullback days. This shows buyers are enthusiastic and sellers are passive.',
      'Volume dry-up on a pullback is the best signal: stock pulls back to support on very thin volume — sellers are not eager to sell. When volume picks up again on the next up day, that is your entry trigger.',
      'Warning signs: price rising but volume shrinking (weak hands driving the move), or one massive red bar on big volume after a long advance (distribution — institutions selling into retail buyers).',
    ],
  },
  {
    id: 'm7-checklist',
    icon: '✅',
    title: 'Putting it all together — the checklist',
    body: [
      'Use all 6 modules as a checklist before every trade. Each check that passes adds confidence. 5–6 checks = high confidence entry. 3–4 checks = medium, consider waiting for more confirmation. 1–2 checks = skip.',
      '① Stage 2 on weekly chart (M1) + above rising 30W MA (M4)  ② RS rising vs Nifty (M3)  ③ Higher Highs + Higher Lows staircase (M7)  ④ Breakout from base or pullback to support (M6)  ⑤ Delivery % above 50% (M5)  ⑥ Nifty in Stage 2 — market tailwind (M2)',
      'No single check is enough on its own. The power comes from combining them. A stock with all 6 checks firing is rare — but when you find one, it is a very high-probability trade.',
    ],
  },
  {
    id: 'm7-summary',
    icon: '🎓',
    title: 'Summary — How to Read a Stock Chart',
    body: [
      'Reading a chart is a skill that compounds. Start with the big picture (weekly, stage, 30W MA), then zoom in (daily, volume, support/resistance, RS). Use the decision flow: Stage 2? → Above 30W MA? → RS rising? → Only then look at entry.',
      'The checklist ties all 7 modules together. You are not looking for perfection — you are looking for the highest-probability setup. The more checks that align, the more you can risk with confidence.',
      'You now have the complete PineX framework. Every tool, every filter, every signal you have learned is designed to keep you on the right side of the market, in the right stocks, at the right time.',
    ],
  },
]

const M7_QUIZ = [
  {
    question: 'A daily chart looks exciting — big green candles, breaking out of a base. But when you check the weekly chart, the stock is in Stage 4, below a falling 30W MA, with RS in a downtrend. What do you do?',
    options: [
      'Skip the stock — the daily setup is a dead-cat bounce inside a bigger downtrend',
      'Buy it — the daily breakout is a strong signal on its own',
      'Buy half position and watch the weekly',
      'Wait for the 30W MA to catch up to the price',
    ],
    correct: 0,
    explanation: 'Always trust the weekly chart over the daily. A breakout on the daily inside a Stage 4 weekly is a classic dead-cat bounce — a short-lived rally inside a bigger downtrend. Institutions are using that rally to sell more. The daily is just noise inside the weekly story. Skip it and find a stock where both timeframes agree.',
  },
  {
    question: 'You find a Stage 2 stock above the 30W MA with rising RS. The 6-point checklist score is 4/6. The two fails: breakout happened on low volume, and delivery % is only 15%. What is the right move?',
    options: [
      'Medium confidence only — wait for a re-test with better volume and delivery %',
      'Buy immediately — 4/6 is good enough',
      'Skip forever — 4/6 is too low to trade',
      'Buy half now, add more if volume improves',
    ],
    correct: 0,
    explanation: 'A 4/6 setup is not bad, but the two specific failures are important. Low breakout volume means the move may not have institutional backing. Delivery % of 15% means most of the buying was intraday speculation, not real ownership. The best move is to wait: if the stock re-tests the breakout level on low volume (dry-up), then breaks out again on high volume with better delivery %, that is a much stronger signal. Patience here protects you from a false breakout.',
  },
]

// ─── Content data — Module 8 ─────────────────────────────────────────────────

const M8_LESSONS = [
  {
    id: 'm8-what',
    icon: '🏏',
    title: 'What is Market Breadth?',
    body: [
      'Imagine a cricket team of 11 players. The team scored 300 runs — sounds great. But what if only 2 players scored 280 runs and the other 9 scored almost nothing? The team total looks good but the team is actually weak — it depends on just 2 people.',
      'Market breadth asks the same question about Nifty: is the index rising because ALL stocks are going up, or just 4–5 big stocks pulling it up while the rest are falling?',
      'Breadth tells you if a rally is genuine (most stocks participating) or fake (just a few heavyweights holding up the index). A narrow rally — where only a few stocks are rising — is fragile and often ends badly.',
    ],
  },
  {
    id: 'm8-adline',
    icon: '📈',
    title: 'Advance-Decline Line (A-D Line)',
    body: [
      'Every day on NSE, count: how many stocks went UP (Advances) and how many went DOWN (Declines). Subtract Declines from Advances. Add this number to yesterday\'s total. Plot it over time — this is the Advance-Decline Line.',
      'When A-D Line is rising = more stocks going up than down = healthy, broad market. When A-D Line is falling even though Nifty is rising = warning. Only a few big stocks are holding Nifty up while most stocks are already weakening.',
      'This divergence — Nifty rising but A-D Line falling — is one of the most reliable early warning signals in the market. It often appears weeks before Nifty itself starts to fall.',
    ],
  },
  {
    id: 'm8-pct30w',
    icon: '📊',
    title: '% of Stocks Above 30W MA',
    body: [
      'A simple breadth indicator: what percentage of NSE stocks are currently above their own 30-week moving average? Above 60% = bull market — most stocks in uptrend, good time to buy. 40–60% = mixed market, be selective.',
      'Below 40% = bear market, most stocks in downtrend, very risky to buy new positions. Below 20% = extreme fear, market heavily oversold — may be near a bottom, but wait for confirmation before acting.',
      'PineX tracks this number and shows it on the home page. Check it every time before making a new buying decision. It tells you the health of the entire market in one number.',
    ],
  },
  {
    id: 'm8-stage2count',
    icon: '🔢',
    title: 'Stage 2 Stock Count',
    body: [
      'On PineX, we track how many of the 2123 NSE stocks are currently in Stage 2. This number tells the market\'s health at a glance. Rising Stage 2 count = more stocks entering uptrends = bull market strengthening.',
      'Falling Stage 2 count = stocks leaving Stage 2 = market weakening, even if Nifty looks okay at the index level. When Stage 2 count is high (above 30% of all stocks) — aggressive buying is justified.',
      'When low (below 15%) — be very selective. Most stocks are in Stage 1, 3, or 4. The odds are against you when the count is low. Wait for it to recover before increasing position sizes.',
    ],
  },
  {
    id: 'm8-divergence',
    icon: '⚠️',
    title: 'Breadth Divergence — the early warning',
    body: [
      'The most powerful use of breadth: spotting trouble BEFORE Nifty falls. Classic warning pattern — Nifty makes a new high, but the A-D Line does not make a new high. It is flat or falling.',
      'This means the index is being pulled up by only a handful of heavyweight stocks (Reliance, TCS, HDFC) while the majority of stocks are already weakening. Most individual stocks you might buy are already in trouble.',
      'Breadth divergence often appears weeks or months before a major market top. When you see it — tighten stop losses, reduce new buying, protect profits. Do not be fooled by a Nifty at all-time highs when breadth is broken.',
    ],
  },
  {
    id: 'm8-rules',
    icon: '🚦',
    title: 'How to use Breadth in your decisions',
    body: [
      'Strong breadth (A-D Line rising, 60%+ stocks above 30W MA, Stage 2 count high): buy confidently, add to winners, look for new entries. This is the best environment to be aggressive.',
      'Mixed breadth: only buy the strongest RS stocks, keep positions smaller, be quick to exit at the first sign of weakness. You are swimming against some current.',
      'Weak breadth (A-D Line falling, Stage 2 count dropping): stop buying new stocks, tighten stop losses on existing positions, move to cash. Very weak breadth + Nifty Stage 4: stay in cash entirely. Capital protection is a strategy, not a failure.',
    ],
  },
  {
    id: 'm8-summary',
    icon: '🎛️',
    title: 'Summary — Market Breadth',
    body: [
      'Market breadth = are MOST stocks rising or just a few big ones? Advance-Decline Line = daily score of stocks going up vs down. % stocks above 30W MA = quick health check of the whole market.',
      'Stage 2 count on PineX = how many stocks are in uptrends right now. Breadth divergence = Nifty rising but A-D Line falling = early warning of a top.',
      'Strong breadth = buy confidently. Weak breadth = protect capital. Always check market breadth BEFORE making new buy decisions. You now have every tool in the PineX framework — use them together.',
    ],
  },
]

const M8_QUIZ = [
  {
    question: 'Nifty just made a new all-time high. You are excited and want to buy stocks. But you check the A-D Line and see it has been falling for the past 3 weeks even as Nifty rose. Only 38% of NSE stocks are above their 30W MA. What does this tell you and what should you do?',
    options: [
      'Serious warning — breadth divergence. Tighten stops, avoid new entries, wait for breadth to improve',
      'Great time to buy — Nifty at all-time high is always bullish',
      'Buy only Nifty 50 stocks since they are the ones pushing Nifty higher',
      'The A-D Line is a lagging indicator — ignore it and follow Nifty',
    ],
    correct: 0,
    explanation: 'This is a classic breadth divergence — a serious warning sign. Nifty is being pulled up by a few heavyweight stocks while most stocks are already weakening. With only 38% of stocks above their 30W MA, the market is in mixed-to-weak territory. This is not the time for aggressive buying. Tighten stop losses on existing positions, avoid new entries, and wait for breadth to improve before buying.',
  },
  {
    question: 'The PineX home page shows Stage 2 stock count has risen from 380 to 720 over the past 6 weeks. The A-D Line is rising steadily. 68% of stocks are above their 30W MA. Nifty is in Stage 2. What does all this tell you?',
    options: [
      'Market breadth is strong on every measure — ideal environment to buy Stage 2 stocks with confidence',
      'The market has risen too much — wait for a pullback before buying anything',
      'Only buy Nifty 50 stocks when breadth is this strong',
      'This data is unreliable — use only price action to make decisions',
    ],
    correct: 0,
    explanation: 'Market breadth is strong and improving on every measure. This is a healthy broad-based bull market — not just a few stocks holding things up. Rising Stage 2 count, rising A-D Line, 68% above 30W MA, and Nifty in Stage 2 is the ideal combination. This is an ideal environment for buying Stage 2 stocks with strong RS and volume confirmation. Confidence level is high — buy aggressively when you find good setups.',
  },
]

// ─── Content data — Module 9 ─────────────────────────────────────────────────

const M9_LESSONS = [
  {
    id: 'm9-what',
    icon: '🔍',
    title: 'What is SwingX?',
    body: [
      'SwingX is a stock screening tool on PineX. It scans NSE stocks and surfaces those that match a set of technical criteria based on the Weinstein method — for you to study further. It does not tell you what to do.',
      'Think of it like a search filter — the way you filter hotels on a travel app by rating, price, and location. SwingX filters stocks by stage, trend, relative strength, and volume. What you do with that information is entirely your decision.',
      'Always consult a SEBI registered financial advisor before making any financial decisions.',
    ],
    disclaimer: '⚠️ PineX is not a SEBI registered investment advisor. This is a screening and educational tool only.',
  },
  {
    id: 'm9-method',
    icon: '🧱',
    title: 'The Methodology: everything you already know',
    body: [
      'SwingX screening is built on the exact concepts you studied in this course. A stock appears on SwingX only when it matches ALL of these criteria: Stage 2 (M1), Nifty in Stage 2 (M2), Rising RS vs Nifty (M3), Price above rising 30W MA (M4), Above average volume and delivery (M5), Near a key technical level (M6).',
      'Each criterion is observable, measurable, and based on price and volume data — not opinion. You have studied every one of these tools across the previous 8 modules.',
      'When all 6 criteria align simultaneously, SwingX flags the stock for your further study. This is rare — on most days only 5 to 15 stocks out of 2123 qualify.',
    ],
  },
  {
    id: 'm9-scan',
    icon: '⚙️',
    title: 'How the daily screening works',
    body: [
      'Every day after market close, PineX runs automated scripts that scan all 2123 NSE stocks against the Weinstein criteria. The scan checks stage classification, 30W MA position and direction, RS vs Nifty trend, volume patterns, delivery percentage, and market breadth.',
      'On most days only 5 to 15 stocks out of 2123 match all criteria simultaneously. This is not a prediction — it is a filter. A stock appearing on SwingX means it currently shows the technical characteristics that Weinstein\'s research associated with strong price trends.',
      'It does not guarantee future performance. Markets can and do surprise — no screen can predict news, events, or sudden reversals.',
    ],
  },
  {
    id: 'm9-types',
    icon: '📋',
    title: 'The two screen types',
    body: [
      'SwingX surfaces two types of technical setups for you to study. Breakout Screen: stock has moved above a key resistance level or 52-week high with above average volume and delivery. Weinstein research associates this pattern with the early phase of strong trends.',
      'Pullback Screen: Stage 2 stock has pulled back toward the 30W MA on below average volume. Weinstein describes this as a lower-risk study point within an established trend — the stock is resting, not reversing.',
      'Understanding which type you are looking at helps you understand the technical context. Neither type is a recommendation to act.',
    ],
  },
  {
    id: 'm9-risk',
    icon: '⚠️',
    title: 'Risk factors — what can go wrong',
    body: [
      'No screening tool is perfect. Stocks that match all Weinstein criteria can still fall. Markets can reverse suddenly due to global events, company news, regulatory changes, or macroeconomic factors that no technical screen can predict.',
      'Common risks: False breakouts — price breaks resistance then reverses. Market reversal — Nifty enters Stage 4. Operator manipulation — volume and price can be artificially influenced in smaller stocks. Fundamental deterioration — a company\'s business may be weakening even if the chart looks strong.',
      'Always study a stock from multiple angles — technical screens are one input among many, not the final word.',
    ],
  },
  {
    id: 'm9-process',
    icon: '📝',
    title: 'How to use SwingX responsibly',
    body: [
      'SwingX is a starting point for your own research — not an endpoint. When a stock appears on SwingX, here is a responsible study process: Step 1 — understand the technical picture (all the tools from this course). Step 2 — read the company\'s fundamentals. Step 3 — check recent news, upcoming results, promoter activity. Step 4 — assess your own financial situation and risk tolerance.',
      'Step 5 — consult a SEBI registered financial advisor before acting. This step is not optional.',
      'SwingX gives you the technical context. You and your advisor make the decision.',
    ],
  },
  {
    id: 'm9-not',
    icon: '✅',
    title: 'What SwingX is and is not',
    body: [
      'SwingX is NOT: a buy or sell recommendation, a guarantee of returns, investment advice of any kind, a substitute for a SEBI registered financial advisor, or a prediction of future price movement.',
      'SwingX IS: a technical screening tool, an educational resource to practice Weinstein analysis, a way to study how professional technical criteria apply to real NSE stocks, and a starting point for your own deeper research.',
      'Understanding this distinction protects you legally and financially. PineX is a tool for learning — not a shortcut to returns.',
    ],
  },
  {
    id: 'm9-summary',
    icon: '🎓',
    title: 'Course Complete — The Full Framework',
    body: [
      'You have now studied the complete Weinstein methodology as implemented in PineX. The 4 Stages give you a framework. Nifty and Market Breadth give you context. Relative Strength shows you which stocks are leading. The 30W MA defines the trend mathematically.',
      'Volume and Delivery show you where real interest exists. Support and Resistance give you structure. Chart Reading puts it all together. SwingX applies all of this as a daily technical screen — for you to study and learn from.',
      'The goal of PineX is to make you a more informed, more systematic student of the market. What you do with this knowledge is your responsibility.',
    ],
  },
]

const M9_QUIZ = [
  {
    question: 'A friend sees a stock on SwingX and immediately puts all his savings into it without any further research, saying "PineX told me to buy this." What is wrong with this approach?',
    options: [
      'SwingX is a screening tool, not a buy recommendation — always study further and consult a SEBI advisor first',
      'Nothing wrong — if it matches all 6 criteria it is a safe buy',
      'He should have waited for a second stock to appear on SwingX before investing',
      'The problem is he used all his savings — a half position would have been fine',
    ],
    correct: 0,
    explanation: 'SwingX is a technical screening tool — not a buy recommendation. PineX is not a SEBI registered investment advisor and does not tell anyone to buy anything. A responsible approach involves studying the company fundamentals, checking recent news, understanding personal risk tolerance, and consulting a SEBI registered financial advisor before making any financial decision. No screen replaces proper due diligence.',
  },
  {
    question: 'A stock matched all 6 SwingX criteria yesterday. Today the company announced that its promoter has been selling large quantities of shares for the past month. Does the SwingX screen still hold the same value?',
    options: [
      'No — promoter selling is a serious warning sign the technical screen cannot capture. Check fundamentals and news first.',
      'Yes — technical criteria are more reliable than promoter news',
      'Yes — wait for the price to actually fall before reconsidering',
      'Only if the A-D Line is also falling should you be concerned',
    ],
    correct: 0,
    explanation: 'This is new fundamental and news information that the technical screen cannot capture. Promoter selling is a serious warning sign regardless of what the chart shows. This is exactly why SwingX is a starting point for research, not an endpoint. Always check fundamentals and recent news alongside any technical screen before drawing any conclusions — and consult a SEBI registered financial advisor before acting.',
  },
]

// ─── Shared constants ─────────────────────────────────────────────────────────

const COMING_SOON = []

const MODULES = [
  { num: 1, title: 'The Weinstein 4-Stage Method', short: 'Weinstein Stages',     desc: 'Every stock cycles through 4 stages. Spot which stage to buy and which to avoid.', icon: '🌱' },
  { num: 2, title: 'Nifty 50 & the Market',         short: 'Nifty 50 & Market',    desc: 'How the Indian market works, and why checking Nifty comes before buying.',           icon: '📈' },
  { num: 3, title: 'Relative Strength vs Nifty',    short: 'RS vs Nifty',          desc: 'Find stocks that genuinely beat the market — not just rise with it.',                icon: '💪' },
  { num: 4, title: 'The 30-Week Moving Average',    short: '30W MA',               desc: 'The single trend filter that separates Stage 2 from Stage 4.',                       icon: '📊' },
  { num: 5, title: 'Volume & Delivery Volume',      short: 'Volume',               desc: 'What confirms a real move vs a fake one — using delivery %.',                        icon: '🔊' },
  { num: 6, title: 'Support & Resistance',          short: 'Support & Resistance', desc: 'Price floors, ceilings, and the Flip Rule for high-confidence entries.',             icon: '🧱' },
  { num: 7, title: 'How to Read a Stock Chart',     short: 'Chart Reading',        desc: 'A 6-point checklist for reading any chart in under a minute.',                       icon: '🔍' },
  { num: 8, title: 'Market Breadth',                short: 'Market Breadth',       desc: 'Is the rally broad or fragile? Read the health of the whole market.',                icon: '🌐' },
  { num: 9, title: 'SwingX — The Screening Tool',   short: 'SwingX',               desc: 'How PineX applies the Weinstein framework as a daily screen.',                       icon: '🎯' },
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
  if (id === 'm4-avg')          return <AverageChart />
  if (id === 'm4-ma-window')    return <MAWindowChart />
  if (id === 'm4-why-30w')      return <NoisyVsMAChart />
  if (id === 'm4-4rules')       return <MAZonesChart />
  if (id === 'm4-support')      return <MAPullbackChart />
  if (id === 'm4-extended')     return <ExtendedMAChart />
  if (id === 'm4-summary')          return <MAHeroChart />
  if (id === 'm5-vol-intro')        return <VolumeMarketChart />
  if (id === 'm5-vol-confirm')      return <VolumeConfirmChart />
  if (id === 'm5-vol-stage2')       return <VolumeStage2Chart />
  if (id === 'm5-delivery')         return <DeliveryVsIntradayChart />
  if (id === 'm5-delivery-pinex')   return <DeliveryBreakoutChart />
  if (id === 'm5-dryup')            return <VolumeDryUpChart />
  if (id === 'm5-summary')          return <VolumeHeroChart />
  if (id === 'm6-support')          return <SupportBounceChart />
  if (id === 'm6-resistance')       return <ResistanceRejectionChart />
  if (id === 'm6-psychology')       return <SRPsychologyChart />
  if (id === 'm6-flip')             return <FlipRuleChart />
  if (id === 'm6-ma-sr')            return <SRwithMAChart />
  if (id === 'm6-spotting')         return <SRLevelsChart />
  if (id === 'm6-summary')          return <SRHeroChart />
  if (id === 'm7-story')            return <StoryArcChart />
  if (id === 'm7-candle')           return <CandlestickDiagramChart />
  if (id === 'm7-zoom')             return <DecisionFlowChart />
  if (id === 'm7-staircase')        return <StaircaseChart />
  if (id === 'm7-volume-story')     return <VolumeHealthChart />
  if (id === 'm7-checklist')        return <ChecklistCardChart />
  if (id === 'm7-summary')          return <MasterChart />
  if (id === 'm8-what')             return <BreadthCricketChart />
  if (id === 'm8-adline')           return <ADLineChart />
  if (id === 'm8-pct30w')           return <BreadthGaugeChart />
  if (id === 'm8-stage2count')      return <Stage2CountChart />
  if (id === 'm8-divergence')       return <BreadthDivergenceChart />
  if (id === 'm8-rules')            return <BreadthTrafficLightChart />
  if (id === 'm8-summary')          return <BreadthDashboardChart />
  if (id === 'm9-what')             return <SwingXFunnelChart />
  if (id === 'm9-method')           return <SwingXMethodChart />
  if (id === 'm9-scan')             return <SwingXScanChart />
  if (id === 'm9-types')            return <SwingXScreenTypesChart />
  if (id === 'm9-risk')             return <SwingXRiskChart />
  if (id === 'm9-process')          return <SwingXProcessChart />
  if (id === 'm9-not')              return <SwingXNotChart />
  if (id === 'm9-summary')          return <SwingXGraduationChart />
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

function LessonCard({ lesson, onNext, isLast, onBack, isFirstCard }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 10px', alignSelf: 'flex-start' }}>
        ← {isFirstCard ? 'Back to modules' : 'Back'}
      </button>
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
        {lesson.disclaimer && (
          <div style={{ background: 'rgba(251,191,36,0.07)', border: `1px solid ${C.amber}55`, borderRadius: 10, padding: '10px 14px', marginTop: 14 }}>
            <p style={{ margin: 0, fontSize: 12, color: C.amber, lineHeight: 1.6 }}>{lesson.disclaimer}</p>
          </div>
        )}
      </div>
      <button onClick={onNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
        {isLast ? 'Start Quiz →' : 'Next →'}
      </button>
    </div>
  )
}

function QuizCard({ q, qNum, total, onNext, isLast, onBack }) {
  const [picked, setPicked] = useState(null)

  const shuffled = useMemo(() => {
    const opts = q.options.map((text, i) => ({ text, isCorrect: i === q.correct }))
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]]
    }
    return opts
  }, [q])

  const correctIdx = shuffled.findIndex(o => o.isCorrect)
  const isCorrect = picked === correctIdx

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 10px', alignSelf: 'flex-start' }}>
        ← Back
      </button>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Question {qNum} of {total}
        </div>
        <p style={{ fontSize: 16, fontWeight: 600, color: C.textHeading, lineHeight: 1.6, margin: '0 0 20px' }}>{q.question}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {shuffled.map((opt, i) => {
            let bg = C.surface2, border = C.border, color = C.text
            if (picked !== null) {
              if (i === correctIdx)  { bg = C.greenBg; border = C.greenBorder; color = C.green }
              else if (i === picked) { bg = C.redBg;   border = C.redBorder;   color = C.red   }
            }
            const letterColor = picked === null ? C.blue : (i === correctIdx ? C.green : (i === picked ? C.red : C.textMuted))
            return (
              <button key={i} onClick={() => picked === null && setPicked(i)}
                style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: picked === null ? 'pointer' : 'default', color, fontSize: 14, fontWeight: 500, lineHeight: 1.4, transition: 'all 0.15s' }}>
                <span style={{ fontWeight: 700, marginRight: 8, color: letterColor }}>{String.fromCharCode(65 + i)}.</span>
                {opt.text}
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

function CompletionScreen({ moduleNum, onStartNext, onHome, onBack }) {
  const modNames = {
    1: 'The Weinstein 4-Stage Method',
    2: 'Nifty 50 & the Market',
    3: 'Relative Strength vs Nifty',
    4: 'The 30-Week Moving Average',
    5: 'Volume & Delivery Volume',
    6: 'Support & Resistance',
    7: 'How to Read a Stock Chart',
    8: 'Market Breadth',
    9: 'SwingX — The Screening Tool',
  }
  const summaryText = {
    1: <>You now know the most important framework for stock investing. Every time you look at a stock, ask yourself: <strong style={{ color: C.textHeading }}>which stage is it in?</strong></>,
    2: <>You now understand how the Indian stock market works, what Nifty 50 is, and why checking Nifty's stage is essential before buying any stock.</>,
    3: <>You now know how to find stocks that are genuinely beating the market — not just rising because of Nifty. Always look for <strong style={{ color: C.textHeading }}>Stage 2 + Rising RS</strong> together.</>,
    4: <>You now have a complete buying framework: <strong style={{ color: C.textHeading }}>Stage 2 + Rising RS + Pullback to 30W MA</strong>. These three filters together point you to high-quality, low-risk entries.</>,
    5: <>You now understand volume confirmation, delivery %, and the dry-up signal. Add these to your checklist: <strong style={{ color: C.textHeading }}>Stage 2 + RS + 30W MA + High Delivery %</strong> = complete buy signal.</>,
    6: <>You now understand support, resistance, and the Flip Rule. The best entries combine: <strong style={{ color: C.textHeading }}>30W MA + horizontal support + high delivery %</strong> — multiple layers of confirmation.</>,
    7: <>You now have the complete PineX framework. Use the <strong style={{ color: C.textHeading }}>6-point checklist</strong> on every trade: Stage 2, 30W MA, RS, staircase, support/resistance, and delivery %. The more checks, the higher the confidence.</>,
    8: <>You can now read the health of the entire market in seconds. Check the <strong style={{ color: C.textHeading }}>A-D Line, % above 30W MA, and Stage 2 count</strong> before every buy. Strong breadth = buy. Weak breadth = protect capital.</>,
    9: <>You have studied the complete Weinstein methodology as implemented in PineX. SwingX is the technical screener that applies everything you have learned — every day, across all 2123 NSE stocks.</>,
  }
  const upNextData = {
    2: { title: 'Nifty 50 & the Market',           desc: 'The Indian stock market, Nifty, and bull vs bear markets.' },
    3: { title: 'Relative Strength (RS) vs Nifty', desc: 'Why some stocks beat the market and how to find them.' },
    4: { title: 'The 30-Week Moving Average',       desc: 'The trend filter that separates Stage 2 from Stage 4.' },
    5: { title: 'Volume & Delivery Volume',         desc: 'What confirms a real move vs a fake one.' },
    6: { title: 'Support & Resistance',             desc: 'Price floors, ceilings, and the powerful Flip Rule.' },
    7: { title: 'How to Read a Stock Chart',        desc: 'Putting all 6 modules together into one reading framework.' },
    8: { title: 'Market Breadth',                   desc: 'Is the rally broad-based or just a few stocks holding things up?' },
    9: { title: 'SwingX — The Screening Tool',      desc: 'How PineX applies the Weinstein framework as a daily screen.' },
  }
  const hasNext = moduleNum < 9
  const isGraduation = moduleNum === 9

  const allModules = [
    { num: 1, title: 'Weinstein Stages' },
    { num: 2, title: 'Nifty 50 & Market' },
    { num: 3, title: 'RS vs Nifty' },
    { num: 4, title: '30W MA' },
    { num: 5, title: 'Volume' },
    { num: 6, title: 'Support & Resistance' },
    { num: 7, title: 'Chart Reading' },
    { num: 8, title: 'Market Breadth' },
    { num: 9, title: 'SwingX' },
  ]

  if (isGraduation) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 10px', alignSelf: 'flex-start' }}>
          ← Back
        </button>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ textAlign: 'center', padding: '20px 0 20px' }}>
            <div style={{ fontSize: 56, marginBottom: 10 }}>🎓</div>
            <h2 style={{ fontSize: 24, fontWeight: 800, color: C.textHeading, margin: '0 0 6px' }}>Course Complete!</h2>
            <p style={{ fontSize: 14, color: C.textMuted, margin: '0 0 4px', lineHeight: 1.5 }}>You have studied the full Weinstein methodology as applied on PineX.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {allModules.map(m => (
              <div key={m.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10 }}>
                <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, background: C.greenBg, border: `1px solid ${C.greenBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: C.green }}>✓</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.textMuted }}>{m.num}.</span>
                <span style={{ fontSize: 13, color: C.text }}>{m.title}</span>
              </div>
            ))}
          </div>

          <div style={{ background: 'rgba(251,191,36,0.07)', border: `1px solid ${C.amber}55`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: C.amber, lineHeight: 1.6, margin: 0 }}>
              ⚠️ <strong>PineX is not a SEBI registered investment advisor.</strong> Everything on PineX is for educational and informational purposes only. Please consult a SEBI registered financial advisor before making any investment decisions.
            </p>
          </div>

          <p style={{ fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 1.6, marginBottom: 16 }}>
            An informed investor is a better investor. Keep learning, keep questioning.
          </p>
        </div>

        <button onClick={onHome} style={{ marginTop: 4, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.green, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
          Go to Home →
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: 'none', color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '0 0 10px', alignSelf: 'flex-start' }}>
        ← Back
      </button>
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

        {COMING_SOON.length > 0 && (
          <>
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
          </>
        )}
      </div>

      <button onClick={onStartNext} style={{ marginTop: 20, width: '100%', padding: '14px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.blue, color: '#000', fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
        Start Module {moduleNum + 1} →
      </button>
      <button onClick={onHome} style={{ marginTop: 10, width: '100%', padding: '12px', borderRadius: 12, border: `1px solid ${C.border}`, cursor: 'pointer', background: 'transparent', color: C.textMuted, fontSize: 14, fontWeight: 600, flexShrink: 0 }}>
        Go Home
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Learn() {
  const navigate = useNavigate()
  const [viewMode, setViewMode]         = useState('index')
  const [activeModule, setActiveModule] = useState(1)
  const [moduleSteps, setModuleSteps]   = useState({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 })

  const lessonMap = { 1: LESSONS, 2: M2_LESSONS, 3: M3_LESSONS, 4: M4_LESSONS, 5: M5_LESSONS, 6: M6_LESSONS, 7: M7_LESSONS, 8: M8_LESSONS, 9: M9_LESSONS }
  const quizMap   = { 1: QUIZ,    2: M2_QUIZ,    3: M3_QUIZ,    4: M4_QUIZ,    5: M5_QUIZ,    6: M6_QUIZ,    7: M7_QUIZ,    8: M8_QUIZ,    9: M9_QUIZ    }
  const lessons = lessonMap[activeModule] ?? M9_LESSONS
  const quiz    = quizMap[activeModule]   ?? M9_QUIZ
  const step    = moduleSteps[activeModule]
  const total   = lessons.length + quiz.length

  const isDone   = step >= total
  const progress = isDone ? 1 : step / total

  const openModule = (num) => {
    setActiveModule(num)
    setModuleSteps(s => ({ ...s, [num]: 0 }))
    setViewMode('study')
  }

  const handleNext      = () => setModuleSteps(s => ({ ...s, [activeModule]: s[activeModule] + 1 }))
  const handleSwitchMod = (num) => setActiveModule(num)
  const handleBack = () => {
    if (isDone) {
      setModuleSteps(s => ({ ...s, [activeModule]: lessons.length + quiz.length - 1 }))
    } else if (currentQuizIdx !== null) {
      setModuleSteps(s => ({ ...s, [activeModule]: lessons.length - 1 }))
    } else if (step === 0) {
      setViewMode('index')
    } else {
      setModuleSteps(s => ({ ...s, [activeModule]: s[activeModule] - 1 }))
    }
  }

  const currentLesson  = !isDone && step < lessons.length ? lessons[step] : null
  const currentQuizIdx = !isDone && step >= lessons.length ? step - lessons.length : null

  const modTitles = { 1: 'Weinstein Stages', 2: 'Nifty 50 & Market', 3: 'RS vs Nifty', 4: '30W MA', 5: 'Volume', 6: 'S&R', 7: 'Charts', 8: 'Breadth', 9: 'SwingX' }

  if (viewMode === 'index') {
    return (
      <>
        <Helmet>
          <title>Learn — Stock Market Basics | PineX</title>
          <meta name="description" content="Learn Weinstein stages, Nifty 50, and how the Indian stock market works. Simple English, tap-through lessons." />
        </Helmet>

        <div style={{ minHeight: '100vh', background: C.base, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexShrink: 0, padding: '12px 16px 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => navigate('/')} aria-label="Go back"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: 'pointer', flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Learn</div>
          </div>

          <div style={{ flex: 1, padding: '8px 16px 88px', maxWidth: 520, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
            <div style={{ padding: '6px 0 16px' }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: C.textHeading, margin: '0 0 6px' }}>All Courses</h1>
              <p style={{ fontSize: 13, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
                {MODULES.length} modules · the complete Weinstein method as applied on PineX.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MODULES.map(m => {
                const lc = (lessonMap[m.num] ?? []).length
                const qc = (quizMap[m.num] ?? []).length
                const done = (moduleSteps[m.num] ?? 0) >= lc + qc && lc + qc > 0
                return (
                  <button key={m.num} type="button" onClick={() => openModule(m.num)}
                    style={{ textAlign: 'left', background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', color: 'inherit' }}>
                    <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: C.blueBg, border: `1px solid ${C.blue}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{m.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.blue }}>MODULE {m.num}</span>
                        {done && <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>✓ DONE</span>}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.textHeading, marginBottom: 4, lineHeight: 1.3 }}>{m.title}</div>
                      <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 6 }}>{m.desc}</div>
                      <div style={{ fontSize: 11, color: C.textFaint }}>{lc} lessons · {qc} quiz questions</div>
                    </div>
                    <span style={{ fontSize: 16, color: C.textMuted, alignSelf: 'center' }}>→</span>
                  </button>
                )
              })}
              {COMING_SOON.map(m => (
                <div key={m.num} style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px', display: 'flex', alignItems: 'flex-start', gap: 12, opacity: 0.6 }}>
                  <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: C.border, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: C.textMuted }}>{m.num}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.textMuted, marginBottom: 4 }}>{m.title}</div>
                    <div style={{ fontSize: 12, color: C.textFaint }}>{m.desc}</div>
                    <div style={{ fontSize: 11, color: C.blue, marginTop: 6, fontWeight: 700 }}>Coming Soon</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Helmet>
        <title>Learn — Stock Market Basics | PineX</title>
        <meta name="description" content="Learn Weinstein stages, Nifty 50, and how the Indian stock market works. Simple English, tap-through lessons." />
      </Helmet>

      <div style={{ minHeight: '100vh', background: C.base, display: 'flex', flexDirection: 'column' }}>

        {/* Header + progress bar */}
        <div style={{ flexShrink: 0, padding: '12px 16px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setViewMode('index')} aria-label="Back to courses"
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
            <CompletionScreen moduleNum={activeModule} onStartNext={() => setActiveModule(activeModule + 1)} onHome={() => navigate('/')} onBack={handleBack} />
          ) : currentLesson ? (
            <LessonCard lesson={currentLesson} onNext={handleNext} isLast={step === lessons.length - 1} onBack={handleBack} isFirstCard={step === 0} />
          ) : currentQuizIdx !== null ? (
            <QuizCard key={currentQuizIdx} q={quiz[currentQuizIdx]} qNum={currentQuizIdx + 1} total={quiz.length} onNext={handleNext} isLast={currentQuizIdx === quiz.length - 1} onBack={handleBack} />
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
              { num: 4, title: '30W MA' },
              { num: 5, title: 'Volume' },
              { num: 6, title: 'S&R' },
              { num: 7, title: 'Charts' },
              { num: 8, title: 'Breadth' },
              { num: 9, title: 'SwingX' },
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
