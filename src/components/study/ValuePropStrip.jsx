/**
 * ValuePropStrip — site_content 'home.value_props': [{ title, text, icon_key }].
 * Optional `title` adds an <h2>; without it the strip is a plain list.
 */
import { arr, hasText } from './data.js'
import Icon from './Icon.jsx'

export default function ValuePropStrip({ items, title }) {
  const rows = arr(items).filter((it) => hasText(it?.title) || hasText(it?.text))
  if (!rows.length) return null
  const list = (
    <ul className="st-vp">
      {rows.map((it, i) => (
        <li key={i}>
          <Icon name={it.icon_key} />
          {hasText(it.title) && <p className="st-vp-title">{it.title}</p>}
          {hasText(it.text) && <p className="st-small">{it.text}</p>}
        </li>
      ))}
    </ul>
  )
  if (!hasText(title)) return <div className="st-vp-wrap">{list}</div>
  return (
    <section className="st-section st-vp-wrap" aria-labelledby="st-vp-h">
      <h2 id="st-vp-h">{title}</h2>
      {list}
    </section>
  )
}
