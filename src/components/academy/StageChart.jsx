import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Cell,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from 'recharts'

// Generate realistic chart data for a given chart type.
function generateStageData(type) {
  const data = []

  if (type === 'stage_cycle') {
    // Full cycle S1→S2→S3→S4
    const points = [
      // Stage 4 decline (left)
      100, 95, 90, 87, 84, 81, 79, 77,
      // Stage 1 base
      76, 75, 74, 75, 76, 74, 75, 76, 75, 74,
      76, 75, 77, 76, 75, 77,
      // Stage 2 advance
      79, 82, 85, 89, 93, 97, 101, 106,
      111, 116, 120, 124, 127, 130, 133,
      // Stage 3 top
      135, 134, 136, 133, 135, 132,
      134, 130, 132, 128,
      // Stage 4 decline (right)
      124, 118, 112, 106, 100, 94,
    ]
    const maPoints = [
      // Declining MA
      108, 106, 104, 102, 100, 98, 96, 94,
      // Flat MA (Stage 1)
      92, 91, 90, 90, 89, 89, 89, 89, 90,
      90, 90, 91, 91, 92, 92,
      // Rising MA (Stage 2)
      93, 95, 97, 100, 103, 106, 109,
      112, 115, 118, 120, 122, 124,
      125, 126,
      // Flattening (Stage 3)
      127, 127, 128, 127, 127, 126,
      126, 125, 124, 123,
      // Declining MA (Stage 4)
      121, 118, 115, 111, 107, 103,
    ]
    points.forEach((p, i) => {
      const stage =
        i < 8 ? 4 : i < 24 ? 1 : i < 39 ? 2 : i < 49 ? 3 : 4
      data.push({
        i,
        price: p,
        ma: maPoints[i],
        stage,
      })
    })
  } else if (type === 'stage1') {
    for (let i = 0; i < 40; i++) {
      const noise = (Math.random() - 0.5) * 4
      const price = 75 + noise + Math.sin(i * 0.3) * 3
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: 75 + Math.sin(i * 0.05) * 0.5,
        stage: 1,
      })
    }
  } else if (type === 'stage2') {
    for (let i = 0; i < 40; i++) {
      const noise = (Math.random() - 0.5) * 3
      const trend = i * 1.8
      const price = 75 + trend + noise
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: 75 + i * 1.4,
        stage: 2,
      })
    }
  } else if (type === 'stage3') {
    for (let i = 0; i < 40; i++) {
      const noise = (Math.random() - 0.5) * 5
      const price = 145 + noise + Math.sin(i * 0.2) * 8 - i * 0.3
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: 145 + i * 0.1 - Math.max(0, (i - 20) * 0.2),
        stage: 3,
      })
    }
  } else if (type === 'stage4') {
    for (let i = 0; i < 40; i++) {
      const noise = (Math.random() - 0.5) * 3
      const price = 140 - i * 1.5 + noise
      data.push({
        i,
        price: Math.round(Math.max(80, price) * 10) / 10,
        ma: 138 - i * 1.2,
        stage: 4,
      })
    }
  } else if (type === 'volume_bars') {
    // 30 weeks of price + volume — typical Stage 2 pattern
    for (let i = 0; i < 30; i++) {
      const trend = i * 1.2
      const noise = (Math.random() - 0.5) * 3
      const price = 80 + trend + noise
      const prev = i > 0 ? data[i - 1].price : 80
      const isUp = price > prev
      const vol = isUp
        ? 0.8 + Math.random() * 1.4
        : 0.3 + Math.random() * 0.5
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: 80 + i * 1.0,
        volume: Math.round(vol * 100) / 100,
        isUp,
      })
    }
  } else if (type === 'volume_stages') {
    // Volume pattern across all 4 stages
    for (let i = 0; i < 36; i++) {
      let price, ma, vol, stage
      const prev = i > 0 ? data[i - 1].price : 80
      if (i <= 10) {
        // Stage 1 — sideways, low flat volume
        price = 80 + (Math.random() - 0.5) * 2
        ma = 80
        vol = 0.2 + Math.random() * 0.2
        stage = 1
      } else if (i === 11) {
        // Stage 2 breakout spike
        price = 86
        ma = 80.5
        vol = 2.5 + Math.random() * 0.5
        stage = 2
      } else if (i <= 20) {
        // Stage 2 advance
        const trend = (i - 11) * 1.6
        price = 86 + trend + (Math.random() - 0.5) * 2
        ma = 81 + (i - 11) * 0.9
        const wasUp = price > prev
        vol = wasUp ? 0.9 + Math.random() * 0.6 : 0.5 + Math.random() * 0.3
        stage = 2
      } else if (i <= 26) {
        // Stage 3 — chaotic high volume, sideways
        price = 101 + (Math.random() - 0.5) * 6
        ma = 101 - (i - 21) * 0.3
        vol = 1.5 + Math.random() * 1.0
        stage = 3
      } else {
        // Stage 4 — decline, variable volume
        const dec = (i - 27) * 1.5
        price = 99 - dec + (Math.random() - 0.5) * 3
        ma = 99 - dec * 0.7
        vol = 0.5 + Math.random() * 1.5
        stage = 4
      }
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: Math.round(ma * 10) / 10,
        volume: Math.round(vol * 100) / 100,
        isUp: price > prev,
        stage,
      })
    }
  } else if (type === 'ma_explanation') {
    // 40 weeks — noisy raw price vs smooth 30W MA
    let trend = 50
    for (let i = 0; i < 40; i++) {
      trend += 0.85
      const noise = (Math.random() - 0.5) * 5
      const price = trend + Math.sin(i * 0.55) * 4 + noise
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: Math.round(trend * 10) / 10,
      })
    }
  } else if (type === 'price_vs_ma') {
    // Stage 2 with a flatter MA so reference areas align visually
    for (let i = 0; i < 30; i++) {
      const ma = 100
      const noise = (Math.random() - 0.5) * 2
      // Price oscillates within the entry zone (0–10% above MA),
      // occasionally pushing into the extended zone.
      const wave = Math.sin(i * 0.55) * 6 + Math.cos(i * 0.2) * 3
      const price = ma + 5 + wave + noise
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma,
      })
    }
  } else if (type === 'ma_support') {
    // Rising MA with 3 clean pullback-to-MA bounces
    const bouncePoints = [10, 20, 30]
    for (let i = 0; i < 36; i++) {
      const ma = 70 + i * 1.3
      const distFromBounce = bouncePoints.reduce(
        (min, b) => Math.min(min, Math.abs(i - b)),
        99
      )
      let price
      if (distFromBounce === 0) {
        // Kiss the MA
        price = ma + 0.5
      } else {
        // Further from bounce = higher above MA
        const elevation = 3 + distFromBounce * 0.7
        price = ma + elevation + (Math.random() - 0.5) * 1.4
      }
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: Math.round(ma * 10) / 10,
        isBounce: distFromBounce === 0,
      })
    }
  } else if (type === 'rs_line') {
    // 30 weeks: price advances, RS crosses zero around mid-period
    for (let i = 0; i < 30; i++) {
      const trend = i * 1.4
      const price = 80 + trend + (Math.random() - 0.5) * 2
      // RS starts ~-8, crosses 0 around i=10, peaks +22
      const rs = -8 + i * 1.1 + Math.sin(i * 0.35) * 1.5
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: 80 + i * 1.1,
        rs: Math.round(rs * 10) / 10,
        rsPositive: rs >= 0 ? rs : 0,
        rsNegative: rs < 0 ? rs : 0,
      })
    }
  } else if (type === 'daily_50d_bounce') {
    // 60 daily bars with 3 pullback-to-50D bounces
    const bouncePoints = [18, 33, 51]
    for (let i = 0; i < 60; i++) {
      const sma50 = 100 + i * 0.45
      const nearestDelta = bouncePoints.reduce(
        (closest, b) =>
          Math.abs(i - b) < Math.abs(closest) ? i - b : closest,
        99
      )
      const absDelta = Math.abs(nearestDelta)
      let price
      if (absDelta <= 1) {
        price = sma50 + 0.4 + absDelta * 0.5
      } else {
        price = sma50 + 2.2 + absDelta * 0.45 + (Math.random() - 0.5) * 1.4
      }
      data.push({
        i,
        price: Math.round(price * 10) / 10,
        ma: Math.round(sma50 * 10) / 10,
        isBounce: absDelta === 0,
      })
    }
  } else if (type === 'breadth_chart') {
    // 52 weeks of % of stocks above 30W MA
    for (let i = 0; i < 52; i++) {
      let pct
      if (i < 10) {
        // Rising 30 → 65
        pct = 30 + (i / 9) * 35
      } else if (i < 20) {
        // High 60–70
        pct = 65 + Math.sin(i * 0.6) * 5
      } else if (i < 30) {
        // Divergence — breadth falls while index still up
        pct = 65 - (i - 20) * 2.2 + (Math.random() - 0.5) * 2
      } else if (i < 40) {
        // Falling 40 → 25
        pct = 40 - (i - 30) * 1.5 + (Math.random() - 0.5) * 2
      } else {
        // Recovery 25 → 50
        pct = 25 + (i - 40) * 2.2 + (Math.random() - 0.5) * 2
      }
      data.push({
        i,
        pct: Math.round(Math.max(15, Math.min(80, pct)) * 10) / 10,
      })
    }
  }

  return data
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STAGE_COLORS = {
  1: '#60A5FA',
  2: '#00C805',
  3: '#FBBF24',
  4: '#FF3B30',
}

