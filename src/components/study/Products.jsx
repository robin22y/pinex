/** ProductCard + ProductsList. */
import { Paras } from './markdown.jsx'
import { hasText, sortedRows } from './data.js'
import { Section, SourceRef } from './primitives.jsx'
import MediaFigure from './MediaFigure.jsx'

const FIELDS = [
  ['applications', 'Used for'],
  ['end_markets', 'End markets'],
  ['customers_disclosed', 'Disclosed customers'],
  ['interesting_fact', 'Worth knowing'],
]

export function ProductCard({ product, sourceNumbers }) {
  const p = product || {}
  if (!hasText(p.name)) return null
  return (
    <li className="st-card">
      {hasText(p.category) && <p className="st-label">{p.category}</p>}
      <h3>
        {p.name}
        <SourceRef id={p.source_id} sourceNumbers={sourceNumbers} />
      </h3>
      <MediaFigure media={p.image} sizes="(min-width: 720px) 640px, 100vw" />
      <Paras text={p.description} />
      {FIELDS.some(([k]) => hasText(p[k])) && (
        <dl className="st-dl">
          {FIELDS.filter(([k]) => hasText(p[k])).map(([k, label]) => (
            <div key={k}>
              <dt>{label}</dt>
              <dd>{p[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

export default function ProductsList({ title, products, sourceNumbers }) {
  const rows = sortedRows(products).filter((p) => hasText(p?.name))
  if (!rows.length) return null
  return (
    <Section id="products" title={title}>
      <ul className="st-cards">
        {rows.map((p, i) => (
          <ProductCard key={p.id ?? i} product={p} sourceNumbers={sourceNumbers} />
        ))}
      </ul>
    </Section>
  )
}
