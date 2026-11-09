/** StudyToc — anchors for the sections that actually rendered. Hidden in print. */
export default function StudyToc({ items, title }) {
  if (!Array.isArray(items) || items.length === 0 || !title) return null
  return (
    <nav className="st-toc" aria-labelledby="st-toc-h">
      <h2 id="st-toc-h">{title}</h2>
      <ol>
        {items.map((it) => (
          <li key={it.id}>
            <a href={`#${it.id}`}>{it.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
