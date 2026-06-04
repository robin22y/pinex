// ── Admin widget: list of users linked to Telegram ─────────────────
// Shows every profile with telegram_chat_id set. Admins use this to
// (a) verify the link flow is working in production and (b) eyeball
// which usernames are subscribed.
//
// Values shown: full_name, email, @telegram_username (where present),
// linked_at relative time. No chat_id surfaced — that's a Telegram
// internal identifier and isn't useful for admin display.

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'

function timeAgo(iso) {
  if (!iso) return '—'
  const dt = new Date(iso)
  const sec = Math.max(1, Math.floor((Date.now() - dt.getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function TelegramSubscribers() {
  const [rows, setRows] = useState(null) // null = loading; [] = none; [...] = present
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Reads via service_role through admin policies. Filtering on
        // not-null telegram_chat_id is what defines "linked".
        const { data, error: e } = await supabase
          .from('profiles')
          .select('id, email, full_name, telegram_username, telegram_chat_id, telegram_linked_at')
          .not('telegram_chat_id', 'is', null)
          .order('telegram_linked_at', { ascending: false })
          .limit(500)
        if (cancelled) return
        if (e) {
          setError(e.message || 'Failed to load')
          setRows([])
          return
        }
        setRows(data || [])
      } catch (e) {
        if (!cancelled) {
          setError(String(e?.message || e))
          setRows([])
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          <i className="ti ti-brand-telegram" style={{ marginRight: 6, color: '#229ED9' }} />
          Telegram subscribers
        </div>
        {rows && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
            padding: '2px 8px', borderRadius: 12,
            background: 'rgba(34,158,217,0.10)',
            border: '1px solid rgba(34,158,217,0.25)',
          }}>
            {rows.length}
          </span>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--negative)', padding: '6px 0' }}>
          {error}
        </div>
      )}

      {rows === null && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 0' }}>
          Loading…
        </div>
      )}

      {rows && rows.length === 0 && !error && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 0' }}>
          No one has linked Telegram yet.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 460 }}>
            <thead>
              <tr>
                {['User', 'Email', 'Telegram handle', 'Linked'].map((h) => (
                  <th key={h} style={{
                    padding: '8px 10px', fontSize: 10, fontWeight: 700,
                    color: 'var(--text-muted)', textTransform: 'uppercase',
                    letterSpacing: '0.06em', textAlign: 'left',
                    borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => (
                <tr key={u.id} style={{ borderBottom: i < rows.length - 1 ? '1px solid var(--bg-elevated)' : 'none' }}>
                  <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {u.full_name || (u.email || '').split('@')[0] || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                    {u.email || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {u.telegram_username
                      ? <a href={`https://t.me/${u.telegram_username}`} target="_blank" rel="noopener noreferrer" style={{ color: '#38BDF8', textDecoration: 'none' }}>@{u.telegram_username}</a>
                      : <span style={{ color: 'var(--text-hint)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {timeAgo(u.telegram_linked_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
