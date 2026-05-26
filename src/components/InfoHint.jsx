import { useCallback, useEffect, useRef, useState } from 'react'

const INFO_CONTENT = {
  stage2: {
    title: 'Stage 2 — Confirmed Uptrend',
    body: "Price is above the 30W trend line and the trend line is rising. This is the PineX ideal buying zone — institutions often participate and momentum tends to be positive.",
    color: 'var(--accent)',
  },
  stage1: {
    title: 'Stage 1 — Base Building',
    body: 'Price is consolidating near the 30W Trend Line after a decline. The trend line is flattening. This is the base-building phase — quieter participation before a possible move above key levels.',
    color: 'var(--info)',
  },
  stage3: {
    title: 'Stage 3 — Topping',
    body: 'Price is near or above the 30W Trend Line but the trend line is starting to flatten or turn down. A volume-decline pattern may appear — participation can shift as the trend matures.',
    color: 'var(--warning)',
  },
  stage4: {
    title: 'Stage 4 — Downtrend',
    body: 'Price is below the falling 30W trend line. This is the markdown phase. PineX rule: never buy in Stage 4. Wait for a Stage 1 base to form.',
    color: 'var(--negative)',
  },
  ma30w: {
    title: '30W Trend Line',
    body: "The average closing price over the last 30 weeks (~7 months). PineX uses this as the primary trend indicator. Price above a rising 30W Trend Line = uptrend. Price below a falling 30W Trend Line = downtrend.",
  },
  obv: {
    title: 'OBV — On Balance Volume',
    body: 'On Balance Volume adds volume on up days and subtracts on down days. Rising OBV with rising price confirms participation. Rising OBV with flat price can precede a directional move.',
  },
  rs_vs_nifty: {
    title: 'Relative Strength vs Nifty 50',
    body: 'How much this stock has gained or lost compared to Nifty 50 over the last 52 weeks. Positive = beating the index. Negative = underperforming. Historically, sustained leaders have tended to outperform the index.',
  },
  rs_rating: {
    title: 'RS Rating (1-99)',
    body: "Percentile rank of this stock's relative strength vs Nifty 50. 99 = top performer. 1 = worst performer. Many traders focus on names with RS Rating above 70 when scanning for setups.",
  },
  delivery_pct: {
    title: 'Delivery %',
    body: 'Percentage of traded shares that resulted in actual delivery (not squared off intraday). High delivery = investors buying to hold. Low delivery = mostly intraday traders speculating.',
  },
  delivery_volume: {
    title: 'Delivery Volume',
    body: 'Absolute number of shares delivered. When delivery volume rises while delivery % falls, it can coincide with a move above key levels — more total activity with new participants alongside existing holders.',
  },
  delivery_rising_price_flat: {
    title: 'Rising Delivery + Flat Price',
    body: 'One of the most discussed patterns. Delivery is elevated while price is little changed — sometimes interpreted as quiet institutional participation before a possible move.',
  },
  promoter_pct: {
    title: 'Promoter Holding',
    body: 'Percentage of shares held by company founders and management. High promoter holding (>50%) shows alignment with the business. Declining promoter holding is a watch point.',
  },
  promoter_pledge: {
    title: 'Promoter Pledge %',
    body: 'Shares pledged by promoters as loan collateral. If the stock falls, lenders can sell these shares — causing further price decline. High pledge % is a significant risk factor.',
  },
  fii_pct: {
    title: 'FII Holding',
    body: 'Foreign Institutional Investor shareholding %. Rising FII holding indicates global institutions are adding exposure. FIIs typically do deep research before buying.',
  },
  dii_pct: {
    title: 'DII Holding',
    body: 'Domestic Institutional Investor shareholding % (mutual funds, insurance companies, etc.). Rising DII holding shows Indian institutions are accumulating.',
  },
  revenue_ttm: {
    title: 'Revenue TTM',
    body: 'Total revenue over the Trailing Twelve Months (last 4 quarters added together). A growing revenue trend shows business expansion.',
  },
  pat_ttm: {
    title: 'PAT TTM — Profit After Tax',
    body: 'Net profit over the last 12 months. This is what the company actually earned after paying all expenses and taxes. Consistent PAT growth is the foundation of stock price appreciation.',
  },
  operating_margin: {
    title: 'Operating Margin',
    body: 'Operating profit as a % of revenue. Shows how efficiently the company runs its core business. Higher margins = more pricing power and competitive advantage.',
  },
  eps: {
    title: 'EPS — Earnings Per Share',
    body: 'Net profit divided by total shares. Shows how much each share earned. Growing EPS is one of the strongest drivers of long-term stock price appreciation.',
  },
  revenue_growth_yoy: {
    title: 'Revenue Growth YoY',
    body: 'Year-over-year revenue growth compared to the same quarter last year. Removes seasonal effects. Consistent double-digit YoY growth indicates a strong business.',
  },
  pat_growth_yoy: {
    title: 'PAT Growth YoY',
    body: 'Year-over-year profit growth. More important than revenue growth — shows whether the company is becoming more profitable, not just bigger.',
  },
  swing_stage2: {
    title: 'Stage 2 Active',
    body: 'The stock is in a confirmed uptrend — price is above the rising 30W trend line with OBV confirming. This is the primary condition for swing trading candidates.',
  },
  swing_delivery: {
    title: 'Delivery Above Average',
    body: "Today's delivery percentage is higher than the 30-day average. Shows stronger-than-usual investor conviction — more people buying to hold, not just trade.",
  },
  swing_near_ma20: {
    title: 'Near 20-Day MA',
    body: 'Price is within 3% of the 20-day moving average — a common short-term support level. In a Stage 2 uptrend, pullbacks to the 20-day MA are low-risk entry zones.',
  },
  swing_rsi: {
    title: 'RSI 40-65',
    body: 'RSI between 40-65 is the "healthy momentum" zone. Not overbought (>70) which risks a pullback, not oversold (<30) which suggests weakness. The sweet spot for new entries.',
  },
  swing_volume: {
    title: 'Volume Contracting on Pullback',
    body: 'When price pulls back with decreasing volume, it shows sellers are not aggressive. Softer volume on a pullback can be supportive in an uptrend — the stock may be pausing rather than reversing.',
  },
  market_breadth: {
    title: 'Market Breadth — % Long-Term Trend Zone',
    body: 'Percentage of all tracked stocks trading above their 30W Trend Line. Above 60% = broad participation. Below 40% = many names below trend. Below 30% = stressed breadth.',
  },
  new_52w_highs: {
    title: '52-Week Highs',
    body: 'Number of stocks making new 52-week highs today. In broad uptrends, this number often expands with the index. Contracting highs at index peaks can be a divergence watch signal.',
  },
  new_52w_lows: {
    title: '52-Week Lows',
    body: 'Number of stocks hitting new 52-week lows. Rising lows while the index holds highs is a classic PineX divergence — hidden weakness beneath the surface.',
  },
  divergence: {
    title: 'Market Divergence Watch',
    body: 'When the index is near all-time highs but fewer stocks are participating (fewer new highs, more new lows, Stage 2 count declining), it signals a potential broad market correction ahead.',
  },
  health_score: {
    title: 'Market Health Score',
    body: 'Composite score (0-100) based on Stage 2 breadth, 52W highs vs lows, stocks above MA150, and India VIX. Above 60 = constructive breadth. Below 40 = more defensive conditions.',
  },
  india_vix: {
    title: 'India VIX — Volatility Index',
    body: "India's fear index. Measures expected market volatility over the next 30 days. Below 15 = calm market. 15-20 = moderate uncertainty. Above 25 = high fear — historically good time to buy quality stocks.",
  },
  unusual_accumulation: {
    title: 'Unusual Base Formation',
    body: 'Delivery percentage has been rising while price remains flat or moves slowly. This pattern is sometimes associated with quieter participation before a larger move.',
  },
  breakout_signature: {
    title: 'Above Key Level Signature',
    body: 'Total volume is surging but delivery % is falling — because shorter-horizon participants join alongside existing holders. Absolute delivery volume may still rise. This pattern is sometimes seen before sharp upward moves.',
  },
}