const STAGE_LABELS = {
  stage_cycle: 'The complete stage cycle',
  stage1: 'Stage 1 — base formation',
  stage2: 'Stage 2 — the advance',
  stage3: 'Stage 3 — the top',
  stage4: 'Stage 4 — the decline',
  volume_bars: 'Price and volume',
  volume_stages: 'Volume across the four stages',
  ma_explanation: 'Price vs 30-week moving average',
  ma_states: 'Rising, flat, and falling MA',
  price_vs_ma: 'Entry zone above the 30-week SMA',
  ma_support: 'The 30-week SMA as support',
  rs_line: 'Relative strength vs index',
  daily_50d_bounce: '50-day SMA pullback entries',
  sector_stages: 'Sector Stage 2 distribution',
  breadth_chart: 'Market breadth — % above 30W SMA',
}

const SECTOR_DATA = [
  { sector: 'Defence', s2: 84 },
  { sector: 'Pharma', s2: 71 },
  { sector: 'Capital Goods', s2: 65 },
  { sector: 'Auto', s2: 52 },
  { sector: 'FMCG', s2: 38 },
  { sector: 'IT', s2: 24 },
  { sector: 'Real Estate', s2: 18 },
]

const FADE_IN_KEYFRAME = `@keyframes pinex-chart-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}`

