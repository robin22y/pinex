/** ThenNowNext — three short columns; any empty part is skipped. */
import { Paras } from './markdown.jsx'
import { hasText } from './data.js'
import { Section } from './primitives.jsx'

export default function ThenNowNext({ title, then_text, now_text, next_text }) {
  const parts = [
    ['Then', then_text],
    ['Now', now_text],
    ['Next', next_text],
  ].filter(([, t]) => hasText(t))
  if (!parts.length) return null
  return (
    <Section id="then-now-next" title={title}>
      <div className="st-tnn">
        {parts.map(([label, text]) => (
          <div key={label}>
            <h3>{label}</h3>
            <Paras text={text} />
          </div>
        ))}
      </div>
    </Section>
  )
}