/** Tooltip widths: narrower on small viewports */
function tooltipWidthPx() {
  if (typeof window === 'undefined') return 260
  return window.innerWidth < 400 ? 220 : 260
}

export default function InfoHint({ id, title, body, size = 14, color }) {
  const preset = id && INFO_CONTENT[id] ? INFO_CONTENT[id] : null
  const displayTitle = title ?? preset?.title ?? 'Info'
  const displayBody = body ?? preset?.body ?? ''
  const accentColor = color ?? preset?.color ?? 'var(--info)'

  const [tip, setTip] = useState({ open: false, top: 0, left: 0, panelW: 260 })
  const btnRef = useRef(null)
  const tooltipRef = useRef(null)
  const timerRef = useRef(null)

  const openTip = useCallback(() => {
    window.clearTimeout(timerRef.current)
    const panelW = tooltipWidthPx()
    const rect = btnRef.current?.getBoundingClientRect()
    const margin = 8
    const top = rect ? rect.bottom + 8 : 0
    const left = rect ? Math.max(margin, Math.min(rect.left, window.innerWidth - panelW - margin)) : margin
    setTip({ open: true, top, left, panelW })
  }, [])

  const show = useCallback(() => {
    window.clearTimeout(timerRef.current)
    openTip()
  }, [openTip])

  const hide = useCallback(() => {
    timerRef.current = window.setTimeout(() => setTip((t) => ({ ...t, open: false })), 150)
  }, [])

  const keepVisible = useCallback(() => {
    window.clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    if (!tip.open) return
    const handler = (e) => {
      if (!btnRef.current?.contains(e.target) && !tooltipRef.current?.contains(e.target)) {
        setTip((t) => ({ ...t, open: false }))
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [tip.open])

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current)
  }, [])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setTip((prev) => {
            if (prev.open) {
              window.clearTimeout(timerRef.current)
              return { ...prev, open: false }
            }
            window.clearTimeout(timerRef.current)
            const panelW = tooltipWidthPx()
            const rect = btnRef.current?.getBoundingClientRect()
            const margin = 8
            const top = rect ? rect.bottom + 8 : 0
            const left = rect ? Math.max(margin, Math.min(rect.left, window.innerWidth - panelW - margin)) : margin
            return { open: true, top, left, panelW }
          })
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size + 4,
          height: size + 4,
          borderRadius: '50%',
          border: '1px solid var(--border-hover)',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: size - 3,
          fontWeight: 600,
          lineHeight: 1,
          flexShrink: 0,
          verticalAlign: 'middle',
          marginLeft: 4,
          padding: 0,
          fontFamily: 'inherit',
        }}
        aria-label={`Info: ${displayTitle}`}
      >
        i
      </button>

      {tip.open ? (
        <div
          ref={tooltipRef}
          role="tooltip"
          onMouseEnter={keepVisible}
          onMouseLeave={hide}
          style={{
            position: 'fixed',
            top: tip.top,
            left: tip.left,
            zIndex: 9999,
            width: tip.panelW,
            boxSizing: 'border-box',
            background: 'var(--bg-input)',
            border: `1px solid ${accentColor}44`,
            borderLeft: `3px solid ${accentColor}`,
            borderRadius: 8,
            padding: '12px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: accentColor,
              marginBottom: 6,
              lineHeight: 1.3,
            }}
          >
            {displayTitle}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{displayBody}</div>
        </div>
      ) : null}
    </>
  )
}
