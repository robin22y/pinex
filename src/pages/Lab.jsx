import { useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { readLocal, writeLocal } from '../lib/localStore'
import { useAuth } from '../context'
import { C } from '../styles/tokens'
import ProBadge from '../components/ProBadge'
import InfoSheet from '../components/InfoSheet'
import ExportMenu from '../components/ExportMenu'
import { fetchPhaseHistory, sessionsInCurrentPhase, formatPhaseAge } from '../lib/phaseHelpers'
import { askGemini, getStoredGeminiKey } from '../lib/researchAssistant'
import useProGate from '../hooks/useProGate'

import Icon from '../components/ui/Icon'
import Tooltip from '../components/ui/Tooltip'

// ── SwingXEducationalBanner ───────────────────────────────────────
// Dismissible top-of-Lab educational banner. localStorage key
// 'swingx_edu_dismissed' stores the dismissal timestamp; banner
// reappears once seven days have passed since dismissal so the
// disclaimer cycles back into view periodically rather than being
// permanently silenced after one tap on the × button.
//
// Copy is product-legal text supplied verbatim — do NOT paraphrase
// the body text without re-confirming with the operator.
const SWINGX_EDU_KEY = 'swingx_edu_dismissed'
const SWINGX_EDU_REAPPEAR_MS = 7 * 24 * 60 * 60 * 1000

function SwingXEducationalBanner() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let show = true
    try {
      const raw = localStorage.getItem(SWINGX_EDU_KEY)
      const ts = Number(raw)
      if (Number.isFinite(ts) && ts > 0 && Date.now() <= ts + SWINGX_EDU_REAPPEAR_MS) {
        show = false
      }
    } catch { /* private mode — keep showing */ }
    setVisible(show)
  }, [])

  if (!visible) return null

  function dismiss() {
    try { localStorage.setItem(SWINGX_EDU_KEY, String(Date.now())) }
    catch { /* private mode — banner just stays this session */ }
    setVisible(false)
  }

  return (
    <div
      role="note"
      aria-label="SwingX educational notice"
      style={{
        margin: '0 16px 12px',
        padding: '14px 16px 14px 18px',
        background: '#0F1217',
        border: '1px solid rgba(251, 191, 36, 0.25)',
        borderLeft: '3px solid #FBBF24',
        borderRadius: 6,
        position: 'relative',
        color: '#E2E8F0',
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notice"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          background: 'transparent',
          border: 'none',
          color: '#64748B',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          padding: '4px 8px',
        }}
      >
        ×
      </button>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          marginBottom: 8,
          paddingRight: 24,
        }}
      >
        📚 How to use this data
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: '#CBD5E1' }}>
        These stocks meet PineX cycle conditions based on historical pattern analysis.
      </p>
      <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.6, color: '#CBD5E1' }}>
        This is not a buy recommendation.
      </p>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: '#CBD5E1' }}>
        Before acting on any data:
        <div style={{ marginTop: 2 }}>- Verify on NSE: nseindia.com</div>
        <div>- Review company fundamentals</div>
        <div>- Read the latest annual report</div>
        <div>- Consult a financial adviser</div>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.6, color: '#CBD5E1' }}>
        Past conditions do not guarantee future outcomes.
      </p>
    </div>
  )
}

