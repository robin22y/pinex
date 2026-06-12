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

import Icon from '../components/ui/Icon'
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
    id: 'trend-convergence', name: 'Trend Convergence', icon: '🔵', badge: null,
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
    id: 'base-formation', name: 'Base Formation', icon: '🟡', badge: null,
    tagline: 'Price stabilising after a decline on quiet volume',
    criteria: [
      { id: 'price_near_tl', name: 'Price near 30W Trend Line', formula: 'abs(Close − MA30W) / MA30W < 0.05', col: null, defaultOn: true, why: 'Price hugging its average is typical of a base.' },
      { id: 'tl_flat', name: 'Trend Line slope flat (Stage 1)', formula: 'MA(30W) slope ≈ 0', col: null, defaultOn: true, why: 'A flat average shows the prior decline has paused.' },
      { id: 'volume_low', name: 'Volume contracting', formula: 'Avg(Vol,3D) < Avg(Vol,30D) × 0.75', col: null, defaultOn: true, why: 'Drying-up volume often precedes a new move.' },
      { id: 'rsi_neutral', name: 'RSI in neutral range', formula: '40 ≤ RSI(14) ≤ 65', col: null, defaultOn: true, why: 'A neutral RSI is neither overbought nor oversold.' },
    ],
  },
  {
    id: 'trend-deterioration', name: 'Trend Deterioration', icon: '🔴', badge: null,
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
    id: 'swingx', name: 'SwingX Template', icon: '⚡', badge: 'PRO',
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
    id: 'breakout-30w', name: 'Recent 30W Breakout', icon: '🚀', badge: 'PRO',
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
    id: 'rs-momentum', name: 'RS Momentum', icon: '📈', badge: 'PRO',
    tagline: 'Outperforming Nifty with expanding volume',
    criteria: [
      { id: 'rs_strong', name: 'RS vs Nifty positive', formula: 'Stock return − Nifty return (119D) > min', col: null, defaultOn: true, adjustable: true, param: { label: 'Min RS %', value: 10, min: 0, max: 100 }, why: 'A higher RS bar isolates clearer outperformers.' },
      { id: 'volume_above_2', name: 'Volume above 30D average', formula: 'Volume ratio > 1.0', col: null, defaultOn: true, why: 'Above-average volume shows participation.' },
    ],
  },
  {
    id: 'stage-1', name: 'Stage 1 · Basing', icon: '🟡', badge: 'PRO',
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
    id: 'stage-2', name: 'Stage 2 · Advancing', icon: '🟢', badge: 'PRO',
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
    id: 'stage-3', name: 'Stage 3 · Topping', icon: '🟠', badge: 'PRO',
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
    id: 'stage-4', name: 'Stage 4 · Declining', icon: '🔴', badge: 'PRO',
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

export default function Lab() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()

  const [view, setView] = useState('landing') // landing | parameters | results
  const [template, setTemplate] = useState(null)
  const [critState, setCritState] = useState({}) // id -> { on, param }
  const [universe, setUniverse] = useState('nifty500')
  const [sortBy, setSortBy] = useState('rs')
  const [loading, setLoading] = useState(false)
  // runError surfaces the actual failure reason from runScreen() so the
  // user sees WHY a screen didn't produce results — not just a silent
  // button revert. Earlier the try/finally in runScreen swallowed every
  // exception (Supabase RLS denial, materialized-view stale, transient
  // network), so "Run My Screen" appeared to do nothing on failure.
  // Cleared automatically on the next successful run.
  const [runError, setRunError] = useState('')
  const [results, setResults] = useState(null)
  const [tradingDate, setTradingDate] = useState(null)
  const [savedScreens, setSavedScreens] = useState([])
  const [resultSector, setResultSector] = useState('all') // post-run sector filter on the results view
  const [resultSortKey, setResultSortKey] = useState('rs') // post-run sort field (never price)
  const [resultSortDir, setResultSortDir] = useState('desc') // 'asc' | 'desc'
  const [phaseAges, setPhaseAges] = useState({}) // company_id -> sessions in current phase
  const phaseAgesRef = useRef({}) // cache so switching sector doesn't re-fetch
  const [savedMsg, setSavedMsg] = useState('') // inline "✓ saved" confirmation
  const universeRef = useRef(null) // cache merged dataset between runs

  // ── Talk to The Lab — natural-language input state ─────────────────
  // hasGeminiKey gates the entire NL block. nlQuery / nlBusy / nlError
  // drive the input + spinner + error message. nlAppliedQuery is set
  // AFTER a successful translation+run; the results view shows
  // "Showing results for: <nlAppliedQuery>" so the user sees what
  // their natural-language request resolved to.
  const [hasGeminiKey, setHasGeminiKey] = useState(() => Boolean(getStoredGeminiKey()))
  const [nlQuery,         setNlQuery]         = useState('')
  const [nlBusy,          setNlBusy]          = useState(false)
  const [nlError,         setNlError]         = useState('')
  const [nlAppliedQuery,  setNlAppliedQuery]  = useState('')

  // Re-check the Gemini key on mount + on cross-tab "storage" event
  // (matches the pattern Home / Account use so the NL block appears
  // / disappears immediately when the user saves or clears a key in
  // another tab).
  useEffect(() => {
    setHasGeminiKey(Boolean(getStoredGeminiKey()))
    function onStorage(e) {
      if (e.key === 'pinex_gemini_key') {
        setHasGeminiKey(Boolean(getStoredGeminiKey()))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const selectTemplate = (t) => {
    setTemplate(t)
    const cs = {}
    for (const c of t.criteria) cs[c.id] = { on: c.base ? true : c.defaultOn, param: c.param?.value }
    setCritState(cs)
    setResults(null)
    setView('parameters')
    // Manual template pick clears any prior natural-language badge so
    // the results view doesn't claim it came from a stale NL query.
    setNlAppliedQuery('')
  }

  // Deep-link: /lab?template=swingx
  useEffect(() => {
    const tid = params.get('template')
    if (tid) {
      const t = TEMPLATES.find((x) => x.id === tid)
      if (t) selectTemplate(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saved screens — LOCAL-FIRST. Read the user's (or guest's) locally-cached
  // screens instantly, then try Supabase as a best-effort mirror. The table may
  // not be deployed; that's fine — localStorage is the source of truth for the
  // UI and a logged-in user's screens still sync up/down when it exists.
  useEffect(() => {
    const uid = user?.id
    const local = readLocal('saved_screens', uid, [])
    setSavedScreens(local)
    if (!uid) return
    supabase.from('user_saved_screens').select('id,name,template_id,criteria_config,sort_by,universe')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(20)
      .then(({ data, error }) => {
        if (error || !data) return
        const merged = mergeScreens(local, data).slice(0, 20)
        writeLocal('saved_screens', uid, merged)
        setSavedScreens(merged)
      })
      .catch(() => {})
  }, [user?.id])

  // Stage-age enrichment (client-side). For the rows currently in view, derive
  // "sessions in current phase" from price_data history via phaseHelpers. Reads
  // are chunked (8 companies × 120d ≈ <1000 rows) to dodge PostgREST's row cap,
  // results are cached per company_id so switching sector doesn't re-fetch, and
  // the map fills in progressively. The Breakout template uses its own
  // weeks-since-cross instead, so we skip the fetch there.
  useEffect(() => {
    if (view !== 'results' || !results || template?.history) return
    const all = results.stocks || []
    const v = resultSector === 'all' ? all : all.filter((m) => (m.sector || '') === resultSector)
    const ids = v.slice(0, 250).map((m) => m.id).filter(Boolean)
    const missing = ids.filter((id) => !(id in phaseAgesRef.current))
    if (!missing.length) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < missing.length && !cancelled; i += 8) {
        const chunk = missing.slice(i, i + 8)
        const grouped = await fetchPhaseHistory(chunk, 120)
        for (const cid of chunk) {
          const g = grouped[cid]
          phaseAgesRef.current[cid] = g ? sessionsInCurrentPhase(g) : null
        }
        if (!cancelled) setPhaseAges({ ...phaseAgesRef.current })
      }
    })()
    return () => { cancelled = true }
  }, [view, results, resultSector, template?.history])

  const loadUniverse = async () => {
    if (universeRef.current) return universeRef.current
    // mv_home_stocks paginated — the base universe with price + indicators.
    // Plus swing_conditions for TODAY merged into each row by company_id.
    // Why both: the SwingX template now matches the backend's stored
    // `conditions_met` definition (calc_swing_conditions.py) instead of
    // recomputing its own client-side criteria. That keeps the Lab list
    // identical to the Telegram broadcast — they're both reading the
    // same swing_conditions truth. Before this, the Lab's swingx
    // template tested Volume 2x / RS positive / Sector breadth / OBV
    // (a momentum signature) while the backend tested Near MA20 / RSI
    // 40-65 / Volume contracting (a base-formation signature) — they
    // shared only "Stage 2" so the two lists rarely overlapped.
    const [mv0, mv1, mv2, swingLatest] = await Promise.all([
      supabase.from('mv_home_stocks').select('*').order('symbol').range(0, 999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(1000, 1999),
      supabase.from('mv_home_stocks').select('*').order('symbol').range(2000, 2999),
      // Latest swing_conditions date — one round-trip to discover it,
      // a second below to fetch every row for that date. We can't
      // hard-code "today" because the daily pipeline runs after
      // market-close UTC and dev sessions on a weekend / pre-pipeline
      // hour would otherwise get an empty join.
      supabase
        .from('swing_conditions')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    const merged = [mv0, mv1, mv2].flatMap((p) => p.data || [])

    // ── Annotate with backend SwingX booleans ──────────────────────
    // Build a company_id → swing_conditions row map for the latest
    // pipeline date. Paginated because there are ~2,100 rows per day
    // and PostgREST caps at 1,000. Empty map = older universe data
    // showing without backend annotations; the swingx template
    // criteria below short-circuit cleanly when conditions are absent.
    const swingDate = swingLatest?.data?.date || null
    const swingMap = new Map()
    if (swingDate) {
      let start = 0
      const page = 1000
      while (true) {
        const { data } = await supabase
          .from('swing_conditions')
          .select('company_id,conditions_met,condition_stage2,condition_near_ma50,condition_rsi_healthy,condition_volume_contracting')
          .eq('date', swingDate)
          .range(start, start + page - 1)
        const batch = data || []
        for (const r of batch) swingMap.set(r.company_id, r)
        if (batch.length < page) break
        start += page
      }
    }
    for (const m of merged) {
      const sc = swingMap.get(m.id)
      // Underscore-prefixed = client-side annotation, not a column
      // from mv_home_stocks. CLIENT_TESTS read these.
      m._conditions_met            = sc?.conditions_met ?? null
      m._cond_stage2               = !!sc?.condition_stage2
      m._cond_near_ma50            = !!sc?.condition_near_ma50
      m._cond_rsi_healthy          = !!sc?.condition_rsi_healthy
      m._cond_volume_contracting   = !!sc?.condition_volume_contracting
      m._has_swing_row             = !!sc
    }

    // Sector breadth (% of sector stocks above their 30W MA) across the full
    // universe — used by the "strong sector" criterion. Annotated per stock.
    const secTot = {}, secUp = {}
    for (const m of merged) {
      if (!m.sector) continue
      secTot[m.sector] = (secTot[m.sector] || 0) + 1
      if (m.close != null && m.ma30w != null && m.close > m.ma30w) secUp[m.sector] = (secUp[m.sector] || 0) + 1
    }
    for (const m of merged) {
      m._sector_breadth = m.sector && secTot[m.sector] ? (secUp[m.sector] || 0) / secTot[m.sector] * 100 : 0
    }

    // Nifty 500 membership (companies.nifty500) for the universe filter.
    const nifty500 = new Set()
    try {
      for (let start = 0; start < 4000; start += 1000) {
        const { data } = await supabase.from('companies').select('id').eq('nifty500', true).range(start, start + 999)
        if (!data?.length) break
        for (const r of data) nifty500.add(r.id)
        if (data.length < 1000) break
      }
    } catch { /* non-fatal — nifty500 filter falls back to all */ }

    // Latest EOD date for the disclaimer line (mv_home_stocks has no date col).
    let td = null
    try {
      const { data } = await supabase.from('price_data').select('date').eq('is_latest', true).order('date', { ascending: false }).limit(1)
      td = data?.[0]?.date || null
    } catch { /* non-fatal */ }
    universeRef.current = { merged, td, nifty500 }
    setTradingDate(td)
    return universeRef.current
  }

  // runScreen now accepts optional override args so the natural-language
  // path (handleNlSubmit) can run a screen against a freshly-picked
  // template + critState WITHOUT waiting for React state to settle.
  // Existing call sites pass nothing → falls back to component state.
  // overrideTemplate / overrideCritState — the natural-language path
  // (handleNlSubmit) calls runScreen(t, cs) with the freshly-picked
  // template and crit state so it can fire WITHOUT waiting for React
  // state to settle. Regular UI callers must invoke as runScreen()
  // (no args). Defensive shape check below catches the event-passed-
  // as-template footgun: onClick={runScreen} would forward the
  // SyntheticEvent as overrideTemplate, which would be truthy and
  // then crash at t.criteria.filter(...). All UI onClicks now wrap
  // in an arrow (`() => runScreen()`), and this guard is the belt.
  const runScreen = async (overrideTemplate, overrideCritState) => {
    const safeOverride =
      overrideTemplate && Array.isArray(overrideTemplate.criteria)
        ? overrideTemplate
        : null
    const t  = safeOverride  || template
    const cs = (overrideCritState && typeof overrideCritState === 'object'
      && !Array.isArray(overrideCritState) && safeOverride)
      ? overrideCritState
      : critState
    if (!t) return
    setLoading(true)
    setRunError('')
    try {
      const { merged, nifty500, td } = await loadUniverse()
      // eslint-disable-next-line no-console
      console.log('[Lab] loadUniverse →', {
        merged: merged?.length || 0,
        nifty500: nifty500?.size || 0,
        td,
      })
      if (!merged || merged.length === 0) {
        throw new Error('Universe load returned 0 rows — mv_home_stocks query came back empty. Check Supabase RLS / network.')
      }
      const active = t.criteria.filter((c) => cs[c.id]?.on)
      // Universe filter — Nifty 500 (free) or full NSE universe.
      const pool = universe === 'nifty500' && nifty500 && nifty500.size
        ? merged.filter((m) => nifty500.has(m.id))
        : merged

      let matched
      if (t.history) {
        // Breakout screen: snapshot pre-filter first (cheap), then enrich the
        // survivors with crossover history and apply the history-based criteria.
        const histIds = new Set(['bx_recent_cross', 'bx_cross_volume'])
        const snapActive = active.filter((c) => !histIds.has(c.id))
        const histActive = active.filter((c) => histIds.has(c.id))
        // Definitional bound for a "recent breakout": currently above the 30W MA
        // and still near it (≤ 35%). Cheap snapshot filter that keeps the history
        // fetch bounded even when every gate is off — not user gating.
        let candidates = pool.filter((m) => {
          if (!(m.close != null && m.ma30w > 0 && m.close > m.ma30w)) return false
          return ((m.close - m.ma30w) / m.ma30w) * 100 <= 35
        })
        candidates = candidates.filter((m) => snapActive.every((c) => critPass(c, m, cs[c.id]?.param)))
        candidates = candidates.slice(0, 500) // bound the history fetch
        if (histActive.length) {
          const weeks = cs['bx_recent_cross']?.param ?? 4
          await annotateBreakout(candidates, weeks, td)
          matched = candidates.filter((m) => histActive.every((c) => critPass(c, m, cs[c.id]?.param)))
        } else {
          matched = candidates
        }
        matched.sort((a, b) => {
          const wa = a._weeks_since_cross ?? 9999, wb = b._weeks_since_cross ?? 9999
          if (wa !== wb) return wa - wb
          return (b._crossover_vol_ratio ?? 0) - (a._crossover_vol_ratio ?? 0)
        })
      } else {
        matched = pool.filter((m) => active.every((c) => critPass(c, m, cs[c.id]?.param)))
        matched.sort((a, b) => {
          if (sortBy === 'tl') return (tlPct(b) ?? -9999) - (tlPct(a) ?? -9999)
          if (sortBy === 'name') return String(a.name || a.symbol).localeCompare(String(b.name || b.symbol))
          return (b.rs_vs_nifty ?? -9999) - (a.rs_vs_nifty ?? -9999)
        })
      }
      setResultSector('all')
      setResultSortKey(sortBy === 'tl' || sortBy === 'name' ? sortBy : 'rs')
      setResultSortDir(sortBy === 'name' ? 'asc' : 'desc')
      phaseAgesRef.current = {}
      setPhaseAges({})
      setResults({ stocks: matched, activeCount: active.length, activeNames: active.map((c) => c.name) })
      setView('results')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[Lab] runScreen failed:', err)
      setRunError(err?.message || 'Could not run the screen. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── handleNlSubmit ─────────────────────────────────────────────────
  // User typed a natural-language description of what they want to
  // screen for. We:
  //   1. Send the query to Gemini with the NL_TRANSLATOR_PROMPT system
  //      instruction. Direct browser → Google with the user's own key.
  //   2. Parse the response as JSON (strip any stray markdown fences).
  //   3. Pick a template based on the JSON's "phase" hint.
  //   4. Build a critState by enabling the criteria that map to the
  //      JSON's boolean fields.
  //   5. Push the chosen template + critState into component state AND
  //      run the screen immediately via runScreen(t, cs) — passing
  //      the overrides so we don't wait for React state to settle.
  //   6. Set nlAppliedQuery so the results view renders the
  //      "Showing results for: <query>" badge.
  // Sector filter (if Gemini returned one) is applied post-run via
  // setResultSector — that's the same hook the per-template results
  // view uses for its sector dropdown.
  const handleNlSubmit = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    const q = String(nlQuery || '').trim()
    if (!q) return
    setNlBusy(true)
    setNlError('')
    try {
      const { text } = await askGemini(
        q,
        { symbol: null, companyName: null, sector: null, narrative: null },
        {
          systemPromptOverride: NL_TRANSLATOR_PROMPT,
          maxOutputTokens: 500,
          temperature: 0.1,
          topP: 0.9,
        },
      )
      const parsed = parseFilterJson(text)
      if (!parsed) {
        setNlError(`Could not understand that. Try: "Pharma stocks in Advancing phase"`)
        return
      }
      const templateId = pickTemplateForFilter(parsed)
      const chosenTemplate = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES.find((t) => t.id === 'stage-2')
      if (!chosenTemplate) {
        setNlError(`Could not understand that. Try: "Pharma stocks in Advancing phase"`)
        return
      }
      const cs = buildCritStateFromFilter(chosenTemplate, parsed)
      setTemplate(chosenTemplate)
      setCritState(cs)
      // Run BEFORE setView so the results view mounts already populated.
      await runScreen(chosenTemplate, cs)
      // Sector filter as post-run hook — same control the results view
      // exposes as a dropdown. Lowercase-insensitive match against the
      // distinct sector strings the results view bucketizes by.
      if (parsed.sector && typeof parsed.sector === 'string') {
        setResultSector(parsed.sector)
      }
      setNlAppliedQuery(q)
    } catch (err) {
      // Network / SAFETY / quota error — surface a friendly message.
      // The askGemini helper throws Errors with user-friendly text for
      // the common cases (invalid key, quota reached, etc.) so we
      // pass that through; everything else collapses to the same
      // "couldn't understand" hint.
      const msg = err?.message || ''
      if (/key is invalid/i.test(msg) || /quota/i.test(msg) || /reach/i.test(msg)) {
        setNlError(msg)
      } else {
        setNlError(`Could not understand that. Try: "Pharma stocks in Advancing phase"`)
      }
    } finally {
      setNlBusy(false)
    }
  }

  const saveScreen = async () => {
    if (!template) return
    const name = window.prompt('Name your screen:', template.name)
    if (!name) return
    const uid = user?.id // undefined → 'guest' bucket; works logged out too
    const record = {
      id: `local-${Date.now()}`,
      name,
      template_id: template.id,
      criteria_config: critState,
      universe,
      sort_by: sortBy,
      created_at: new Date().toISOString(),
    }
    // Local-first: persist immediately (de-duped by name, newest first, capped).
    const existing = readLocal('saved_screens', uid, [])
    const next = [record, ...existing.filter((s) => s.name !== name)].slice(0, 20)
    const ok = writeLocal('saved_screens', uid, next)
    setSavedScreens(next)
    setSavedMsg(ok ? `✓ Saved “${name}” — find it on the Lab home (← Back to templates)` : 'Could not save — your browser is blocking local storage.')
    setTimeout(() => setSavedMsg(''), 5000)
    // Best-effort Supabase mirror for logged-in users — failure is non-fatal,
    // the local copy is already saved.
    if (uid) {
      try {
        await supabase.from('user_saved_screens').upsert({
          user_id: uid, name, template_id: template.id,
          criteria_config: critState, universe, sort_by: sortBy, last_run: new Date().toISOString(),
        })
      } catch { /* local copy already saved */ }
    }
  }

  const activeCount = useMemo(() => (template ? template.criteria.filter((c) => critState[c.id]?.on).length : 0), [template, critState])
  // gateCount excludes base criteria — the base is ALWAYS on and
  // doesn't represent a user choice. The button label uses this so
  // "Run My Screen" doesn't misleadingly say "1 criteria" when the
  // user hasn't actually picked any optional gates yet.
  const gateCount = useMemo(() => (
    template
      ? template.criteria.filter((c) => !c.base && critState[c.id]?.on).length
      : 0
  ), [template, critState])

  // ── LANDING ─────────────────────────────────────────────────────────────
  if (view === 'landing') {
    return (
      <Shell title="PineX Lab" maxWidth={1040}>
        <div style={{ padding: '20px 16px 8px' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.text }}>🔬 PineX Lab</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
            Run your own cycle-analysis screen. All results come from your parameters · EOD data only.
          </p>
        </div>

        {/* ── Talk to The Lab — natural-language screener input ──────
            BYO-key feature. Renders only when the user has saved a
            Gemini key on this device (hasGeminiKey). Submit sends the
            query to Gemini, parses the JSON response, picks a
            template + critState, and runs the screen automatically.
            On success the user lands on the results view with a
            "Showing results for: <query>" badge. */}
        {hasGeminiKey && (
          <div style={{ padding: '12px 16px 0' }}>
            <form
              onSubmit={handleNlSubmit}
              style={{
                background: C.surface,
                border: `1px solid ${C.amberBorder}`,
                borderLeft: `3px solid ${C.amber}`,
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <div style={{
                fontSize: 11, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: C.amber, marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🔬 Talk to The Lab
                <ProBadge />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={nlQuery}
                  onChange={(e) => { setNlQuery(e.target.value); if (nlError) setNlError('') }}
                  placeholder={`IT stocks in Advancing phase with 4+ criteria this week`}
                  disabled={nlBusy}
                  style={{
                    flex: 1, minWidth: 0,
                    padding: '10px 12px',
                    background: 'var(--bg-input)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    color: C.text,
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={nlBusy || !nlQuery.trim()}
                  style={{
                    padding: '10px 18px',
                    background: nlBusy || !nlQuery.trim() ? 'var(--bg-elevated)' : C.amber,
                    color: nlBusy || !nlQuery.trim() ? C.textMuted : '#000',
                    border: 'none', borderRadius: 8,
                    fontSize: 13, fontWeight: 700,
                    cursor: nlBusy || !nlQuery.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {nlBusy ? '…' : '→'}
                </button>
              </div>
              <p style={{
                margin: '8px 0 0', fontSize: 11,
                color: C.textMuted, fontStyle: 'italic', lineHeight: 1.5,
              }}>
                Describe what you're looking for in plain language. Powered by your Gemini key · Not PineX analysis.
              </p>
              {nlError && (
                <p style={{
                  margin: '8px 0 0', fontSize: 12,
                  color: C.amber, lineHeight: 1.5,
                }}>
                  {nlError}
                </p>
              )}
            </form>
          </div>
        )}

        <SectionHead>Templates</SectionHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, padding: '0 16px' }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => selectTemplate(t)}
              style={{ textAlign: 'left', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{t.name}</span>
                {t.badge === 'PRO' && <ProBadge />}
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.5, marginBottom: 8 }}>{t.tagline}</div>
              <div style={{ fontSize: 11, color: C.textFaint }}>{t.criteria.length} criteria · Use template →</div>
            </button>
          ))}
          <button onClick={() => selectTemplate({ id: 'custom', name: 'Build Your Own', icon: '✏️', badge: 'PRO', tagline: 'Pick any combination', criteria: TEMPLATES[0].criteria })}
            style={{ textAlign: 'left', background: 'transparent', border: `1px dashed ${C.border}`, borderRadius: 12, padding: 16, cursor: 'pointer', color: 'inherit' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 18 }}>✏️</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Build Your Own</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 12, color: C.textMuted }}>Choose any combination of criteria</div>
          </button>
        </div>

        {savedScreens.length > 0 && (
          <>
            <SectionHead>Your saved screens <ProBadge /></SectionHead>
            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {savedScreens.map((sv) => (
                <button key={sv.id}
                  onClick={() => { const t = TEMPLATES.find((x) => x.id === sv.template_id) || TEMPLATES[0]; setTemplate(t); setCritState(sv.criteria_config || {}); setSortBy(sv.sort_by || 'rs'); setUniverse(sv.universe || 'all'); setView('parameters') }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', cursor: 'pointer', color: 'inherit' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{sv.name}</span>
                  <span style={{ fontSize: 12, color: C.blue }}>Re-run →</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── PARAMETERS ──────────────────────────────────────────────────────────
  if (view === 'parameters') {
    return (
      <Shell title={template?.name}>
        <div style={{ padding: '12px 16px 0' }}>
          <button onClick={() => setView('landing')} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>← Back to templates</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>{template?.icon}</span>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>{template?.name}</h1>
            {template?.badge === 'PRO' && <ProBadge />}
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: C.textMuted, lineHeight: 1.5 }}>
            These are the mathematical criteria your screen will apply. Review and adjust, then run.
          </p>
        </div>

        <SectionHead>Criteria</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {template?.criteria.map((c) => {
            const on = !!critState[c.id]?.on
            // WHY: A base criterion (the one that defines the screen
            // identity — "In Stage 2" on the Stage 2 template, etc.)
            // is rendered as a pinned/locked header, NOT a toggle.
            // Showing a toggle there confused users into thinking they
            // could turn off the very thing that makes the screen
            // meaningful. The optional gates below are the real
            // choices to make.
            if (c.base) {
              return (
                <div
                  key={c.id}
                  style={{
                    background: C.amberBg,
                    border: `1px solid ${C.amberBorder}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Lock indicator instead of a toggle */}
                    <div
                      title="Always applied — this defines the screen"
                      style={{
                        width: 40, height: 22, borderRadius: 12,
                        flexShrink: 0, display: 'inline-flex',
                        alignItems: 'center', justifyContent: 'center',
                        background: C.amber, color: '#000',
                      }}
                    >
                      <Icon name="pin-filled" style={{ fontSize: 13 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.name}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: C.amber, border: `1px solid ${C.amberBorder}`, background: C.surface, borderRadius: 4, padding: '1px 5px' }}>
                          ALWAYS ON
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.5 }}>
                        This is what the screen does. Add optional gates below to narrow the list.
                      </div>
                    </div>
                    <InfoSheet title={c.name} trigger={<span style={{ color: C.textMuted, fontSize: 13 }}>ℹ️</span>}>
                      <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>The maths:</strong><br /><span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{c.formula}</span></p>
                      <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>Why cycle analysts watch it:</strong><br />{c.why}</p>
                      <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>What it does not mean:</strong><br />{c.notMean || 'This criterion does not predict future price movement. It is a mathematical observation.'}</p>
                      <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>ℹ️ Data only · Not advice</p>
                    </InfoSheet>
                  </div>
                </div>
              )
            }
            // Regular (optional) gate — real toggle.
            return (
              <div key={c.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], on: !on } }))}
                    style={{ width: 40, height: 22, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, position: 'relative', background: on ? C.amber : C.surface2, transition: 'background .15s' }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: '50%', background: on ? '#000' : C.textMuted, transition: 'left .15s' }} />
                  </button>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: on ? C.text : C.textMuted }}>
                    {c.name}
                  </span>
                  <InfoSheet title={c.name} trigger={<span style={{ color: C.textMuted, fontSize: 13 }}>ℹ️</span>}>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>The maths:</strong><br /><span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{c.formula}</span></p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>Why cycle analysts watch it:</strong><br />{c.why}</p>
                    <p style={{ margin: '0 0 10px' }}><strong style={{ color: C.text }}>What it does not mean:</strong><br />{c.notMean || 'This criterion does not predict future price movement. It is a mathematical observation.'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: C.textFaint }}>ℹ️ Data only · Not advice</p>
                  </InfoSheet>
                </div>
                <div style={{ fontSize: 11, color: C.textFaint, marginTop: 6, marginLeft: 50, fontFamily: 'var(--font-mono, monospace)' }}>{c.formula}</div>
                {c.adjustable && c.param && on && (
                  <div style={{ marginLeft: 50, marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: C.textMuted, minWidth: 90 }}>{c.param.label}: <strong style={{ color: C.amber }}>{critState[c.id]?.param}</strong></span>
                    <input type="range" min={c.param.min} max={c.param.max} step={c.param.step || 1} value={critState[c.id]?.param ?? c.param.value}
                      onChange={(e) => setCritState((p) => ({ ...p, [c.id]: { ...p[c.id], param: Number(e.target.value) } }))}
                      style={{ flex: 1, accentColor: C.amber }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <SectionHead>Universe & sort</SectionHead>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={() => setUniverse('nifty500')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'nifty500' ? C.amberBorder : C.border}`, background: universe === 'nifty500' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'nifty500' ? C.amber : C.text }}>{universe === 'nifty500' ? '● ' : '○ '}Nifty 500</div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>500 stocks · Free</div>
            </button>
            <button onClick={() => setUniverse('all')}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${universe === 'all' ? C.amberBorder : C.border}`, background: universe === 'all' ? C.amberBg : C.surface }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: universe === 'all' ? C.amber : C.text, display: 'flex', alignItems: 'center' }}>{universe === 'all' ? '● ' : '○ '}All NSE stocks<ProBadge /></div>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>2100+ stocks · Unlocked</div>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: C.textMuted }}>Sort by</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
              style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
              <option value="rs">RS vs Nifty</option>
              <option value="tl">% from 30W Trend Line</option>
              <option value="name">Name</option>
            </select>
          </div>
        </div>

        <div style={{ padding: '20px 16px 120px' }}>
          {/* Failure banner — only renders when the last runScreen()
              call threw. Shows the real error message (Supabase RLS,
              network, empty universe, etc.) instead of leaving the
              user staring at a Run button that "did nothing". */}
          {runError && (
            <div
              role="alert"
              style={{
                background: 'rgba(239, 68, 68, 0.08)',
                border: `1px solid rgba(239, 68, 68, 0.35)`,
                borderRadius: 10,
                padding: '12px 14px',
                marginBottom: 12,
                color: '#FCA5A5',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Could not run the screen</div>
              <div>{runError}</div>
            </div>
          )}
          <button onClick={() => runScreen()} disabled={loading || activeCount === 0}
            style={{ width: '100%', height: 48, borderRadius: 12, border: 'none', background: activeCount ? C.amber : C.surface2, color: activeCount ? '#000' : C.textMuted, fontSize: 16, fontWeight: 700, cursor: activeCount ? 'pointer' : 'default' }}>
            {loading
              ? 'Running your screen…'
              : gateCount === 0
                ? '▶  Run My Screen'
                : `▶  Run My Screen · ${gateCount} ${gateCount === 1 ? 'gate' : 'gates'}`}
          </button>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: C.textFaint, textAlign: 'center', lineHeight: 1.5 }}>
            {loading
              ? `Checking stocks against your ${activeCount} parameters… EOD data${tradingDate ? ` as of ${tradingDate}` : ''}`
              : 'Results are generated from your parameters · EOD data only · Not investment advice'}
          </p>
        </div>
        <div style={{ height: 24 }} />
      </Shell>
    )
  }

  // ── RESULTS ─────────────────────────────────────────────────────────────
  const rows = results?.stocks || []
  // Post-run sector filter (view only — doesn't change the screen). Lets the
  // user isolate e.g. all Stage-2 pharma without re-running.
  const rowSectors = [...new Set(rows.map((m) => m.sector).filter(Boolean))].sort()
  const filteredRows = resultSector === 'all' ? rows : rows.filter((m) => (m.sector || '') === resultSector)
  // Sort options over the available data — deliberately NOT price (CMP).
  const SORT_OPTS = [
    { key: 'rs', label: 'RS vs Nifty', get: (m) => m.rs_vs_nifty },
    { key: 'tl', label: '% from 30W Trend Line', get: (m) => tlPct(m) },
    { key: 'vol', label: 'Volume ratio', get: (m) => m.vol_ratio },
    { key: 'chg7', label: '1-week change %', get: (m) => m.price_change_7d },
    { key: 'age', label: 'Time in stage', get: (m) => (template?.history ? (m._weeks_since_cross != null ? m._weeks_since_cross * 5 : null) : phaseAges[m.id]) },
    { key: 'name', label: 'Name (A–Z)', get: (m) => m.name || m.symbol, str: true },
  ]
  const sortOpt = SORT_OPTS.find((o) => o.key === resultSortKey) || SORT_OPTS[0]
  const viewRows = [...filteredRows].sort((a, b) => {
    const va = sortOpt.get(a), vb = sortOpt.get(b)
    const na = va == null || (typeof va === 'number' && Number.isNaN(va))
    const nb = vb == null || (typeof vb === 'number' && Number.isNaN(vb))
    if (na && nb) return 0
    if (na) return 1   // missing data always sinks to the bottom
    if (nb) return -1
    const cmp = sortOpt.str ? String(va).localeCompare(String(vb)) : (va - vb)
    return resultSortDir === 'asc' ? cmp : -cmp
  })
  const DISPLAY_CAP = 250
  return (
    <Shell title="Screen results">
      <div style={{ padding: '14px 16px 0' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.text }}>Your screen results</h1>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: C.text }}>
          <strong>{rows.length}</strong> stock{rows.length === 1 ? '' : 's'} matched your <strong>{results?.activeCount}</strong> criteria
          {resultSector !== 'all' && <> · <strong>{viewRows.length}</strong> in {resultSector}</>}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 11, color: C.textMuted }}>EOD · {tradingDate || '—'} · sorted by {sortOpt.label} {resultSortDir === 'asc' ? '↑' : '↓'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0 0' }}>
          {(results?.activeNames || []).map((n) => (
            <span key={n} style={{ fontSize: 10, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 10, padding: '2px 8px' }}>✓ {n}</span>
          ))}
        </div>

        {/* Showing results for: <natural-language query> — only when
            the current screen run came from the "Talk to The Lab"
            input. Cleared when the user navigates back to landing or
            picks a different template manually. */}
        {nlAppliedQuery && (
          <p style={{
            margin: '10px 0 0', fontSize: 12,
            color: C.amber, lineHeight: 1.5,
            fontStyle: 'italic',
          }}>
            🔬 Showing results for: &ldquo;{nlAppliedQuery}&rdquo;
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0', alignItems: 'center' }}>
          <button onClick={() => setView('parameters')} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 13, cursor: 'pointer' }}>← Modify screen</button>
          <button onClick={saveScreen} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.amberBorder}`, background: C.amberBg, color: C.amber, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>Save screen <ProBadge /></button>
          {rows.length > 0 && (
            <ExportMenu
              label="Export"
              align="left"
              filename={`PineX_${(template?.id || 'screen')}`}
              title={`PineX Lab — ${template?.name || 'Screen'}`}
              getRows={() => viewRows.map((m) => {
                const tl = tlPct(m)
                return {
                  'Symbol': m.symbol,
                  'Company': m.name || m.symbol,
                  'Sector': m.sector || '',
                  'CMP (Rs)': m.close ?? '',
                  '% vs 30W Trend Line': tl == null ? '' : tl.toFixed(1),
                  'RS vs Nifty (%)': m.rs_vs_nifty ?? '',
                  'Volume Ratio': m.vol_ratio ?? '',
                  'Criteria met': `${results?.activeCount ?? ''}/${results?.activeCount ?? ''}`,
                }
              })}
            />
          )}
        </div>
        {savedMsg && (
          <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: savedMsg.startsWith('✓') ? C.green : C.red }}>{savedMsg}</p>
        )}
      </div>

      {/* Sort — order the results by any available metric (never price), asc/desc. */}
      {rows.length > 0 && (
        <div style={{ padding: '0 16px 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Sort</span>
          <select value={resultSortKey} onChange={(e) => setResultSortKey(e.target.value)}
            style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, maxWidth: 220 }}>
            {SORT_OPTS.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          <button onClick={() => setResultSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            title={resultSortDir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {resultSortDir === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
        </div>
      )}

      {/* Sector filter — narrow the run results to one sector (e.g. Pharma). */}
      {rows.length > 0 && rowSectors.length > 1 && (
        <div style={{ padding: '0 16px 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.textMuted }}>Sector</span>
          <select value={resultSector} onChange={(e) => setResultSector(e.target.value)}
            style={{ background: C.surface2, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 13, maxWidth: 220 }}>
            <option value="all">All sectors ({rows.length})</option>
            {rowSectors.map((s) => (
              <option key={s} value={s}>{s} ({rows.filter((m) => m.sector === s).length})</option>
            ))}
          </select>
          {resultSector !== 'all' && (
            <button onClick={() => setResultSector('all')} style={{ background: 'none', border: 'none', color: C.blue, fontSize: 12, cursor: 'pointer', padding: 0 }}>clear</button>
          )}
        </div>
      )}

      {/* Results table.
          Column widths grew from 56→78px for the trend-line column so
          the longer label "% from 30W" fits without truncation. The
          cryptic "TL%" abbreviation was confusing — even users who knew
          the 30W Trend Line concept didn't recognise the shorthand. */}
      <div style={{ padding: '0 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 76px 78px 52px', gap: 8, padding: '8px 4px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <span>Ticker</span>
          <span style={{ textAlign: 'right' }}>CMP</span>
          <span style={{ textAlign: 'right' }} title="Percent distance of the current price from the 30-week trend line. Positive = above the line; negative = below.">% from 30W</span>
          <span style={{ textAlign: 'right' }} title="Relative strength vs Nifty over the last ~5 months. Positive = outperforming the index.">RS</span>
        </div>
        {/* One-line legend so the abbreviated columns are
            self-explanatory on first glance. Renders only once, above
            the rows — does not repeat per row. */}
        <div style={{ padding: '6px 4px 8px', fontSize: 10, color: C.textFaint, lineHeight: 1.5 }}>
          <span><strong style={{ color: C.textMuted }}>CMP</strong> current market price</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span><strong style={{ color: C.textMuted }}>% from 30W</strong> price vs 30-week trend line</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span><strong style={{ color: C.textMuted }}>RS</strong> relative strength vs Nifty</span>
        </div>
        {viewRows.slice(0, DISPLAY_CAP).map((m) => {
          const tl = tlPct(m)
          return (
            <div key={m.id || m.symbol} onClick={() => navigate('/stock/' + m.symbol)}
              style={{ display: 'grid', gridTemplateColumns: '1fr 76px 78px 52px', gap: 8, padding: '9px 4px', borderBottom: `1px solid ${C.border}`, cursor: 'pointer', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{m.symbol}</div>
                <div style={{ fontSize: 10, color: C.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || m.sector}</div>
                {(() => {
                  const parts = []
                  if (template?.history && m._weeks_since_cross != null) parts.push(`${m._weeks_since_cross}w since cross`)
                  else { const s = phaseAges[m.id]; if (s != null) parts.push(`${m.stage} · ${formatPhaseAge(s)}`) }
                  if (m.swingx_days != null) parts.push(`SwingX ${m.swingx_days}d`)
                  return parts.length ? <div style={{ fontSize: 9, color: C.textFaint, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⏱ {parts.join(' · ')}</div> : null
                })()}
              </div>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{m.close == null ? '—' : '₹' + Number(m.close).toLocaleString('en-IN', { maximumFractionDigits: 1 })}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: tl == null ? C.textMuted : tl > 0 ? C.green : C.red }}>{tl == null ? '—' : (tl > 0 ? '+' : '') + tl.toFixed(0) + '%'}</span>
              <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: m.rs_vs_nifty == null ? C.textMuted : m.rs_vs_nifty > 0 ? C.green : C.red }}>{m.rs_vs_nifty == null ? '—' : (m.rs_vs_nifty > 0 ? '+' : '') + Number(m.rs_vs_nifty).toFixed(0)}</span>
            </div>
          )
        })}
        {rows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No stocks matched all your criteria. Try loosening a parameter.</div>
        )}
        {rows.length > 0 && viewRows.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>No {resultSector} stocks in this result.</div>
        )}
        {viewRows.length > DISPLAY_CAP && (
          <div style={{ padding: '12px 0', textAlign: 'center', color: C.textFaint, fontSize: 11 }}>
            Showing first {DISPLAY_CAP} of {viewRows.length} · filter by sector to narrow
          </div>
        )}
      </div>

      <p style={{ padding: '16px', fontSize: 11, color: C.textMuted, lineHeight: 1.6, fontStyle: 'italic' }}>
        These stocks match the mathematical criteria you set. What you do with this is entirely your decision.<br />
        ℹ️ Data only · Not advice · Not SEBI registered
      </p>
      <div style={{ height: 24 }} />
    </Shell>
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
