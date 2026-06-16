/**
 * /explore — Pre-built exploration cards.
 *
 * Each card frames a single, neutrally-described market condition
 * and links to Lab with the appropriate template pre-selected.
 * No outcome language ("will go up", "set to rally", etc.) — the
 * names describe what the screen LOOKS AT, never what it might do.
 *
 * The cards funnel users into Lab's existing templates without
 * having to learn the template picker. Once on Lab the user can
 * further narrow with the criteria checklist as usual.
 *
 * No new data layer — every card is a static config + a deep link.
 */
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { C } from '../styles/tokens'

// Each card maps to a Lab template id consumed by Lab's
// useEffect( () => params.get('template') ) reader. The mapping is
// best-effort: Lab only ships 5 templates today (stage-1..4 +
// swingx) so 10 conditions point at the closest fit. The card
// language stays neutral and descriptive — never outcome.
const CARDS = [
  {
    title:    'After big market falls',
    sub:      'Stocks in basing phase following declines',
    template: 'stage-1',
    body:     'Companies sitting in Stage 1 — the basing phase that follows an extended decline. Useful for studying how setups develop while broader downtrend pressure eases.',
  },
  {
    title:    'High volume spikes',
    sub:      'Recent volume well above the 30-day average',
    template: 'swingx',
    body:     'SwingX screen — surfaces stocks where activity has picked up against typical volume. The Volume criterion in the template gates the list.',
  },
  {
    title:    'New Stage 2 entries',
    sub:      'Stocks freshly classified into the advancing phase',
    template: 'stage-2',
    body:     'Stage 2 candidates. Combine with the "New this week" gate inside Lab to narrow to fresh entrants.',
  },
  {
    title:    'Weak rally attempts',
    sub:      'Stocks struggling in the topping phase',
    template: 'stage-3',
    body:     'Stage 3 — the topping phase between an advance and a decline. Inspect distribution patterns, sector context, and momentum gauges.',
  },
  {
    title:    'Crossing above 30W MA',
    sub:      'Recently reclaiming the long-term trend line',
    template: 'stage-2',
    body:     'Stage 2 template surfaces stocks above their 30-week MA. Combine with the "Near MA50" or "RS positive" criteria to narrow to fresh crossings.',
  },
  {
    title:    'Sector strength leaders',
    sub:      'Stocks in the strongest sector breadth cohorts',
    template: 'swingx',
    body:     'SwingX template includes a sector-breadth criterion. Surfaces stocks whose sector is participating broadly in current advances.',
  },
  {
    title:    'Recovery from Stage 4',
    sub:      'Decline phase to basing transition',
    template: 'stage-1',
    body:     'Stage 1 — stocks that have left the declining phase and are forming a base. Useful for studying how the slowdown-then-flatten pattern plays out across sectors.',
  },
  {
    title:    'Range breakout conditions',
    sub:      'Stocks compressing volume into a tight range',
    template: 'swingx',
    body:     'SwingX template focuses on multi-criterion compression. The Volume + RS gates surface stocks where the typical breakout precondition is forming.',
  },
  {
    title:    'High RS stocks',
    sub:      'Strong relative strength versus Nifty',
    template: 'swingx',
    body:     'SwingX includes an RS-positive criterion. Lists stocks outperforming Nifty over the trailing window, regardless of stage.',
  },
  {
    title:    'Low volatility accumulation',
    sub:      'Quiet bases — flat ranges on declining volume',
    template: 'stage-1',
    body:     'Stage 1 — the basing pattern that often forms with falling realized volatility. Pair with the volume-contracting gate inside Lab.',
  },
]

export default function Explore() {
  return (
    <>
      <Helmet>
        <title>Explore · PineX</title>
      </Helmet>

      <div style={{
        maxWidth: 1080,
        margin: '0 auto',
        padding: '24px 16px 64px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {/* Page header — neutral framing. */}
        <header style={{ marginBottom: 28, textAlign: 'center' }}>
          <h1 style={{
            fontSize: 26, fontWeight: 800, color: C.text,
            letterSpacing: '-0.02em', margin: '0 0 8px',
          }}>
            Explore market conditions
          </h1>
          <p style={{
            margin: '0 auto', maxWidth: 560,
            fontSize: 14, color: C.textMuted, lineHeight: 1.55,
          }}>
            Each card opens a Lab screen pre-filtered to the condition
            it describes. Browse setups, study sector context — no
            recommendations, no outcome language.
          </p>
          <div style={{
            marginTop: 12, fontSize: 11, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: C.textHint || C.textMuted,
            fontWeight: 600,
          }}>
            Clarity before decisions.
          </div>
        </header>

        {/* Card grid — 1 col mobile, 2 col tablet, 3 col desktop. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}>
          {CARDS.map((card) => (
            <ExploreCard key={card.title} card={card} />
          ))}
        </div>

        <footer style={{
          marginTop: 36, padding: '14px 16px',
          textAlign: 'center', color: C.textHint || C.textMuted,
          fontSize: 11, fontStyle: 'italic', lineHeight: 1.6,
        }}>
          Historical observations only. Past conditions do not guarantee
          future outcomes. Not investment advice.
        </footer>
      </div>
    </>
  )
}

function ExploreCard({ card }) {
  const href = `/lab?template=${encodeURIComponent(card.template)}`
  return (
    <Link
      to={href}
      style={{
        display: 'block',
        padding: '16px 16px 14px',
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background 160ms ease, border-color 160ms ease, transform 160ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = C.amber || '#F59E0B'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.border
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{
        fontSize: 15, fontWeight: 700,
        color: C.text, marginBottom: 4, lineHeight: 1.25,
      }}>
        {card.title}
      </div>
      <div style={{
        fontSize: 12, color: C.textMuted, lineHeight: 1.45, marginBottom: 12,
      }}>
        {card.sub}
      </div>
      <div style={{
        fontSize: 12, color: C.textMuted, lineHeight: 1.6,
      }}>
        {card.body}
      </div>
      <div style={{
        marginTop: 12, fontSize: 11,
        color: C.amber || '#F59E0B', fontWeight: 600,
        letterSpacing: '0.04em',
      }}>
        Open in Lab →
      </div>
    </Link>
  )
}