// ── LabResultsBottomNote ──────────────────────────────────────────
// Plain text note rendered below the results list. Copy is supplied
// verbatim — do NOT paraphrase.
function LabResultsBottomNote() {
  return (
    <div
      role="note"
      style={{
        margin: '24px 16px 0',
        padding: '12px 14px',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#94A3B8',
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <div>Results are based on end-of-day data.</div>
      <div>Data may be delayed or inaccurate. Verify independently before making any decision.</div>
      <div>Not investment advice.</div>
    </div>
  )
}
// ── The Lab ──────────────────────────────────────────────────────────────────
// A user-EXECUTED screener. Results NEVER auto-populate — the user picks a
// template, reviews the mathematical criteria, and clicks "Run My Screen".
// This is the core legal posture: PineX outputs the result of the user's own
// query against pre-calculated EOD data; it does not suggest stocks.
//
// Data: mv_home_stocks (price/RS/volume/obv) merged with swing_conditions
// (the 5 SwingX condition booleans + conditions_met) for the latest trading day.

// Optional gates shared by the per-stage screens — all OFF by default so the
// base list (every Stage-N stock) shows until the user opts into a narrowing
// filter. Reuses the same criterion ids/tests as SwingX.
const STAGE_GATES = [
  {
    id: 'swingx_volume_2x', name: 'Volume ≥ multiplier × recent average',
    formula: 'Today volume ÷ 30-day average volume ≥ multiplier',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
    why: 'Above-average volume is observed as heavier participation behind the move.',
    notMean: 'Volume alone does not confirm direction. It is a data point only.',
  },
  {
    id: 'swingx_rs_positive', name: 'RS vs Nifty above threshold',
    formula: 'RS vs Nifty (119D) > min %',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Minimum RS %', value: 0, min: -50, max: 50, step: 5 },
    why: 'Relative strength compares the stock’s return to the index over ~6 months.',
    notMean: 'Past relative strength does not guarantee future outperformance.',
  },
  {
    id: 'swingx_strong_sector', name: 'From a strong sector',
    formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
    col: null, defaultOn: false, adjustable: true,
    param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
    why: 'Sector breadth measures how many of the sector’s stocks are above their own 30W average.',
    notMean: 'A strong sector does not guarantee individual stock performance.',
  },
]

const TEMPLATES = [
  {
    id: 'trend-convergence', name: 'Trend Convergence', icon: 'trending-up', badge: null,
    tagline: 'Price, trend line, RS and OBV all pointing up',
    criteria: [
      { id: 'above_tl', name: 'Price above 30W Trend Line', formula: 'Close > MA(30W)', col: null, defaultOn: true, why: 'Price trading above its long-term average is the baseline of an established uptrend.' },
      { id: 'tl_rising', name: '30W Trend Line slope rising', formula: 'MA(30W) today > MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A rising average shows the longer trend is still strengthening.' },
      { id: 'rs_positive', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > 0', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 0, min: -20, max: 50 }, why: 'Relative strength shows the stock is outperforming the index.' },
      { id: 'obv_rising', name: 'OBV slope rising', formula: 'OBV 10-day regression slope > 0', col: null, defaultOn: true, why: 'On-balance volume rising suggests accumulation under the price.' },
      { id: 'volume_above', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: false, why: 'Above-average volume shows participation behind the move.' },
      { id: 'near_tl', name: 'Extension < 15% from trend line', formula: '((Close − MA30W) / MA30W) × 100 < 15', col: null, defaultOn: false, adjustable: true, param: { label: 'Max extension %', value: 15, min: 5, max: 40 }, why: 'A smaller extension means price has not run too far from its average.' },
    ],
  },
  {
    id: 'base-formation', name: 'Base Formation', icon: 'minus', badge: null,
    tagline: 'Price stabilising after a decline on quiet volume',
    criteria: [
      { id: 'price_near_tl', name: 'Price near 30W Trend Line', formula: 'abs(Close − MA30W) / MA30W < 0.05', col: null, defaultOn: true, why: 'Price hugging its average is typical of a base.' },
      { id: 'tl_flat', name: 'Trend Line slope flat (Stage 1)', formula: 'MA(30W) slope ≈ 0', col: null, defaultOn: true, why: 'A flat average shows the prior decline has paused.' },
      { id: 'volume_low', name: 'Volume contracting', formula: 'Avg(Vol,3D) < Avg(Vol,30D) × 0.75', col: null, defaultOn: true, why: 'Drying-up volume often precedes a new move.' },
      { id: 'rsi_neutral', name: 'RSI in neutral range', formula: '40 ≤ RSI(14) ≤ 65', col: null, defaultOn: true, why: 'A neutral RSI is neither overbought nor oversold.' },
    ],
  },
  {
    id: 'trend-deterioration', name: 'Trend Deterioration', icon: 'trending-down', badge: null,
    tagline: 'Price below trend line with negative RS',
    criteria: [
      { id: 'below_tl', name: 'Price below 30W Trend Line', formula: 'Close < MA(30W)', col: null, defaultOn: true, why: 'Price below its average is the baseline of a downtrend.' },
      { id: 'rs_negative', name: 'RS vs Nifty negative', formula: 'Stock return − Nifty return (119D) < 0', col: null, defaultOn: true, why: 'Negative RS shows the stock is lagging the index.' },
      { id: 'tl_falling', name: 'Trend Line falling / breakdown', formula: 'MA(30W) today < MA(30W) 4 weeks ago', col: null, defaultOn: true, why: 'A falling average confirms the longer trend is weakening.' },
    ],
  },
  {
    // SwingX template — RE-WIRED to match the backend definition. The
    // four criteria below read directly from swing_conditions (the
    // table the daily pipeline writes to via calc_swing_conditions.py)
    // so the Lab list and the Telegram broadcast list are computed
    // from the same source of truth. The previous template tested its
    // own client-side volume / RS / sector / OBV gates which produced
    // a completely different (often non-overlapping) cohort.
    //
    // With every gate ON, the result is conditions_met >= 4 — which
    // is exactly what telegram_broadcast.py _fetch_swingx_today()
    // filters on.
    id: 'swingx', name: 'SwingX Template', icon: 'bolt', badge: 'PRO',
    tagline: 'Matches the backend SwingX list — turn all four ON for the canonical SwingX cohort',
    criteria: [
      {
        id: 'swingx_be_stage2', name: 'Stage 2 — above 30W trend',
        formula: 'condition_stage2 (close above rising 30W MA)',
        col: null, defaultOn: true, base: true,
        why: 'Stage 2 is the baseline of the SwingX definition. This is the locked base of the template — with every other gate off, the result is all Stage 2 stocks per the backend daily pipeline.',
        notMean: 'Stage 2 alone does not predict the move continues — only that price is above its long-term trend.',
      },
      {
        id: 'swingx_be_near_ma50', name: 'Close within 3% of MA50',
        formula: 'condition_near_ma50 (|close − MA50| / MA50 < 3%)',
        col: null, defaultOn: true,
        why: 'A close hugging the 50-day average is observed near rest-points in an established trend — a "pullback to the line" candidate. This is exactly the backend SwingX condition.',
        notMean: 'Proximity to MA50 is a positional observation, not a directional forecast. Stocks lacking MA50 data are excluded when this gate is on.',
      },
      {
        id: 'swingx_be_rsi_healthy', name: 'RSI 40-65 (healthy momentum)',
        formula: 'condition_rsi_healthy (40 ≤ RSI ≤ 65)',
        col: null, defaultOn: true,
        why: 'The 40-65 RSI band excludes both oversold and overbought extremes — the backend\'s "healthy momentum" criterion. Matches the daily pipeline\'s scoring exactly.',
        notMean: 'RSI is a price-derived oscillator. A "healthy" reading is descriptive, not predictive.',
      },
      {
        id: 'swingx_be_volume_contracting', name: 'Volume contracting',
        formula: 'condition_volume_contracting (3-day avg < 0.75 × 30-day avg)',
        col: null, defaultOn: true,
        why: 'A volume contraction during a pullback is observed as quiet — often interpreted as a stable base before the next move. This is the backend\'s exact definition.',
        notMean: 'Drying volume is a participation observation, not a setup confirmation.',
      },
      // No 5th criterion: the backend dropped delivery from the SwingX
      // score so the maximum conditions_met is 4 (not 5). Turning all
      // four gates above ON reproduces conditions_met == 4 exactly.
    ],
  },
  {
    id: 'breakout-30w', name: 'Recent 30W Breakout', icon: 'sparkles', badge: 'PRO',
    tagline: 'Just crossed above the 30W trend line on volume — and not yet extended',
    history: true,
    criteria: [
      {
        id: 'bx_recent_cross', name: 'Crossed above 30W Trend Line recently',
        formula: 'Close crossed from below to above MA(30W) within N weeks',
        col: null, defaultOn: true, base: true, adjustable: true,
        param: { label: 'Within how many weeks', value: 4, min: 1, max: 8, step: 1 },
        why: 'A recent crossover marks the week price reclaimed its long-term average — the point a downtrend can turn. Unlike the Stage-2 filter, this does NOT wait for the average itself to start rising, so it catches the cross early.',
        notMean: 'A crossover is a past event, not a prediction. Price can drop back below the line at any time.',
      },
      {
        id: 'bx_cross_volume', name: 'Above-average volume on the crossover',
        formula: 'Volume on the crossover day ÷ prior ~30-session average ≥ multiplier',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min volume multiplier', value: 2.0, min: 1.5, max: 5.0, step: 0.5 },
        why: 'Heavier volume on the crossover day is observed as stronger participation behind the move (measured at the cross, not on the run date).',
        notMean: 'Volume confirms nothing about future direction. It is one data point.',
      },
      {
        id: 'bx_not_extended', name: 'Not extended from the trend line',
        formula: '0 ≤ ((Close − MA30W) / MA30W) × 100 ≤ max %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Max extension %', value: 15, min: 5, max: 40, step: 5 },
        why: 'A small distance above the average means price has not already run far past the breakout. Also ensures price is still holding above the line.',
        notMean: 'A low extension is not a buy signal — only a measure of distance from the average.',
      },
      {
        id: 'bx_ma_not_declining', name: '30W Trend Line not declining',
        formula: 'Not in a Stage 4 / 30W breakdown',
        col: null, defaultOn: false,
        why: 'Filters out crossovers that happen inside a clear downtrend (a falling 30W average).',
        notMean: 'A flat or rising average does not guarantee an uptrend will follow.',
      },
      {
        id: 'swingx_strong_sector', name: 'From a strong sector',
        formula: 'Sector breadth > min % (sector stocks above their 30W MA)',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min sector breadth %', value: 50, min: 30, max: 70, step: 5 },
        why: 'Individual stock strength alongside broad sector strength is noted as contextual alignment.',
        notMean: 'A strong sector does not guarantee individual stock performance.',
      },
    ],
  },
  {
    id: 'rs-momentum', name: 'RS Momentum', icon: 'trending-up', badge: 'PRO',
    tagline: 'Outperforming Nifty with expanding volume',
    criteria: [
      { id: 'rs_strong', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > min', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 10, min: 0, max: 100 }, why: 'A higher RS bar isolates clearer outperformers.' },
      { id: 'volume_above_2', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: true, why: 'Above-average volume shows participation.' },
    ],
  },
  {
    id: 'stage-1', name: 'Stage 1 · Basing', icon: 'minus', badge: 'PRO',
    tagline: 'All Stage 1 (basing) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage1_base', name: 'In Stage 1 (basing)',
        formula: 'Weinstein stage classification = Stage 1',
        col: null, defaultOn: true, base: true,
        why: 'Stage 1 is the sideways base that follows a decline — price moving flat around a flattening 30W average. This defines the screen; with every gate off it lists all Stage 1 stocks.',
        notMean: 'A base can resolve up OR down. Stage 1 is an observation, not a forecast.',
      },
      ...STAGE_GATES,
    ],
  },
  {
    id: 'stage-2', name: 'Stage 2 · Advancing', icon: 'trending-up', badge: 'PRO',
    tagline: 'All Stage 2 (advancing) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage2_base', name: 'In Stage 2 (advancing)',
        formula: 'Weinstein stage classification = Stage 2',
        col: null, defaultOn: true, base: true,
        why: 'Stage 2 is the advancing phase — price above a rising 30W average. This defines the screen; with every gate off it lists all Stage 2 stocks. (Same base as the SwingX template.)',
        notMean: 'An advance can stall or reverse at any time. Stage 2 is an observation, not a forecast.',
      },
      ...STAGE_GATES,
    ],
  },
  {
    id: 'stage-3', name: 'Stage 3 · Topping', icon: 'arrow-up', badge: 'PRO',
    tagline: 'All Stage 3 (topping) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage3_base', name: 'In Stage 3 (topping)',
        formula: 'Weinstein stage classification = Stage 3',
        col: null, defaultOn: true, base: true,
        why: 'Stage 3 is the rounding top after an advance — momentum fading while price stalls near its highs. This defines the screen; with every gate off it lists all Stage 3 stocks.',
        notMean: 'A top can resume up or roll over. Stage 3 is an observation, not a forecast.',
      },
      {
        id: 's3_off_highs', name: 'Off its 52-week high (no new highs)',
        formula: '(52W high − close) / 52W high × 100 ≥ min %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min % below 52W high', value: 5, min: 0, max: 30, step: 1 },
        why: 'A topping stock stops making new highs — price sits a measurable distance below its 52-week peak even as it churns.',
        notMean: 'Distance below the high is a measurement, not a sell signal.',
      },
      {
        id: 's3_high_volume', name: 'Volume above average (churn)',
        formula: 'Today volume ÷ 30-day average ≥ multiplier',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min volume multiplier', value: 1.2, min: 1.0, max: 3.0, step: 0.1 },
        why: 'Heavy volume while price stalls near the top is often read as distribution — supply meeting demand.',
        notMean: 'High volume alone does not confirm a top.',
      },
      {
        id: 's3_rs_fading', name: 'RS vs Nifty flat-to-falling',
        formula: 'RS vs Nifty (119D) ≤ max %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Max RS %', value: 10, min: -20, max: 50, step: 5 },
        why: 'Leadership fades in a top — relative strength rolls over from its earlier highs.',
        notMean: 'A lower RS is a comparison to the index, not a forecast.',
      },
      {
        id: 's3_below_50dma', name: 'Lost the 50-day average',
        formula: 'Close < MA(50D)',
        col: null, defaultOn: false,
        why: 'Slipping below the shorter 50-day average is an early sign the top is breaking down — price can no longer hold its recent support.',
        notMean: 'Losing the 50DMA is an observation, not a forecast of further decline.',
      },
    ],
  },
  {
    id: 'stage-4', name: 'Stage 4 · Declining', icon: 'trending-down', badge: 'PRO',
    tagline: 'All Stage 4 (declining) stocks — add gates to narrow',
    criteria: [
      {
        id: 'stage4_base', name: 'In Stage 4 (declining)',
        formula: 'Weinstein stage classification = Stage 4',
        col: null, defaultOn: true, base: true,
        why: 'Stage 4 is the markdown phase — price below a falling 30W average. This defines the screen; with every gate off it lists all Stage 4 stocks.',
        notMean: 'A downtrend can pause or reverse. Stage 4 is an observation, not a forecast. (Stage 4 already means price is below a falling 30W average — that is the base.)',
      },
      {
        id: 's4_near_low', name: 'Near its 52-week low (lower lows)',
        formula: '(close − 52W low) / 52W low × 100 ≤ max %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Max % above 52W low', value: 10, min: 0, max: 40, step: 1 },
        why: 'A declining stock makes lower lows — price sits close to its 52-week trough.',
        notMean: 'Proximity to the low is not a buy or sell signal.',
      },
      {
        id: 's4_deep_below_ma', name: 'Well below the 30W trend line (lower lows)',
        formula: '(close − MA30W) / MA30W × 100 ≤ −min %',
        col: null, defaultOn: false, adjustable: true,
        param: { label: 'Min % below 30W MA', value: 10, min: 0, max: 40, step: 1 },
        why: 'A deeper gap below the long-term average reflects a sustained markdown making lower lows, rather than a stock just dipping under the line.',
        notMean: 'Distance below the average is a measurement, not a forecast.',
      },
      {
        id: 's4_below_50dma', name: 'Below the 50-day average too',
        formula: 'Close < MA(50D)',
        col: null, defaultOn: false,
        why: 'Below both the 50-day and 30-week averages means the decline holds across short and long timeframes.',
        notMean: 'Trading below the averages is an observation, not a forecast.',
      },
      {
        id: 's4_rs_negative', name: 'RS vs Nifty negative',
        formula: 'RS vs Nifty (119D) < 0',
        col: null, defaultOn: false,
        why: 'A declining stock typically lags the index — negative relative strength. (Volume is not used here — it is not a Stage 4 differentiator.)',
        notMean: 'Negative RS is a comparison to the index, not a forecast.',
      },
    ],
  },
]

