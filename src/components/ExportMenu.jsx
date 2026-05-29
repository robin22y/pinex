// ── ExportMenu ──────────────────────────────────────────────────────────────
// Reusable export dropdown for any screener result surface (the Lab results,
// the Home screener). Exports the CURRENT result set the caller hands us via
// `getRows()` — an array of plain { ColumnHeader: value } objects.
//
// Three formats, all client-side (no server round-trip, no extra data):
//   • Excel (.xlsx)  — SheetJS, dynamically imported so it stays code-split.
//   • Google Sheets  — UTF-8 CSV download (opens cleanly in Sheets / Excel).
//   • PDF            — a styled print window (no jsPDF dependency).
//
// Positioned as a PRO feature (amber badge) but UNGATED — the badge is a
// visual signal only, matching the OPEN_FREE posture everywhere else.
// Every export carries the same factual-data disclaimer so nothing leaving
// the app can be mistaken for advice or a research report.

import { useEffect, useRef, useState } from 'react'
import { C } from '../styles/tokens'
import ProBadge from './ProBadge'

const DISCLAIMER =
  'PineX — factual EOD data export · Not investment advice · Not a research report · Not SEBI registered'

export default function ExportMenu({
  getRows,
  filename = 'PineX_Export',
  title = 'PineX Screener',
  label = 'Export',
  align = 'right',
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc) }
  }, [open])

  const dateStr = new Date().toLocaleDateString('en-IN')
  const stamp = new Date().toISOString().slice(0, 10)

  const resolveRows = () => {
    const rows = typeof getRows === 'function' ? getRows() : getRows
    return Array.isArray(rows) ? rows : []
  }

  // ── Excel (.xlsx) ──────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const rows = resolveRows()
    if (!rows.length) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows, { origin: 'A3' })
    XLSX.utils.sheet_add_aoa(ws, [[`${DISCLAIMER} · Data as of: ${dateStr}`]], { origin: 'A1' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PineX')
    XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`)
    setOpen(false)
  }

  // ── Google Sheets / CSV ──────────────────────────────────────────────────
  const exportCsv = () => {
    const rows = resolveRows()
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const esc = (v) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [
      `${DISCLAIMER} · Data as of: ${dateStr}`,
      headers.join(','),
      ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
    ]
    // Prepend BOM so Excel / Google Sheets read UTF-8 correctly.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filename}_${stamp}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setOpen(false)
  }

  // ── PDF (print window) ─────────────────────────────────────────────────────
  const exportPdf = () => {
    const rows = resolveRows()
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const thead = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>`
    const tbody = rows.map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join('')}</tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — ${esc(stamp)}</title>
      <style>
        body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px;}
        h1{font-size:18px;margin:0 0 4px;}
        .sub{font-size:11px;color:#666;margin:0 0 16px;}
        table{border-collapse:collapse;width:100%;font-size:11px;}
        th,td{border:1px solid #ddd;padding:5px 7px;text-align:left;white-space:nowrap;}
        th{background:#f3f4f6;font-weight:700;}
        tr:nth-child(even) td{background:#fafafa;}
        .footer{margin-top:18px;font-size:10px;color:#888;font-style:italic;}
        @page{margin:14mm;}
      </style></head><body>
      <h1>${esc(title)}</h1>
      <p class="sub">PineX · EOD data · Data as of: ${esc(dateStr)} · ${rows.length} row${rows.length === 1 ? '' : 's'}</p>
      <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
      <p class="footer">${esc(DISCLAIMER)}</p>
      <script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>
      </body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Please allow pop-ups for this site to export as PDF.'); return }
    w.document.open()
    w.document.write(html)
    w.document.close()
    setOpen(false)
  }

  const Option = ({ icon, name, sub, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        padding: '10px 12px', background: 'transparent', border: 'none',
        borderBottom: `1px solid ${C.border}`, cursor: 'pointer', textAlign: 'left',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = C.surface2 }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <i className={`ti ${icon}`} style={{ fontSize: 18, color: C.accent, width: 20, textAlign: 'center' }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text }}>{name}</span>
        <span style={{ display: 'block', fontSize: 10, color: C.textMuted }}>{sub}</span>
      </span>
    </button>
  )

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: 'transparent',
          color: C.textMuted, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.accent }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted }}
      >
        <i className="ti ti-download" style={{ fontSize: 14 }} /> {label}
        <ProBadge />
        <i className="ti ti-chevron-down" style={{ fontSize: 12, opacity: 0.7 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)',
            [align]: 0,
            width: 240, zIndex: 10000,
            background: C.surfaceCard, border: `1px solid ${C.border}`,
            borderRadius: 12, overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ padding: '9px 12px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, background: C.surface2 }}>
            Export results
          </div>
          <Option icon="ti-file-spreadsheet" name="Excel (.xlsx)" sub="Open in Microsoft Excel" onClick={exportExcel} />
          <Option icon="ti-brand-google" name="Google Sheets (.csv)" sub="Import into Google Sheets" onClick={exportCsv} />
          <Option icon="ti-file-type-pdf" name="PDF" sub="Print-ready document" onClick={exportPdf} />
          <div style={{ padding: '8px 12px', fontSize: 9, color: C.textFaint, lineHeight: 1.5, fontStyle: 'italic' }}>
            Factual EOD data · Not advice · Not SEBI registered
          </div>
        </div>
      )}
    </div>
  )
}
