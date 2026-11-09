/** CentralQuestion — the open question the study leaves the reader with. */
import { hasText } from './data.js'
import { Section } from './primitives.jsx'

export default function CentralQuestion({ title, central_question }) {
  if (!hasText(central_question)) return null
  return (
    <Section id="central-question" title={title}>
      <div className="st-question-block">
        <p className="st-question">{central_question}</p>
      </div>
    </Section>
  )
}