// Client-side tests for criteria without a swing_conditions column. Each reads
// merged mv_home_stocks fields. (ma30w_slope isn't in the feed, so slope-based
// rules use defensible proxies — noted in the methodology.)
const CLIENT_TESTS = {
  above_tl: (m) => m.close != null && m.ma30w != null && m.close > m.ma30w,
  below_tl: (m) => m.close != null && m.ma30w != null && m.close < m.ma30w,
  rs_positive: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  rs_strong: (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 10),
  rs_negative: (m) => (m.rs_vs_nifty ?? 0) < 0,
  obv_rising: (m) => (parseFloat(m.obv_slope) || 0) > 0,
  volume_above: (m) => (m.vol_ratio || 0) > 1,
  volume_above_2: (m) => (m.vol_ratio || 0) > 1,
  near_tl: (m, p) => { const e = m.ma30w > 0 ? ((m.close - m.ma30w) / m.ma30w) * 100 : null; return e != null && e < (p ?? 15) },
  price_near_tl: (m) => m.ma30w > 0 && Math.abs((m.close - m.ma30w) / m.ma30w) < 0.05,
  tl_flat: (m) => m.stage === 'Stage 1',
  tl_falling: (m) => m.breakdown_30wma === true || m.stage === 'Stage 3' || m.stage === 'Stage 4',
  // Remapped from the (empty) swing_conditions table to real mv_home_stocks
  // fields. Slope / MA20 / 3D-volume aren't in the feed, so these use
  // documented proxies (stage, ma50, vol_ratio).
  tl_rising: (m) => m.stage === 'Stage 2',
  // SwingX (backend-matched). Each test reads the boolean that
  // calc_swing_conditions.py wrote into swing_conditions, merged onto
  // every mv_home_stocks row by loadUniverse. Stocks without a
  // swing_conditions row for the latest pipeline date fail every
  // backend gate (skip-if-unavailable rule), which keeps the screen
  // honest on pre-pipeline / weekend dev sessions.
  swingx_be_stage2:             (m) => m._has_swing_row && m._cond_stage2,
  swingx_be_near_ma50:          (m) => m._has_swing_row && m._cond_near_ma50,
  swingx_be_rsi_healthy:        (m) => m._has_swing_row && m._cond_rsi_healthy,
  swingx_be_volume_contracting: (m) => m._has_swing_row && m._cond_volume_contracting,
  // Legacy ids kept as backend-equivalent stubs so saved screens that
  // reference the old SwingX ids (volume_2x / rs_positive / etc.) still
  // resolve to SOMETHING — they fall through to the backend tests when
  // possible so user-saved older screens don't go silently empty.
  swingx_crossed_30w:   (m) => m.stage === 'Stage 2',
  swingx_volume_2x:     (m, p) => (m.vol_ratio || 0) >= (p ?? 2),
  swingx_rs_positive:   (m, p) => (m.rs_vs_nifty ?? -9999) > (p ?? 0),
  swingx_strong_sector: (m, p) => (m._sector_breadth ?? 0) > (p ?? 50),
  swingx_obv_rising:    (m) => (parseFloat(m.obv_slope) || 0) > 0,
  volume_low: (m) => (m.vol_ratio || 0) > 0 && m.vol_ratio < 1,
  rsi_neutral: (m) => m.rsi != null && m.rsi >= 40 && m.rsi <= 65,
  // Recent 30W Breakout — bx_recent_cross / bx_cross_volume read fields that
  // runScreen annotates from price_data history (snapshot has no history).
  bx_recent_cross: (m, p) => m._weeks_since_cross != null && m._weeks_since_cross <= (p ?? 4),
  bx_cross_volume: (m, p) => (m._crossover_vol_ratio ?? 0) >= (p ?? 2),
  bx_not_extended: (m, p) => {
    const e = m.ma30w > 0 && m.close != null ? ((m.close - m.ma30w) / m.ma30w) * 100 : null
    return e != null && e >= 0 && e <= (p ?? 15)
  },
  bx_ma_not_declining: (m) => m.stage !== 'Stage 4' && m.breakdown_30wma !== true,
  // Per-stage base filters (locked base of the Stage 1/2/3/4 screens).
  stage1_base: (m) => m.stage === 'Stage 1',
  stage2_base: (m) => m.stage === 'Stage 2',
  stage3_base: (m) => m.stage === 'Stage 3',
  stage4_base: (m) => m.stage === 'Stage 4',
  // Stage 3 (topping) — fails to make new highs (52W high now backfilled),
  // churny volume, fading RS, loss of the 50-day average.
  s3_off_highs: (m, p) => m.high_52w != null && m.close != null && m.high_52w > 0 && ((m.high_52w - m.close) / m.high_52w) * 100 >= (p ?? 5),
  s3_high_volume: (m, p) => (m.vol_ratio || 0) >= (p ?? 1.2),
  s3_rs_fading: (m, p) => m.rs_vs_nifty != null && m.rs_vs_nifty <= (p ?? 10),
  s3_below_50dma: (m) => m.close != null && m.ma50 != null && m.close < m.ma50,
  // Stage 4 (declining) — near the 52W low (lower lows), well below a falling
  // 30W MA, under the 50DMA too, negative RS. Volume not used.
  s4_near_low: (m, p) => m.low_52w != null && m.close != null && m.low_52w > 0 && ((m.close - m.low_52w) / m.low_52w) * 100 <= (p ?? 10),
  s4_deep_below_ma: (m, p) => m.close != null && m.ma30w > 0 && ((m.close - m.ma30w) / m.ma30w) * 100 <= -(p ?? 10),
  s4_below_50dma: (m) => m.close != null && m.ma50 != null && m.close < m.ma50,
  s4_rs_negative: (m) => (m.rs_vs_nifty ?? 0) < 0,
}

function critPass(crit, m, paramVal) {
  if (crit.col) return m[crit.col] === true
  const fn = CLIENT_TESTS[crit.id]
  return fn ? fn(m, paramVal) : true
}

const tlPct = (m) => (m.ma30w > 0 && m.close != null ? ((m.close - m.ma30w) / m.ma30w) * 100 : null)

// Merge locally-saved screens with any Supabase rows, de-duped by name.
// Remote rows win on conflict (they carry the canonical id); local-only
// screens are appended so nothing saved offline is ever lost.
function mergeScreens(localList, remoteList) {
  const byName = new Map()
  for (const r of remoteList || []) byName.set(r.name, r)
  for (const r of localList || []) if (!byName.has(r.name)) byName.set(r.name, r)
  return [...byName.values()]
}

