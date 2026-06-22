// EarningsIntelligence — Section 2 of /iqjet.
//
// Placeholder until Pillar 2 ships. The `earnings_intelligence`
// table doesn't exist yet (will be added when transcript upload +
// Gemini analysis on Desktop are wired). Showing the section heading
// + "coming soon" so the page layout matches the final design and
// users know the slot is reserved, not missing.

export default function EarningsIntelligence() {
  return (
    <section style={sectionStyle}>
      <p style={eyebrow}>Section 2 · Earnings Intelligence</p>
      <p style={comingSoon}>
        Coming soon. Tone analysis + confidence scores for SwingX
        stocks with recent earnings calls. Built on Desktop via
        Gemini BYOK once transcript upload ships.
      </p>
    </section>
  )
}

const sectionStyle = {
  background:   'var(--surface, rgba(255,255,255,0.04))',
  border:       '1px solid var(--border, rgba(255,255,255,0.08))',
  borderRadius: '12px',
  padding:      '20px 22px',
}

const eyebrow = {
  margin:        '0 0 8px',
  fontSize:      '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color:         'var(--text-muted, #888)',
}

const comingSoon = {
  margin:   0,
  fontSize: '14px',
  lineHeight: 1.6,
  color:    'var(--text-secondary, #aaa)',
}
