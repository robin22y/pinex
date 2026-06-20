import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

export default function PulseAdvanceDeclineChart({ chartData, lineColor }) {
  return (
    <div style={{ width: '100%', height: 160 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              fontSize: 11,
              color: 'var(--text-primary)',
            }}
            labelStyle={{ color: 'var(--text-muted)' }}
            formatter={(value, name) => [
              value == null ? '—' : Number(value).toLocaleString('en-IN'),
              name === 'ma20' ? '20-day avg' : 'A-D cumulative',
            ]}
          />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="ad_cumulative"
            stroke={lineColor}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            name="A/D Line"
          />
          <Line
            type="monotone"
            dataKey="ma20"
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
            name="20-day avg"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