// Enrich breakout candidates with crossover data from price_data history.
// Sets _weeks_since_cross (weeks since the most recent below→above 30W MA cross)
// and _crossover_vol_ratio (that day's volume ÷ prior ~30-session average). The
// snapshot feed (mv_home_stocks) has no history, so this is the one place the
// Lab reads price_data history — and the only way to catch a crossover BEFORE
// the 30W average itself turns up (which the precomputed breakout_30wma flag
// can't, since it gates on a rising slope).
async function annotateBreakout(candidates, weeks, latestDateIso) {
  for (const m of candidates) { m._weeks_since_cross = null; m._crossover_vol_ratio = null }
  const ids = candidates.map((c) => c.id).filter(Boolean)
  if (!ids.length) return
  // Fetch enough history to find a cross up to `weeks` back, plus ~30 sessions
  // before it for the volume average. Date cutoff caps the row count.
  const cutoff = new Date(latestDateIso || Date.now())
  cutoff.setDate(cutoff.getDate() - (Math.max(weeks, 8) * 7 + 70))
  const cutoffIso = cutoff.toISOString().slice(0, 10)
  // Chunk small: PostgREST caps a request at 1000 rows, and each company has
  // ~85 daily rows in the window — so keep companies-per-request × ~100 well
  // under 1000, or recent rows get truncated and crosses vanish.
  const byCompany = {}
  for (let i = 0; i < ids.length; i += 8) {
    const chunk = ids.slice(i, i + 8)
    const { data } = await supabase
      .from('price_data')
      .select('company_id,date,close,ma30w,volume')
      .in('company_id', chunk)
      .gte('date', cutoffIso)
      .order('company_id', { ascending: true })
      .order('date', { ascending: true })
      .limit(1000)
    for (const r of data || []) (byCompany[r.company_id] ||= []).push(r)
  }
  const latestMs = new Date(latestDateIso || Date.now()).getTime()
  for (const m of candidates) {
    const series = (byCompany[m.id] || []).filter((r) => r.ma30w != null && r.close != null)
    if (series.length < 2) continue
    // Most recent below→above 30W MA cross.
    let crossIdx = -1
    for (let i = series.length - 1; i >= 1; i--) {
      if (series[i].close > series[i].ma30w && series[i - 1].close <= series[i - 1].ma30w) { crossIdx = i; break }
    }
    if (crossIdx === -1) continue
    const crossMs = new Date(series[crossIdx].date).getTime()
    m._weeks_since_cross = Math.max(0, Math.round((latestMs - crossMs) / (7 * 864e5)))
    const prior = series.slice(Math.max(0, crossIdx - 30), crossIdx).map((r) => Number(r.volume)).filter((v) => v > 0)
    const avg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0
    const cv = Number(series[crossIdx].volume)
    m._crossover_vol_ratio = avg > 0 && cv > 0 ? cv / avg : null
  }
}

// ── Talk to The Lab — natural-language → filter-JSON ──────────────────
// BYO-key feature. The user types a sentence; Gemini translates it
// into a JSON object whose keys map to existing Lab criteria; the Lab
// applies them and runs the screen.
//
// PRIVACY: the askGemini call goes directly browser → Google with the
// user's own key. PineX servers never see the user's question, the
// model's answer, or the key. No usage event is logged for the NL
// translation itself.
const NL_TRANSLATOR_PROMPT =
`You are a filter translator for a stock screener. Convert the user's natural language request into a JSON filter object.

Available filter fields:
{
  "sector": string or null,
  "phase": "Basing"|"Advancing"|"Topping"|"Declining"|null,
  "min_criteria_score": 0-5 or null,
  "stage2_new_this_week": boolean|null,
  "delivery_above_avg": boolean|null,
  "rs_positive": boolean|null,
  "breakout_52w": boolean|null
}

Return ONLY valid JSON. No explanation. No markdown. Just the JSON object.`