// Per-type legend definition shown in the card header.
function getLegendItems(type, priceColor) {
  switch (type) {
    case 'stage_cycle':
    case 'stage1':
    case 'stage2':
    case 'stage3':
    case 'stage4':
    case 'volume_bars':
    case 'volume_stages':
      return [
        { label: 'Price', color: priceColor, dashed: false },
        { label: '30W MA', color: '#94A3B8', dashed: true },
      ]
    case 'ma_explanation':
      return [
        { label: 'Weekly price', color: '#60A5FA', dashed: false },
        { label: '30-week average', color: '#FBBF24', dashed: false },
      ]
    case 'price_vs_ma':
    case 'ma_support':
      return [
        { label: 'Price', color: '#00C805', dashed: false },
        { label: '30W MA', color: '#94A3B8', dashed: true },
      ]
    case 'rs_line':
      return [
        { label: 'Price', color: '#60A5FA', dashed: false },
        { label: 'RS line', color: '#00C805', dashed: false },
      ]
    case 'daily_50d_bounce':
      return [
        { label: 'Price', color: '#60A5FA', dashed: false },
        { label: '50D SMA', color: '#FBBF24', dashed: true },
      ]
    case 'breadth_chart':
      return [{ label: '% above 30W SMA', color: '#60A5FA', dashed: false }]
    default:
      return null
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function StageChart({ type = 'stage_cycle', height = 200 }) {
  const stageNum =
    type === 'stage1'
      ? 1
      : type === 'stage2'
      ? 2
      : type === 'stage3'
      ? 3
      : type === 'stage4'
      ? 4
      : null

  const priceColor = stageNum ? STAGE_COLORS[stageNum] : '#60A5FA'
  const legendItems = getLegendItems(type, priceColor)

  return (
    <>
      <style>{FADE_IN_KEYFRAME}</style>
      <div
        style={{
          background: 'var(--bg-elevated)',
          borderRadius: 12,
          padding: '16px 8px 8px',
          border: '1px solid var(--border)',
          animation: 'pinex-chart-fade-in 0.5s ease-out',
          opacity: 1,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 12,
            paddingLeft: 8,
            paddingRight: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span>{STAGE_LABELS[type] || type}</span>
          {legendItems && (
            <div style={{ display: 'flex', gap: 12, fontSize: 9, flexShrink: 0 }}>
              {legendItems.map((item) => (
                <span
                  key={item.label}
                  style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <span
                    style={{
                      width: 20,
                      height: 2,
                      background: item.color,
                      display: 'inline-block',
                      borderRadius: 1,
                      borderTop: item.dashed
                        ? `2px dashed ${item.color}`
                        : 'none',
                    }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {renderChartBody(type, height, priceColor)}

        {/* Stage labels for the full cycle chart */}
        {type === 'stage_cycle' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-around',
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
            }}
          >
            {[1, 2, 3, 4].map((s) => (
              <div key={s} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: STAGE_COLORS[s],
                    margin: '0 auto 3px',
                  }}
                />
                <div
                  style={{
                    fontSize: 9,
                    color: STAGE_COLORS[s],
                    fontWeight: 700,
                  }}
                >
                  S{s}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

function renderChartBody(type, height, priceColor) {
  if (type === 'stage_cycle') {
    return <StageCycleChart data={generateStageData(type)} height={height} />
  }
  if (type === 'volume_bars' || type === 'volume_stages') {
    return (
      <VolumeChart
        type={type}
        data={generateStageData(type)}
        height={height}
      />
    )
  }
  if (type === 'ma_states') {
    return <MaStatesChart height={height} />
  }
  if (type === 'sector_stages') {
    return <SectorBarsChart height={height} />
  }
  if (type === 'breadth_chart') {
    return <BreadthChartView data={generateStageData(type)} height={height} />
  }
  if (type === 'rs_line') {
    return <RsLineChart data={generateStageData(type)} height={height} />
  }
  if (type === 'daily_50d_bounce') {
    return <DailyBounceChart data={generateStageData(type)} height={height} />
  }
  if (type === 'price_vs_ma') {
    return <PriceVsMaChart data={generateStageData(type)} height={height} />
  }
  if (type === 'ma_support') {
    return <MaSupportChart data={generateStageData(type)} height={height} />
  }
  if (type === 'ma_explanation') {
    return <MaExplanationChart data={generateStageData(type)} height={height} />
  }
  // Default — stage1, stage2, stage3, stage4
  return (
    <SingleAreaChart
      type={type}
      data={generateStageData(type)}
      height={height}
      priceColor={priceColor}
    />
  )
}

// ─── Existing chart: original single-area pattern for stage1–4 ──────────────

function SingleAreaChart({ type, data, height, priceColor }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad_${type}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={priceColor} stopOpacity={0.2} />
            <stop offset="95%" stopColor={priceColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            return (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 11,
                }}
              >
                <div style={{ color: priceColor }}>
                  Price: ₹{payload[0]?.value}
                </div>
                <div style={{ color: '#94A3B8' }}>
                  MA: ₹{Math.round(payload[1]?.value)}
                </div>
              </div>
            )
          }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke={priceColor}
          strokeWidth={2}
          fill={`url(#grad_${type})`}
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// Stage_cycle — unchanged from original implementation.
function StageCycleChart({ data, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          {[1, 2, 3, 4].map((s) => (
            <linearGradient
              key={s}
              id={`grad_cycle_${s}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="5%" stopColor={STAGE_COLORS[s]} stopOpacity={0.15} />
              <stop offset="95%" stopColor={STAGE_COLORS[s]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide />
        <Area
          type="monotone"
          dataKey="price"
          stroke="#60A5FA"
          strokeWidth={2}
          fill="url(#grad_cycle_2)"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── Two-panel: price (top) + volume bars (bottom) ──────────────────────────

function VolumeChart({ type, data, height }) {
  const topHeight = Math.round(height * 0.6)
  const bottomHeight = Math.max(60, height - topHeight)
  const annotations =
    type === 'volume_stages'
      ? [
          { x: 11, label: 'S2 breakout', color: '#00C805' },
          { x: 21, label: 'S3', color: '#FBBF24' },
          { x: 27, label: 'S4', color: '#FF3B30' },
        ]
      : []

  return (
    <div>
      <ResponsiveContainer width="100%" height={topHeight}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id={`grad_${type}_top`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide domain={['auto', 'auto']} />
          {annotations.map((a) => (
            <ReferenceLine
              key={`top-${a.x}`}
              x={a.x}
              stroke={a.color}
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: a.label,
                position: 'top',
                fontSize: 9,
                fill: a.color,
              }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="price"
            stroke="#60A5FA"
            strokeWidth={2}
            fill={`url(#grad_${type}_top)`}
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
          <Area
            type="monotone"
            dataKey="ma"
            stroke="#94A3B8"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            fill="none"
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ height: 4 }} />

      <ResponsiveContainer width="100%" height={bottomHeight}>
        <BarChart
          data={data}
          margin={{ top: 0, right: 10, left: -20, bottom: 0 }}
        >
          <XAxis dataKey="i" hide />
          <YAxis hide />
          {annotations.map((a) => (
            <ReferenceLine
              key={`bot-${a.x}`}
              x={a.x}
              stroke={a.color}
              strokeDasharray="3 3"
              strokeWidth={1}
            />
          ))}
          <Bar
            dataKey="volume"
            isAnimationActive={true}
            animationDuration={800}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.isUp ? '#00C805' : '#FF3B30'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 9,
          color: 'var(--text-muted)',
          padding: '4px 8px 0',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 10,
              height: 8,
              background: '#00C805',
              borderRadius: 1,
              display: 'inline-block',
            }}
          />
          Up volume
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 10,
              height: 8,
              background: '#FF3B30',
              borderRadius: 1,
              display: 'inline-block',
            }}
          />
          Down volume
        </span>
      </div>
    </div>
  )
}

// ─── 3 mini charts side by side: rising / flat / falling MA ─────────────────
// WHY: ma_states is the only chart type with NO
// branch in generateStageData(). It renders 3
// side-by-side tiles, each driven by its own
// buildMaStateData(slope) call (+0.9 / 0 / -0.9)
// — so the generator is parameterised rather
// than enumerating a single dataset.

function buildMaStateData(slope) {
  const out = []
  for (let i = 0; i < 24; i++) {
    const ma = 100 + i * slope
    let priceOffset
    if (slope > 0) {
      // Price above rising MA
      priceOffset = 6 + Math.sin(i * 0.4) * 2.5
    } else if (slope < 0) {
      // Price below falling MA
      priceOffset = -6 + Math.sin(i * 0.4) * 2.5
    } else {
      // Flat — price wiggles around MA
      priceOffset = Math.sin(i * 0.55) * 4
    }
    out.push({
      i,
      price:
        Math.round((ma + priceOffset + (Math.random() - 0.5) * 1.2) * 10) / 10,
      ma: Math.round(ma * 10) / 10,
    })
  }
  return out
}

function MaStatesChart({ height }) {
  const variants = [
    {
      slope: 0.9,
      color: '#00C805',
      label: 'Rising ✓ Stage 2',
    },
    {
      slope: 0,
      color: '#FBBF24',
      label: 'Flat — Stage 1/3',
    },
    {
      slope: -0.9,
      color: '#FF3B30',
      label: 'Falling ✗ Stage 4',
    },
  ]

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      {variants.map((v) => (
        <div
          key={v.label}
          style={{
            flex: '1 1 31%',
            minWidth: 90,
            background: 'rgba(255,255,255,0.02)',
            borderRadius: 8,
            padding: '6px 4px 4px',
          }}
        >
          <ResponsiveContainer width="100%" height={height - 24}>
            <AreaChart
              data={buildMaStateData(v.slope)}
              margin={{ top: 4, right: 4, left: -28, bottom: 0 }}
            >
              <defs>
                <linearGradient
                  id={`grad_ma_state_${v.slope}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor={v.color} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={v.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="i" hide />
              <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
              <Area
                type="monotone"
                dataKey="price"
                stroke={v.color}
                strokeWidth={1.8}
                fill={`url(#grad_ma_state_${v.slope})`}
                dot={false}
                isAnimationActive={true}
                animationDuration={1000}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="ma"
                stroke="#94A3B8"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                fill="none"
                dot={false}
                isAnimationActive={true}
                animationDuration={1000}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: v.color,
              textAlign: 'center',
              marginTop: 2,
              lineHeight: 1.2,
            }}
          >
            {v.label}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Sector stage 2 distribution — horizontal bars ──────────────────────────

function sectorBarColor(s2) {
  if (s2 >= 60) return '#00C805'
  if (s2 >= 40) return '#FBBF24'
  return '#FF3B30'
}

function SectorBarsChart({ height }) {
  // Scale height with row count to give each bar breathing room.
  const chartHeight = Math.max(height, SECTOR_DATA.length * 28)
  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={SECTOR_DATA}
        layout="vertical"
        margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: '#64748B' }}
          tickLine={false}
          axisLine={false}
          ticks={[0, 25, 50, 75, 100]}
        />
        <YAxis
          type="category"
          dataKey="sector"
          tick={{ fontSize: 10, fill: '#94A3B8' }}
          tickLine={false}
          axisLine={false}
          width={86}
        />
        <ReferenceLine
          x={60}
          stroke="#00C805"
          strokeDasharray="3 3"
          label={{
            value: 'Strong threshold',
            position: 'top',
            fontSize: 9,
            fill: '#00C805',
          }}
        />
        <Bar
          dataKey="s2"
          radius={[0, 4, 4, 0]}
          isAnimationActive={true}
          animationDuration={800}
        >
          {SECTOR_DATA.map((d) => (
            <Cell key={d.sector} fill={sectorBarColor(d.s2)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Market breadth — area chart with zone reference areas ──────────────────

function BreadthChartView({ data, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="grad_breadth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: '#64748B' }}
          tickLine={false}
          axisLine={false}
          width={28}
        />
        <ReferenceArea y1={60} y2={100} fill="#00C805" fillOpacity={0.06} />
        <ReferenceArea y1={40} y2={60} fill="#FBBF24" fillOpacity={0.05} />
        <ReferenceArea y1={0} y2={40} fill="#FF3B30" fillOpacity={0.06} />
        <ReferenceLine
          y={60}
          stroke="#00C805"
          strokeDasharray="3 3"
          label={{
            value: 'Bull threshold 60%',
            position: 'insideTopLeft',
            fontSize: 9,
            fill: '#00C805',
          }}
        />
        <ReferenceLine
          y={40}
          stroke="#FBBF24"
          strokeDasharray="3 3"
          label={{
            value: 'Warning 40%',
            position: 'insideBottomLeft',
            fontSize: 9,
            fill: '#FBBF24',
          }}
        />
        <Area
          type="monotone"
          dataKey="pct"
          stroke="#60A5FA"
          strokeWidth={2}
          fill="url(#grad_breadth)"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── RS line — price on top, RS line below crossing zero ────────────────────

function RsLineChart({ data, height }) {
  const topHeight = Math.round(height * 0.55)
  const bottomHeight = Math.max(70, height - topHeight)

  return (
    <div>
      <ResponsiveContainer width="100%" height={topHeight}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="grad_rs_price" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide />
          <Area
            type="monotone"
            dataKey="price"
            stroke="#60A5FA"
            strokeWidth={2}
            fill="url(#grad_rs_price)"
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
          <Area
            type="monotone"
            dataKey="ma"
            stroke="#94A3B8"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            fill="none"
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ height: 4 }} />

      <ResponsiveContainer width="100%" height={bottomHeight}>
        <AreaChart
          data={data}
          margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="grad_rs_pos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00C805" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#00C805" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad_rs_neg" x1="0" y1="1" x2="0" y2="0">
              <stop offset="5%" stopColor="#FF3B30" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#FF3B30" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="i" hide />
          <YAxis hide />
          <ReferenceLine
            y={0}
            stroke="#94A3B8"
            strokeDasharray="3 3"
            label={{
              value: 'Zero line',
              position: 'right',
              fontSize: 10,
              fill: '#94A3B8',
            }}
          />
          <Area
            type="monotone"
            dataKey="rsPositive"
            stroke="#00C805"
            strokeWidth={2}
            fill="url(#grad_rs_pos)"
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
          <Area
            type="monotone"
            dataKey="rsNegative"
            stroke="#FF3B30"
            strokeWidth={2}
            fill="url(#grad_rs_neg)"
            dot={false}
            isAnimationActive={true}
            animationDuration={1000}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Daily 50D bounce chart ─────────────────────────────────────────────────

function DailyBounceChart({ data, height }) {
  const bounceIdx = data
    .map((d, i) => (d.isBounce ? i : -1))
    .filter((i) => i >= 0)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="grad_daily_price" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={['dataMin - 2', 'dataMax + 3']} />
        {bounceIdx.map((idx) => (
          <ReferenceArea
            key={`bounce-${idx}`}
            x1={Math.max(0, idx - 2)}
            x2={Math.min(data.length - 1, idx + 2)}
            fill="#00C805"
            fillOpacity={0.15}
          />
        ))}
        <Area
          type="monotone"
          dataKey="price"
          stroke="#60A5FA"
          strokeWidth={2}
          fill="url(#grad_daily_price)"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#FBBF24"
          strokeWidth={1.8}
          strokeDasharray="4 2"
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        {bounceIdx.map((idx) => (
          <ReferenceDot
            key={`dot-${idx}`}
            x={idx}
            y={data[idx].price}
            r={4}
            fill="#00C805"
            stroke="#fff"
            strokeWidth={1}
            label={{
              value: 'Entry',
              position: 'top',
              fontSize: 9,
              fill: '#00C805',
            }}
            isFront
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── Price vs MA with entry-zone reference areas ────────────────────────────

function PriceVsMaChart({ data, height }) {
  const maValue = data[0]?.ma ?? 100

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 10, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="grad_price_vs_ma" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00C805" stopOpacity={0.18} />
            <stop offset="95%" stopColor="#00C805" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={[maValue * 0.95, maValue * 1.35]} />
        <ReferenceArea
          y1={maValue * 1.1}
          y2={maValue * 1.3}
          fill="#FBBF24"
          fillOpacity={0.08}
          label={{
            value: 'Extended — wait',
            position: 'insideTop',
            fontSize: 10,
            fill: '#FBBF24',
          }}
        />
        <ReferenceArea
          y1={maValue}
          y2={maValue * 1.1}
          fill="#00C805"
          fillOpacity={0.12}
          label={{
            value: 'Entry zone',
            position: 'insideTop',
            fontSize: 10,
            fill: '#00C805',
          }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke="#00C805"
          strokeWidth={2}
          fill="url(#grad_price_vs_ma)"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ─── MA as support — bounces marked with dots ───────────────────────────────

function MaSupportChart({ data, height }) {
  const bounceIdx = data
    .map((d, i) => (d.isBounce ? i : -1))
    .filter((i) => i >= 0)

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 16, right: 10, left: -20, bottom: 0 }}
      >
        <defs>
          <linearGradient id="grad_ma_support" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00C805" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#00C805" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={['dataMin - 4', 'dataMax + 4']} />
        <Area
          type="monotone"
          dataKey="price"
          stroke="#00C805"
          strokeWidth={2}
          fill="url(#grad_ma_support)"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#94A3B8"
          strokeWidth={1.5}
          strokeDasharray="4 2"
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        {bounceIdx.map((idx) => (
          <ReferenceDot
            key={`bounce-${idx}`}
            x={idx}
            y={data[idx].price}
            r={4}
            fill="#00C805"
            stroke="#fff"
            strokeWidth={1}
            label={{
              value: 'Pullback kiss',
              position: 'top',
              fontSize: 9,
              fill: '#00C805',
            }}
            isFront
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── MA explanation — noisy price vs smooth MA ──────────────────────────────

function MaExplanationChart({ data, height }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart
        data={data}
        margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
      >
        <XAxis dataKey="i" hide />
        <YAxis hide />
        <Area
          type="linear"
          dataKey="price"
          stroke="#60A5FA"
          strokeWidth={1.5}
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
        <Area
          type="monotone"
          dataKey="ma"
          stroke="#FBBF24"
          strokeWidth={2.5}
          fill="none"
          dot={false}
          isAnimationActive={true}
          animationDuration={1000}
          animationEasing="ease-out"
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
