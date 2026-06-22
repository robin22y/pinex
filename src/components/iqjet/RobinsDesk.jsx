// RobinsDesk — Section 3 of /iqjet.
//
// Placeholder until Pillar 3 ships. The `robins_desk` table doesn't
// exist yet. Showing the section frame keeps page layout stable when
// the real data lands.

export default function RobinsDesk() {
  return (
    <section style={sectionStyle}>
      <p style={eyebrow}>Section 3 · Robin’s Desk</p>
      <p style={comingSoon}>
        Coming soon. Robin's tracked observations with original phase,
        current structure status, and neutral reasoning. Deeper reasoning
        will be visible to paid subscribers only; phase context remains
        visible for everyone with IQjet access.
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