// Strip the markdown fence Gemini sometimes wraps JSON in even when
// told not to, then JSON.parse. Returns null on any failure — the
// caller renders an "I couldn't understand that" message in that case.
function parseFilterJson(raw) {
  if (!raw || typeof raw !== 'string') return null
  let cleaned = raw.trim()
  // Strip ```json ... ``` or ``` ... ``` wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  // Some responses prefix "json" or a colon — strip a leading word.
  cleaned = cleaned.replace(/^\s*json\s*:?\s*/i, '')
  try {
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

// Phase string → template id. Defaults to stage-2 (Advancing) when the
// model didn't pick a phase — most "show me stocks doing X" queries
// implicitly mean stocks in an uptrend.
function pickTemplateForFilter(filter) {
  const phase = String(filter?.phase || '').toLowerCase()
  if (phase === 'basing')    return 'stage-1'
  if (phase === 'advancing') return 'stage-2'
  if (phase === 'topping')   return 'stage-3'
  if (phase === 'declining') return 'stage-4'
  // min_criteria_score asks for "stocks meeting >= N of 5 SwingX
  // criteria" — the SwingX template is the right surface.
  if (filter?.min_criteria_score != null) return 'swingx'
  // Fallback: Stage 2 (advancing) is the most common implicit phase.
  return 'stage-2'
}

// Build a critState dict from the chosen template + Gemini's JSON.
// We only toggle criteria the spec's JSON keys map to; everything else
// keeps its template default. Best-effort — a key with no matching
// criterion silently no-ops rather than erroring.
function buildCritStateFromFilter(templateObj, filter) {
  const cs = {}
  for (const c of templateObj.criteria) {
    cs[c.id] = { on: c.base ? true : !!c.defaultOn, param: c.param?.value }
  }
  if (!filter) return cs

  const enable = (idMatchFn) => {
    for (const c of templateObj.criteria) {
      if (idMatchFn(c.id)) cs[c.id] = { ...cs[c.id], on: true }
    }
  }

  // rs_positive — Stage templates use 'swingx_rs_positive', the
  // trend-convergence template uses 'rs_positive'. Match either.
  if (filter.rs_positive === true) {
    enable((id) => id === 'rs_positive' || id === 'swingx_rs_positive')
  }
  // delivery_above_avg — delivery criterion was retired from the
  // SwingX gates per the existing code comment; no-op gracefully.
  if (filter.delivery_above_avg === true) {
    enable((id) => /delivery/i.test(id))
  }
  // breakout_52w — Stage templates don't have a 52W criterion; the
  // Stage 3 template uses 's3_off_highs' (distance from 52W high)
  // which is the OPPOSITE signal. No direct toggle — best-effort
  // no-op; the JSON field is preserved for display in the badge so
  // the user can see what Gemini understood.
  if (filter.breakout_52w === true) {
    enable((id) => /breakout_52w|52w/i.test(id))
  }
  if (filter.stage2_new_this_week === true) {
    enable((id) => /stage2_new|new_this_week/i.test(id))
  }
  return cs
}

// ── Lab — single-page filter screen ─────────────────────────────
// The old 3-view flow (landing → parameters → results) came off
// per the rework spec. The page is now a two-column screener:
//
//   Desktop ≥ 880 px
//     Left sidebar (280 px)  — every filter, always visible
//     Right main area        — count + chips + sort + result rows
//
//   Mobile < 880 px
//     Sidebar collapses to the top, results follow below.
//
// Every filter change applies instantly (no Run button, no submit).
// Defaults on first paint: Stage 2 / All substages / Any RS /
// Any volume / ALL 2,125 stocks / All sectors.
//
// Data: mv_home_stocks (latest snapshot row per company), filtered
// client-side. No edge-function changes, no schema changes.

const STAGE_TABS = [
  { key: 'all', label: 'All',     match: () => true },
  { key: '1',   label: 'Stage 1', match: (m) => normaliseStage(m.stage) === 1 },
  { key: '2',   label: 'Stage 2', match: (m) => normaliseStage(m.stage) === 2 },
  { key: '3',   label: 'Stage 3', match: (m) => normaliseStage(m.stage) === 3 },
  { key: '4',   label: 'Stage 4', match: (m) => normaliseStage(m.stage) === 4 },
]

const SUBSTAGE_OPTS = [
  { key: 'all', label: 'All', match: () => true },
  ...['2A-','2A','2A+','2B-','2B','2B+','1A','3A','4A'].map((s) => ({
    key: s, label: s,
    match: (m) => String(m.weinstein_substage || '').trim() === s,
  })),
]

const RS_OPTS = [
  { key: 'any',      label: 'Any',      match: () => true },
  { key: 'positive', label: 'Positive', match: (m) => Number(m.rs_vs_nifty) > 0 },
  { key: 'gt50',     label: '> 50',     match: (m) => Number(m.rs_vs_nifty) > 50 },
  { key: 'gt100',    label: '> 100',    match: (m) => Number(m.rs_vs_nifty) > 100 },
]

const VOL_OPTS = [
  { key: 'any',   label: 'Any',    match: () => true },
  { key: 'gt1',   label: '> 1×',   match: (m) => Number(m.vol_ratio) > 1   },
  { key: 'gt1_5', label: '> 1.5×', match: (m) => Number(m.vol_ratio) > 1.5 },
  { key: 'gt2',   label: '> 2×',   match: (m) => Number(m.vol_ratio) > 2   },
]

const UNIVERSE_OPTS = [
  { key: 'all',       label: 'All 2,125 stocks' },
  { key: 'nifty500',  label: 'Nifty 500 only' },
  { key: 'nifty200',  label: 'Nifty 200 only' },
  { key: 'nifty50',   label: 'Nifty 50 only'  },
]

const SORT_OPTS = [
  { key: 'rs',    label: 'RS vs Nifty', get: (m) => Number(m.rs_vs_nifty)  },
  { key: 'vol',   label: 'Volume',      get: (m) => Number(m.vol_ratio)    },
  { key: 'tl',    label: '% from 30W',  get: (m) => tlPct(m)               },
  { key: 'name',  label: 'Name',        get: (m) => m.name || m.symbol, str: true },
]

const DEFAULT_FILTERS = {
  stage:    '2',
  substage: 'all',
  rs:       'any',
  vol:      'any',
  universe: 'all',
  sector:   'all',
}

// ── Lab state persistence (sessionStorage) ──────────────────────
// Without this, switching tabs / minimising the window unmounted
// the Lab component and the filters reset to DEFAULT_FILTERS on
// return. sessionStorage survives tab visibility changes + same-
// session refreshes; it clears on browser close so a new session
// starts on Stage 2 again.
const LAB_STORAGE_KEY = 'pinex_lab_state'

function readLabSession() {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(LAB_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeLabSession(obj) {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(LAB_STORAGE_KEY, JSON.stringify(obj)) }
  catch { /* private mode / quota — silently skip */ }
}

const DISPLAY_CAP = 60

// Normalise 'Stage 2' / 'stage2' / '2' to an int for matching.
function normaliseStage(s) {
  if (s == null) return null
  const m = String(s).toLowerCase().replace(/\s+/g, '').match(/(\d)/)
  return m ? Number(m[1]) : null
}

function applyFilters(rows, f, nifty500, nifty200, nifty50) {
  const uSet =
    f.universe === 'nifty50'  ? nifty50  :
    f.universe === 'nifty200' ? nifty200 :
    f.universe === 'nifty500' ? nifty500 :
    null
  const stageRule    = STAGE_TABS.find((x) => x.key === f.stage)?.match    ?? (() => true)
  const substageRule = SUBSTAGE_OPTS.find((x) => x.key === f.substage)?.match ?? (() => true)
  const rsRule       = RS_OPTS.find((x) => x.key === f.rs)?.match          ?? (() => true)
  const volRule      = VOL_OPTS.find((x) => x.key === f.vol)?.match        ?? (() => true)
  const sectorRule   = f.sector === 'all'
    ? () => true
    : (m) => (m.sector || '') === f.sector
  return rows.filter((m) => {
    if (uSet && !uSet.has(m.id)) return false
    if (!stageRule(m))    return false
    if (!substageRule(m)) return false
    if (!rsRule(m))       return false
    if (!volRule(m))      return false
    if (!sectorRule(m))   return false
    return true
  })
}

// matchMedia hook — flips the two-column layout at 880 px.
function useMinWidth(px) {
  const get = () => typeof window !== 'undefined'
    && window.matchMedia(`(min-width: ${px}px)`).matches
  const [v, setV] = useState(get)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(min-width: ${px}px)`)
    const fn = (e) => setV(e.matches)
    mql.addEventListener?.('change', fn)
    return () => mql.removeEventListener?.('change', fn)
  }, [px])
  return v
}

export default function Lab() {
  const navigate  = useNavigate()
  // isPro is the single source of truth for Pro feature gates — it
  // returns true for paid 'pro' AND for 'pro_trial' inside the 14-day
  // window. Checking profile.plan === 'pro' here would lock out
  // active trial users from Save (and was the original BUG 2 cause).
  const { user, profile, isPro } = useAuth()
  const isDesktop = useMinWidth(880)
  // ProGateModal teaser — fires once per browser session per user for
  // Free accounts. Lab hosts both Pro Screener templates and the
  // SwingX shortlist, so one gate site covers both features in
  // Robin's spec. The modal is dismissible; the page underneath
  // continues to render so the user isn't blocked.
  const proGateModal = useProGate('lab', 'Pro Screener & SwingX')
  // Below 768 px the result table can't comfortably fit four
  // columns; we drop CMP and % from 30W, leaving Symbol + RS only.
  // The Sort-by strip and active-filter chips switch to horizontal
  // scroll at the same breakpoint.
  const isNarrow  = !useMinWidth(768)

  // Hydrate filters from sessionStorage if a prior tick wrote them
  // this browser session — see BUG 3 fix above. Fall back to
  // DEFAULT_FILTERS on first visit / cleared session / parse error.
  const [filters, setFilters] = useState(() => {
    const saved = readLabSession()
    return (saved && saved.filters) ? { ...DEFAULT_FILTERS, ...saved.filters } : DEFAULT_FILTERS
  })
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }))

  // ── SwingX active-positions view (BUG 1) ──────────────────────
  // When ON, the result list is overridden with rows from
  // swingx_entries (active positions table) instead of the filtered
  // mv_home_stocks universe. Read-only on swingx_entries — never
  // writes. Self-hydrates from sessionStorage so the toggle survives
  // a tab switch alongside the filter state.
  const [swingxView, setSwingxView] = useState(() => {
    const saved = readLabSession()
    return Boolean(saved && saved.swingxView)
  })
  const [swingxSymbols, setSwingxSymbols] = useState(null)  // Set | null
  const [swingxStatus, setSwingxStatus] = useState('idle')   // 'idle' | 'loading' | 'ready' | 'error'

  // Fetch swingx_entries on toggle-on. Cached for the rest of the
  // session — the active list only changes daily, so refetching on
  // every toggle would be wasteful and add a network round-trip
  // between clicks.
  useEffect(() => {
    if (!swingxView) return
    if (swingxStatus === 'ready' || swingxStatus === 'loading') return
    let cancelled = false
    setSwingxStatus('loading')
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('swingx_entries')
          .select('symbol, entry_price, entry_substage, warning_level, trading_date')
          .eq('is_active', true)
          .order('trading_date', { ascending: false })
        if (cancelled) return
        if (error) throw error
        const rows = data || []
        const symbols = new Set(rows.map((r) => String(r.symbol || '').toUpperCase()))
        setSwingxSymbols(symbols)
        setSwingxStatus('ready')
      } catch (e) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[Lab] swingx_entries fetch failed:', e?.message || e)
        setSwingxStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [swingxView, swingxStatus])

  // ── Save-screen modal (BUG 2) ─────────────────────────────────
  // Single inline modal — name input + Save / Cancel. Opens after
  // the Pro check passes; if the user is Free, we show a one-liner
  // in the status row and bail. The previous save-to-localStorage
  // behaviour is gone (it was the cause of the "shows Pro badge but
  // does nothing" report — there was no actual save signal beyond
  // a 2-second toast).
  const [saveModal, setSaveModal] = useState({ open: false, name: '', saving: false })

  const [universe, setUniverse] = useState({
    rows: [], nifty500: new Set(), nifty200: new Set(), nifty50: new Set(),
    tradingDate: null, status: 'loading', error: null,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [pageA, pageB, pageC, n500, n200, n50] = await Promise.all([
          supabase.from('mv_home_stocks').select('*').order('symbol').range(0,    999),
          supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999),
          supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999),
          supabase.from('nifty_500').select('company_id'),
          supabase.from('nifty_200').select('company_id'),
          supabase.from('nifty_50').select('company_id'),
        ])
        if (cancelled) return
        const rows = [...(pageA.data ?? []), ...(pageB.data ?? []), ...(pageC.data ?? [])]
        const seen = new Set()
        const uniq = []
        for (const r of rows) {
          if (!r?.id || seen.has(r.id)) continue
          seen.add(r.id); uniq.push(r)
        }
        const toSet = (res) => new Set((res?.data ?? []).map((r) => r.company_id).filter(Boolean))
        const td = uniq.reduce((acc, r) => {
          const d = r?.snapshot_date || r?.date
          if (!d) return acc
          return acc == null || d > acc ? d : acc
        }, null)

        // ── swing_conditions merge ────────────────────────────────────
        // Pulls the latest-date condition flags per company so the row
        // render can display the criteria chip line below each result.
        // Three-page fetch matches the universe pagination strategy and
        // defeats PostgREST's max-rows cap. We dedupe by company_id
        // keeping the most recent date in case adjacent days are
        // returned across pages.
        //
        // Failure is silent: if swing_conditions is unreachable (RLS,
        // 500), rows simply render without the chip line — same UI as
        // before this addition. No throw, no setUniverse error.
        try {
          const [scA, scB, scC] = await Promise.all([
            supabase.from('swing_conditions').select('company_id,date,condition_stage2,condition_rsi_healthy,condition_delivery_above_avg,condition_volume_contracting,condition_near_ma50').order('date', { ascending: false }).range(0, 999),
            supabase.from('swing_conditions').select('company_id,date,condition_stage2,condition_rsi_healthy,condition_delivery_above_avg,condition_volume_contracting,condition_near_ma50').order('date', { ascending: false }).range(1000, 1999),
            supabase.from('swing_conditions').select('company_id,date,condition_stage2,condition_rsi_healthy,condition_delivery_above_avg,condition_volume_contracting,condition_near_ma50').order('date', { ascending: false }).range(2000, 2999),
          ])
          const condRows = [...(scA.data ?? []), ...(scB.data ?? []), ...(scC.data ?? [])]
          const condByCo = new Map()
          for (const r of condRows) {
            if (!r?.company_id) continue
            const prev = condByCo.get(r.company_id)
            if (!prev || (r.date && r.date > prev.date)) condByCo.set(r.company_id, r)
          }
          for (const u of uniq) {
            const c = condByCo.get(u.id)
            if (!c) continue
            u._cond_stage2              = c.condition_stage2 === true
            u._cond_rsi_healthy         = c.condition_rsi_healthy === true
            u._cond_delivery_above_avg  = c.condition_delivery_above_avg === true
            u._cond_volume_contracting  = c.condition_volume_contracting === true
            u._cond_near_ma50           = c.condition_near_ma50 === true
            u._has_swing_row            = true
          }
        } catch { /* silent — rows render without chips */ }

        setUniverse({
          rows: uniq,
          nifty500: toSet(n500), nifty200: toSet(n200), nifty50: toSet(n50),
          tradingDate: td,
          status: 'ready', error: null,
        })
      } catch (err) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('Lab: universe load failed:', err)
        setUniverse((u) => ({ ...u, status: 'error', error: err?.message || 'fetch failed' }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  const [sortKey, setSortKey] = useState('rs')
  const [sortDir, setSortDir] = useState('desc')
  const clickSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  // Mobile-only — bottom-sheet pattern. Filter view (false) is the
  // default; flipping to true slides the results panel up over the
  // filter panel. Desktop ignores this flag entirely.
  const [showResults, setShowResults] = useState(false)

  const sectorOptions = useMemo(() => {
    const set = new Set()
    for (const m of universe.rows) if (m.sector) set.add(m.sector)
    return ['all', ...[...set].sort()]
  }, [universe.rows])

  const filteredRows = useMemo(() => {
    if (universe.status !== 'ready') return []

    // SwingX view (BUG 1) — when toggled on, ignore the screener
    // filters and instead show only universe rows whose symbol is in
    // the active swingx_entries set. Each surviving row gets a
    // `_swingx_active` flag the row renderer keys off to show the
    // SwingX badge. Sort still applies so the user can re-order by
    // RS / volume / etc.
    let matched
    if (swingxView) {
      if (swingxStatus !== 'ready' || !swingxSymbols) {
        // Still loading the active list. Render empty for now —
        // the swingx-status note in the header tells the user
        // what's happening.
        return []
      }
      matched = universe.rows
        .filter((m) => swingxSymbols.has(String(m.symbol || '').toUpperCase()))
        .map((m) => ({ ...m, _swingx_active: true }))
    } else {
      matched = applyFilters(
        universe.rows, filters,
        universe.nifty500, universe.nifty200, universe.nifty50
      )
    }

    const opt = SORT_OPTS.find((o) => o.key === sortKey) || SORT_OPTS[0]
    return [...matched].sort((a, b) => {
      const va = opt.get(a), vb = opt.get(b)
      const na = va == null || (typeof va === 'number' && Number.isNaN(va))
      const nb = vb == null || (typeof vb === 'number' && Number.isNaN(vb))
      if (na && nb) return 0
      if (na) return 1
      if (nb) return -1
      const cmp = opt.str ? String(va).localeCompare(String(vb)) : (va - vb)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [universe, filters, sortKey, sortDir, swingxView, swingxStatus, swingxSymbols])

  // Persist Lab state across tab switches / refreshes (BUG 3).
  // sessionStorage clears on browser close so the user doesn't get
  // stuck on a stale filter set across sessions. Debounce isn't
  // worth it — filter changes are user-driven, not stream-driven,
  // so we never get more than one write per click.
  useEffect(() => {
    writeLabSession({ filters, sortKey, sortDir, swingxView })
  }, [filters, sortKey, sortDir, swingxView])

  const activeChips = useMemo(() => {
    const chips = []
    if (filters.stage !== 'all') {
      chips.push({ key: 'stage', label: STAGE_TABS.find((o) => o.key === filters.stage)?.label ?? `Stage ${filters.stage}`, clear: 'all' })
    }
    if (filters.substage !== 'all') chips.push({ key: 'substage', label: `Substage ${filters.substage}`, clear: 'all' })
    if (filters.rs !== 'any')       chips.push({ key: 'rs',       label: `RS ${RS_OPTS.find((o) => o.key === filters.rs)?.label}`, clear: 'any' })
    if (filters.vol !== 'any')      chips.push({ key: 'vol',      label: `Vol ${VOL_OPTS.find((o) => o.key === filters.vol)?.label}`, clear: 'any' })
    if (filters.universe !== 'all') chips.push({ key: 'universe', label: UNIVERSE_OPTS.find((o) => o.key === filters.universe)?.label, clear: 'all' })
    if (filters.sector !== 'all')   chips.push({ key: 'sector',   label: filters.sector, clear: 'all' })
    return chips
  }, [filters])

  const clearAll = () => setFilters(DEFAULT_FILTERS)

  const [savedMsg, setSavedMsg] = useState('')

  // saveCondition — BUG 2 fix.
  //
  // Old behaviour wrote to localStorage and flashed a 2-second
  // toast. The Pro badge on the button suggested a real save, but
  // nothing landed in the DB and there was no way to retrieve the
  // saved screens later. New behaviour:
  //
  //   1. Free users -> set an inline status line and bail. Doesn't
  //      reuse the useProGate modal because that's once-per-session
  //      whereas Save is a per-click action.
  //   2. Pro users -> open the inline name modal. On confirm,
  //      INSERT into saved_screens with the full filter snapshot.
  //
  // The saved_screens table schema lives in
  // scripts/sql/create_saved_screens.sql.
  const saveCondition = () => {
    if (!isPro) {
      setSavedMsg('Pro feature — earn 1,000 points or upgrade in /rewards')
      setTimeout(() => setSavedMsg(''), 4000)
      return
    }
    // Suggest a default name from the most prominent filter so the
    // user doesn't always start from blank.
    const suggested = swingxView
      ? 'SwingX positions'
      : (filters.stage !== 'all'
          ? `Stage ${filters.stage}${filters.sector !== 'all' ? ` — ${filters.sector}` : ''}`
          : 'Custom screen')
    setSaveModal({ open: true, name: suggested, saving: false })
  }

  const handleSaveConfirm = async () => {
    const name = String(saveModal.name || '').trim()
    if (!name) return
    if (!user?.id) {
      setSavedMsg('Sign in to save a screen.')
      setSaveModal({ open: false, name: '', saving: false })
      setTimeout(() => setSavedMsg(''), 3000)
      return
    }
    setSaveModal((s) => ({ ...s, saving: true }))
    try {
      const snapshot = { filters, sortKey, sortDir, swingxView }
      const { error } = await supabase
        .from('saved_screens')
        .insert({ user_id: user.id, name, filters: snapshot })
      if (error) throw error
      setSavedMsg('✓ Screen saved')
      setSaveModal({ open: false, name: '', saving: false })
    } catch (e) {
      // Most likely cause: saved_screens table not yet created in
      // this Supabase project. Surface a clear message rather than
      // silently failing again.
      const msg = String(e?.message || e)
      if (/relation .*saved_screens.* does not exist/i.test(msg)) {
        setSavedMsg('Save failed — saved_screens table missing. Apply scripts/sql/create_saved_screens.sql')
      } else {
        setSavedMsg('Save failed — ' + msg.slice(0, 120))
      }
      setSaveModal((s) => ({ ...s, saving: false }))
    }
    setTimeout(() => setSavedMsg(''), 4500)
  }

  const handleSaveCancel = () => {
    setSaveModal({ open: false, name: '', saving: false })
  }

  const stageLabel  = STAGE_TABS.find((o) => o.key === filters.stage)?.label ?? 'All'
  const sectorLabel = filters.sector === 'all' ? 'All sectors' : filters.sector
  const summary     = `${filteredRows.length.toLocaleString('en-IN')} stocks · ${stageLabel} · ${sectorLabel}`

  // Bundle the result-pane props once so both desktop and mobile
  // can hand the same set to ResultsBody — keeps the two branches
  // honest about staying in sync.
  const resultsProps = {
    universe, summary,
    activeChips, setFilter, clearAll,
    savedMsg, saveCondition,
    filteredRows, sortKey, sortDir, clickSort, navigate,
    swingxView, setSwingxView, swingxStatus,
  }

  return (
    <Shell title="Lab" maxWidth={1280}>
      {proGateModal}
      {saveModal.open && (
        <SaveScreenModal
          name={saveModal.name}
          saving={saveModal.saving}
          onNameChange={(n) => setSaveModal((s) => ({ ...s, name: n }))}
          onSave={handleSaveConfirm}
          onCancel={handleSaveCancel}
        />
      )}
      <SwingXEducationalBanner />
      {isDesktop ? (
        // ── Desktop — sticky two-column shell ─────────────────────
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          // Pin the shell to viewport height (less the ~64 px app
          // header) so each column scrolls independently.
          height: 'calc(100vh - 64px)',
          overflow: 'hidden',
          alignItems: 'flex-start',
        }}>
          <aside style={{
            // Sticky sidebar: fixed 260 px column with its own
            // overflowY so filters stay visible while results scroll.
            width: 260, minWidth: 260,
            height: '100%', overflowY: 'auto',
            borderRight: `1px solid ${C.border}`,
            padding: '24px 16px',
            flexShrink: 0,
          }}>
            <FilterPanel
              filters={filters}
              setFilter={setFilter}
              sectorOptions={sectorOptions}
            />
          </aside>
          <main style={{
            flex: 1, minWidth: 0,
            height: '100%', overflowY: 'auto',
            padding: '24px 32px',
          }}>
            <ResultsBody isDesktop isNarrow={false} {...resultsProps} />
          </main>
        </div>
      ) : (
        // ── Mobile — bottom-sheet style panel slide ───────────────
        // Two position-fixed panels swap places via transform
        // translateY. A bottom bar (sitting 64 px above the mobile
        // BottomNav) shows the live match count plus a "View
        // Results" CTA while the filter view is up; in the results
        // view a sticky top bar offers "← Edit filters" instead.
        // No page scrolling, no scrollIntoView — pure transform.
        <>
          {/* Filter panel */}
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            height: 'calc(100vh - 120px)', width: '100%',
            maxWidth: '100vw',
            background: C.base, overflowY: 'auto', overflowX: 'hidden',
            padding: 16,
            transform: showResults ? 'translateY(-100%)' : 'translateY(0)',
            transition: 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)',
            zIndex: 50, willChange: 'transform',
          }}>
            <FilterPanel
              filters={filters}
              setFilter={setFilter}
              sectorOptions={sectorOptions}
            />
          </div>

          {/* Results panel */}
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0,
            height: 'calc(100vh - 120px)', width: '100%',
            maxWidth: '100vw',
            background: C.base, overflowY: 'auto', overflowX: 'hidden',
            transform: showResults ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)',
            zIndex: 51, willChange: 'transform',
          }}>
            {/* Sticky top bar — back to filters + condition summary */}
            <div style={{
              position: 'sticky', top: 0,
              background: C.base, zIndex: 5,
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 16px',
              borderBottom: `1px solid ${C.border}`,
            }}>
              <button type="button"
                onClick={() => setShowResults(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: C.amber, fontSize: 13, fontWeight: 600,
                  padding: 0, flexShrink: 0,
                }}>
                ← Edit filters
              </button>
              <span style={{
                fontSize: 12, color: C.textMuted,
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', flex: 1, minWidth: 0,
              }}>
                {summary}
              </span>
            </div>
            <div style={{ padding: 16, maxWidth: '100vw', overflowX: 'hidden' }}>
              <ResultsBody isDesktop={false} isNarrow={isNarrow} {...resultsProps} />
            </div>
          </div>

          {/* Bottom bar — live count + View Results CTA. Sits 64 px
              above the BottomNav. Slides down off-screen while in
              results view so it doesn't compete with the top bar's
              back affordance. */}
          <div style={{
            position: 'fixed',
            bottom: 64, left: 0, right: 0,
            height: 56,
            background: C.surface,
            borderTop: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0 16px',
            zIndex: 52,
            transform: showResults ? 'translateY(120%)' : 'translateY(0)',
            transition: 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>
              {universe.status === 'ready'
                ? `${filteredRows.length.toLocaleString('en-IN')} stocks match`
                : 'Loading…'}
            </span>
            <button type="button"
              onClick={() => setShowResults(true)}
              disabled={universe.status !== 'ready' || filteredRows.length === 0}
              style={{
                background: '#92400E', color: '#fff',
                fontSize: 13, fontWeight: 600,
                padding: '8px 16px', border: 'none',
                cursor: universe.status !== 'ready' || filteredRows.length === 0 ? 'default' : 'pointer',
                borderRadius: 4,
                opacity: universe.status !== 'ready' || filteredRows.length === 0 ? 0.5 : 1,
              }}>
              View Results →
            </button>
          </div>
        </>
      )}
      <LabResultsBottomNote />
    </Shell>
  )
}

// Shared right-pane content — result count header, active-filter
// chips, sort buttons, the stock table, and the disclaimer
// footer. Used by both the desktop sticky main and the mobile
// results panel. On desktop the inner header sticks to the top
// of the scrollable panel; on mobile it renders as a normal
// block (the mobile results panel has its own sticky top bar
// with the back arrow + condition summary).
function ResultsBody({
  universe, summary, isDesktop, isNarrow,
  activeChips, setFilter, clearAll,
  savedMsg, saveCondition,
  filteredRows, sortKey, sortDir, clickSort, navigate,
  swingxView, setSwingxView, swingxStatus,
}) {
  // Below 768 px the row collapses to 2 columns (Symbol/Name + RS).
  // Above 768 px (including the desktop sticky pane) all four columns
  // render.
  const gridCols = isNarrow ? '1fr 60px' : '1fr 76px 78px 52px'
  return (
    <>
      {universe.status === 'error' && (
        <div role="alert" style={{
          padding: '12px 14px',
          border: `1px solid ${C.redBorder}`,
          background: C.redBg, color: C.red,
          fontSize: 13, marginBottom: 16,
        }}>
          Could not load the universe — {universe.error || 'try again later'}.
        </div>
      )}

      <div style={{
        position: isDesktop ? 'sticky' : 'static',
        top: 0, background: C.base, zIndex: 10,
        paddingBottom: 16,
        borderBottom: isDesktop ? `1px solid ${C.border}` : 'none',
      }}>
        <h1 style={{
          margin: 0, fontSize: 22, fontWeight: 700, color: C.text,
          letterSpacing: '-0.01em', lineHeight: 1.2,
        }}>
          {universe.status === 'loading' ? 'Loading…' : summary}
        </h1>
        {universe.tradingDate && (
          <p style={{ margin: '4px 0 0', fontSize: 11, color: C.textMuted }}>
            EOD · {universe.tradingDate}
          </p>
        )}

        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          gap: 8, marginTop: 12,
        }}>
          {activeChips.map((c) => (
            <Chip key={c.key} label={c.label}
              onClear={() => setFilter(c.key, c.clear)} />
          ))}
          {activeChips.length >= 2 && (
            <button type="button" onClick={clearAll}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.blue, fontSize: 12, padding: 0,
              }}>
              Clear all
            </button>
          )}
          <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {/* BUG 1 — SwingX view toggle.
                Reads from swingx_entries (active positions table).
                When ON, the result list is replaced with rows whose
                symbol is in the active swingx set. Auto-runs on click
                — no separate "Run" button. */}
            <button
              type="button"
              onClick={() => setSwingxView && setSwingxView(!swingxView)}
              aria-pressed={!!swingxView}
              title={swingxView ? 'Showing active SwingX positions. Click to return to filtered universe.' : 'Show active SwingX positions only.'}
              style={{
                padding: '6px 12px',
                border: `1px solid ${swingxView ? '#FBBF24' : C.border}`,
                background: swingxView ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                color: swingxView ? '#FBBF24' : C.textPrimary,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                borderRadius: 4,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}>
              ⚡ SwingX
              {swingxView && swingxStatus === 'loading' && (
                <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4 }}>loading…</span>
              )}
              {swingxView && swingxStatus === 'error' && (
                <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 4, color: C.red }}>err</span>
              )}
            </button>
            <button type="button" onClick={saveCondition}
              style={{
                padding: '6px 12px',
                border: `1px solid ${C.amberBorder}`,
                background: C.amberBg, color: C.amber,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
                borderRadius: 4,
                display: 'inline-flex', alignItems: 'center',
              }}>
              Save this condition <ProBadge />
            </button>
            {filteredRows.length > 0 && (
              <ExportMenu
                label="Export" align="left"
                filename="PineX_screen"
                title="PineX Lab"
                getRows={() => filteredRows.map((m) => {
                  const tl = tlPct(m)
                  return {
                    Symbol: m.symbol,
                    Company: m.name || m.symbol,
                    Sector: m.sector || '',
                    'CMP (Rs)': m.close ?? '',
                    '% vs 30W Trend Line': tl == null ? '' : tl.toFixed(1),
                    'RS vs Nifty (%)': m.rs_vs_nifty ?? '',
                    'Volume Ratio': m.vol_ratio ?? '',
                  }
                })}
              />
            )}
          </div>
        </div>
        {savedMsg && (
          <p style={{
            margin: '6px 0 0', fontSize: 12, fontWeight: 600,
            color: savedMsg.startsWith('✓') ? C.green : C.red,
          }}>
            {savedMsg}
          </p>
        )}

        <div style={{
          display: 'flex',
          // On narrow viewports the four sort buttons exceed the
          // row width; switch to a horizontal scroll instead of
          // wrapping (keeps the Sort-by strip one line tall).
          flexWrap: isNarrow ? 'nowrap' : 'wrap',
          overflowX: isNarrow ? 'auto' : 'visible',
          whiteSpace: isNarrow ? 'nowrap' : 'normal',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
          alignItems: 'center',
          gap: 6, marginTop: 14,
        }}>
          <span style={{ fontSize: 11, letterSpacing: '0.05em',
            textTransform: 'uppercase', color: C.textMuted, fontWeight: 700,
            flexShrink: 0,
          }}>
            Sort by
          </span>
          {SORT_OPTS.map((o) => {
            const active = sortKey === o.key
            const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''
            return (
              <button key={o.key} type="button" onClick={() => clickSort(o.key)}
                style={{
                  padding: '5px 10px',
                  border: `1px solid ${active ? C.amberBorder : C.border}`,
                  background: active ? C.amberBg : 'transparent',
                  color: active ? C.amber : C.textMuted,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  borderRadius: 4,
                  flexShrink: 0,
                }}>
                {o.label}{arrow}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: gridCols,
          gap: 8, padding: '8px 4px',
          borderBottom: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span>{isNarrow ? 'Symbol' : 'Ticker'}</span>
          {!isNarrow && <span style={{ textAlign: 'right' }}>CMP</span>}
          {!isNarrow && <span style={{ textAlign: 'right' }} title="Percent distance from the 30-week trend line.">% from 30W</span>}
          <span style={{ textAlign: 'right' }} title="Relative strength vs Nifty over the trailing window.">RS</span>
        </div>
        {/* Hide the column glossary on narrow viewports — its three
            terms reference the CMP / % from 30W columns we've just
            dropped. Without them the line would read confusingly. */}
        {!isNarrow && (
          <div style={{ padding: '6px 4px 8px', fontSize: 10, color: C.textFaint, lineHeight: 1.5 }}>
            <span><strong style={{ color: C.textMuted }}>CMP</strong> current market price</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span><strong style={{ color: C.textMuted }}>% from 30W</strong> price vs 30-week trend line</span>
            <span style={{ margin: '0 8px' }}>·</span>
            <span><strong style={{ color: C.textMuted }}>RS</strong> relative strength vs Nifty</span>
          </div>
        )}

        {filteredRows.slice(0, DISPLAY_CAP).map((m) => {
          const tl = tlPct(m)
          return (
            <div key={m.id || m.symbol}
              onClick={() => navigate('/stock/' + m.symbol)}
              style={{
                display: 'grid',
                gridTemplateColumns: gridCols,
                gap: 8, padding: '9px 4px',
                borderBottom: `1px solid ${C.border}`,
                cursor: 'pointer', alignItems: 'center',
              }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {m.symbol}
                  {m._swingx_active && (
                    <span
                      title="Active SwingX position"
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        color: '#FBBF24',
                        background: 'rgba(251, 191, 36, 0.12)',
                        border: '1px solid rgba(251, 191, 36, 0.35)',
                        padding: '1px 5px',
                        borderRadius: 3,
                      }}
                    >
                      ⚡ SwingX
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.name || m.sector}
                </div>
                {m.swingx_days != null && (
                  <div style={{ fontSize: 9, color: C.textFaint, marginTop: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    ⏱ SwingX {m.swingx_days}d
                  </div>
                )}
              </div>
              {!isNarrow && (
                <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                  {m.close == null ? '—' : '₹' + Number(m.close).toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                </span>
              )}
              {!isNarrow && (
                <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600,
                  color: tl == null ? C.textMuted : tl > 0 ? C.green : C.red }}>
                  {tl == null ? '—' : (tl > 0 ? '+' : '') + tl.toFixed(0) + '%'}
                </span>
              )}
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600,
                color: m.rs_vs_nifty == null ? C.textMuted : m.rs_vs_nifty > 0 ? C.green : C.red }}>
                {m.rs_vs_nifty == null ? '—' : (m.rs_vs_nifty > 0 ? '+' : '') + Number(m.rs_vs_nifty).toFixed(0)}
              </span>
              {/* Criteria chip line — built from swing_conditions booleans
                  merged onto each universe row in the load effect. Shows
                  ONLY the true conditions, plain comma-separated text per
                  spec. gridColumn: 1 / -1 spans the full row width so the
                  existing grid layout above is untouched. */}
              {(() => {
                if (!m._has_swing_row) return null
                const chips = []
                if (m._cond_stage2)             chips.push('Above trend')
                if (m._cond_rsi_healthy)        chips.push('Momentum healthy')
                if (m._cond_delivery_above_avg) chips.push('Delivery confirmed')
                if (m._cond_volume_contracting) chips.push('Volume aligned')
                if (m._cond_near_ma50)          chips.push('Near support')
                if (chips.length === 0) return null
                return (
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      fontSize: 11,
                      color: C.textMuted,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {chips.join(' · ')}
                  </div>
                )
              })()}
            </div>
          )
        })}

        {universe.status === 'ready' && filteredRows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No stocks match this condition. Loosen a filter to see more.
          </div>
        )}
        {filteredRows.length > DISPLAY_CAP && (
          <div style={{ padding: '12px 0', textAlign: 'center', color: C.textFaint, fontSize: 11 }}>
            Showing first {DISPLAY_CAP} of {filteredRows.length} · sort or narrow by sector
          </div>
        )}
      </div>

      <p style={{
        padding: '16px 0',
        fontSize: 11, color: C.textMuted, lineHeight: 1.6, fontStyle: 'italic',
      }}>
        These stocks match the filter values you set. EOD data · Not investment advice.
      </p>
    </>
  )
}

// ── Sidebar filter panel ──────────────────────────────────────
function FilterPanel({ filters, setFilter, sectorOptions }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <FilterGroup label="Condition">
        <SubLabel>
          <Tooltip text="Stock is in an uptrend above its 30-week moving average with volume and relative strength confirming.">
            Stage
          </Tooltip>
        </SubLabel>
        <Tabs options={STAGE_TABS}
          value={filters.stage}
          onChange={(v) => setFilter('stage', v)} />
        <div style={{ height: 10 }} />
        <SubLabel>Substage</SubLabel>
        <Tabs options={SUBSTAGE_OPTS}
          value={filters.substage}
          onChange={(v) => setFilter('substage', v)} />
      </FilterGroup>

      <FilterGroup label="Strength">
        <SubLabel>
          <Tooltip text="How this stock has performed relative to Nifty 500. Positive = outperforming the index.">
            RS vs Nifty
          </Tooltip>
        </SubLabel>
        <Tabs options={RS_OPTS}
          value={filters.rs}
          onChange={(v) => setFilter('rs', v)} />
      </FilterGroup>

      <FilterGroup label="Volume">
        <SubLabel>
          <Tooltip text="Today's volume compared to the 30-day average. Above 1.5× means unusually high activity.">
            Vol ratio
          </Tooltip>
        </SubLabel>
        <Tabs options={VOL_OPTS}
          value={filters.vol}
          onChange={(v) => setFilter('vol', v)} />
      </FilterGroup>

      <FilterGroup label="Universe">
        <RadioList options={UNIVERSE_OPTS}
          value={filters.universe}
          onChange={(v) => setFilter('universe', v)} />
      </FilterGroup>

      <FilterGroup label="Sector">
        <select value={filters.sector}
          onChange={(e) => setFilter('sector', e.target.value)}
          style={{
            width: '100%', padding: '6px 10px',
            background: C.surface2, color: C.text,
            border: `1px solid ${C.border}`,
            fontSize: 13, borderRadius: 4,
          }}>
          {sectorOptions.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All sectors' : s}</option>
          ))}
        </select>
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ label, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: C.textMuted,
        marginBottom: 10,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function SubLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>
      {children}
    </div>
  )
}

function Tabs({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            style={{
              padding: '4px 10px',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${active ? C.amberBorder : C.border}`,
              background: active ? C.amberBg : 'transparent',
              color: active ? C.amber : C.textMuted,
              borderRadius: 4,
            }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function RadioList({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {options.map((o) => {
        const active = o.key === value
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            style={{
              textAlign: 'left',
              padding: '6px 10px',
              fontSize: 13, cursor: 'pointer',
              border: `1px solid ${active ? C.amberBorder : C.border}`,
              background: active ? C.amberBg : 'transparent',
              color: active ? C.amber : C.text,
              borderRadius: 4,
              fontWeight: active ? 600 : 500,
            }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Chip({ label, onClear }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 4px 4px 10px',
      border: `1px solid ${C.border}`,
      background: C.surface2,
      fontSize: 11, color: C.text,
      borderRadius: 4,
    }}>
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: C.textMuted, fontSize: 14, lineHeight: 1,
          padding: '0 6px', borderRadius: 4,
        }}>
        ×
      </button>
    </span>
  )
}

function Shell({ title, children, maxWidth = 760 }) {
  return (
    <>
      <Helmet><title>{title} | PineX Lab</title></Helmet>
      <div style={{ minHeight: '100vh', background: C.base, color: C.text, width: '100%', maxWidth, margin: '0 auto' }}>{children}</div>
    </>
  )
}

function SectionHead({ children }) {
  return (
    <div style={{ padding: '18px 16px 8px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', display: 'flex', alignItems: 'center' }}>{children}</div>
  )
}

function RadioPill({ label, active, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled}
      style={{ padding: '7px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, border: `1px solid ${active ? C.amberBorder : C.border}`, background: active ? C.amberBg : 'transparent', color: active ? C.amber : C.textMuted }}>
      {label}
    </button>
  )
}

// ── SaveScreenModal ──────────────────────────────────────────────
// Small inline modal — name input + Save / Cancel — opened by the
// Pro-gated saveCondition handler in Lab(). Closes itself on save
// success or cancel. We render it from Lab() so the modal closes
// automatically when the page unmounts.
function SaveScreenModal({ name, saving, onNameChange, onSave, onCancel }) {
  function onKeyDown(e) {
    if (e.key === 'Enter') { e.preventDefault(); onSave() }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Name this screen"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(11, 14, 17, 0.78)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420, width: '100%',
          background: '#0F1217',
          border: '1px solid #1E2530',
          borderRadius: 8,
          padding: '20px 22px',
          color: '#E2E8F0',
        }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#94A3B8',
            fontWeight: 700,
            marginBottom: 8,
          }}
        >
          Name this screen
        </div>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. Stage 2 Pharma high RS"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px',
            background: '#16191F',
            border: '1px solid #2A323D',
            borderRadius: 6,
            color: '#E2E8F0',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '8px 14px',
              border: '1px solid #2A323D',
              background: 'transparent',
              color: '#CBD5E1',
              fontSize: 13, fontWeight: 600,
              borderRadius: 6, cursor: saving ? 'default' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !name.trim()}
            style={{
              padding: '8px 14px',
              border: 'none',
              background: saving || !name.trim() ? '#56473E' : '#FBBF24',
              color: '#0B0E11',
              fontSize: 13, fontWeight: 700,
              borderRadius: 6,
              cursor: saving || !name.trim() ? 'default' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
