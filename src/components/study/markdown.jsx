/**
 * markdown.jsx — a tiny, safe Markdown subset rendered straight to React
 * elements. No HTML string is ever produced, so raw HTML in the source is
 * shown as literal text (React escapes it) and cannot inject markup.
 *
 * Supported
 *   blocks : paragraphs (blank-line separated), headings (# … ######, all
 *            rendered as h3 so the page keeps h1 → h2 → h3), unordered
 *            lists (-, *, +), ordered lists (1. or 1))
 *   inline : **bold** / __bold__, *italic* / _italic_, [text](url)
 *            (http/https/mailto/#anchor/same-site paths only; anything else
 *            is left as plain text)
 *
 * Not supported (rendered as text): raw HTML, images, tables, code, quotes.
 */
import { safeHref } from './format.js'

// Order matters: link, then bold, then italic.
const INLINE =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/

function renderInline(text, keyPrefix = 'i') {
  const out = []
  let rest = String(text ?? '')
  let i = 0
  while (rest) {
    const m = INLINE.exec(rest)
    if (!m) {
      out.push(rest)
      break
    }
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const key = `${keyPrefix}.${i++}`
    if (m[1] !== undefined) {
      const href = safeHref(m[2])
      out.push(
        href ? (
          <a key={key} href={href} rel={/^https?:/i.test(href) ? 'noopener noreferrer' : undefined}>
            {renderInline(m[1], key)}
          </a>
        ) : (
          m[0]
        ),
      )
    } else if (m[3] !== undefined || m[4] !== undefined) {
      out.push(<strong key={key}>{renderInline(m[3] ?? m[4], key)}</strong>)
    } else {
      out.push(<em key={key}>{renderInline(m[5] ?? m[6], key)}</em>)
    }
    rest = rest.slice(m.index + m[0].length)
  }
  return out
}

const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/
const UL_ITEM = /^\s{0,3}[-*+]\s+(.*)$/
const OL_ITEM = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/

/** Parse to a block list: { type: 'p'|'h3'|'ul'|'ol', text | items }. */
function parseBlocks(md) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let para = null
  let list = null

  const flushPara = () => {
    if (para && para.length) blocks.push({ type: 'p', text: para.join(' ') })
    para = null
  }
  const flushList = () => {
    if (list && list.items.length) blocks.push(list)
    list = null
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      flushPara()
      flushList()
      blocks.push({ type: 'h3', text: h[1] })
      continue
    }
    const ul = UL_ITEM.exec(line)
    const ol = ul ? null : OL_ITEM.exec(line)
    if (ul || ol) {
      flushPara()
      const type = ul ? 'ul' : 'ol'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [] }
      }
      list.items.push((ul || ol)[1])
      continue
    }
    if (list && /^\s+/.test(raw)) {
      // Indented continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }
    flushList()
    if (!para) para = []
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks
}

export function Markdown({ source, keyPrefix = 'md' }) {
  const blocks = parseBlocks(source)
  if (!blocks.length) return null
  return blocks.map((b, i) => {
    const key = `${keyPrefix}-${i}`
    if (b.type === 'h3') return <h3 key={key}>{renderInline(b.text, key)}</h3>
    if (b.type === 'ul' || b.type === 'ol') {
      const List = b.type
      return (
        <List key={key}>
          {b.items.map((it, j) => (
            <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </List>
      )
    }
    return <p key={key}>{renderInline(b.text, key)}</p>
  })
}

/**
 * Plain multi-line text (not Markdown): blank lines split paragraphs.
 * Used for then/now/next, founder bios, risk bodies, etc.
 */
export function Paras({ text, className }) {
  if (typeof text !== 'string' || !text.trim()) return null
  const parts = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
  return parts.map((p, i) => (
    <p key={i} className={className}>
      {p}
    </p>
  ))
}
