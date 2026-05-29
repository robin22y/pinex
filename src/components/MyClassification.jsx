import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { readLocal, writeLocal } from '../lib/localStore'
import { useAuth } from '../context'
import ProBadge from './ProBadge'

// ── My Classification ───────────────────────────────────────────────────────
// Lets a logged-in user attach THEIR OWN phase label to a stock. PineX never
// classifies a stock itself — this records the user's judgment privately in
// `user_classifications` (RLS-scoped to auth.uid()). Purely a user annotation;
// there is no PineX-authored conclusion here.
const OPTIONS = ['Basing', 'Advancing', 'Topping', 'Declining']
const AMBER = '#F59E0B'

function formatDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function MyClassification({ symbol }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState(null)
  const [classifiedAt, setClassifiedAt] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [notice, setNotice] = useState('')

  // Load any existing classification for this user + symbol. LOCAL-FIRST: the
  // cached value renders instantly, then Supabase is consulted as a best-effort
  // mirror (authoritative across devices when the table is deployed). Works
  // even if the migration has not been run.
  useEffect(() => {
    let active = true
    if (!user?.id || !symbol) {
      setSelected(null)
      setClassifiedAt(null)
      return
    }
    const localMap = readLocal('classifications', user.id, {})
    const localEntry = localMap[symbol]
    setSelected(localEntry?.classification || null)
    setClassifiedAt(localEntry?.classified_at || null)
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('user_classifications')
          .select('classification, classified_at')
          .eq('user_id', user.id)
          .eq('symbol', symbol)
          .maybeSingle()
        if (!active || error || !data) return
        setSelected(data.classification)
        setClassifiedAt(data.classified_at)
        const map = readLocal('classifications', user.id, {})
        map[symbol] = { classification: data.classification, classified_at: data.classified_at }
        writeLocal('classifications', user.id, map)
      } catch {
        // table missing / network — the local copy stands
      }
    })()
    return () => {
      active = false
    }
  }, [user?.id, symbol])

  const save = async (value) => {
    if (!user?.id) {
      navigate('/login')
      return
    }
    if (saving) return
    setSaving(true)
    setNotice('')
    const now = new Date().toISOString()
    // Local-first: persist immediately so the save never silently fails.
    const map = readLocal('classifications', user.id, {})
    map[symbol] = { classification: value, classified_at: now }
    writeLocal('classifications', user.id, map)
    setSelected(value)
    setClassifiedAt(now)
    setEditing(false)
    setConfirm(true)
    setTimeout(() => setConfirm(false), 2500)
    // Best-effort Supabase mirror — non-fatal if the table is absent.
    try {
      await supabase
        .from('user_classifications')
        .upsert(
          { user_id: user.id, symbol, classification: value, classified_at: now },
          { onConflict: 'user_id,symbol' },
        )
    } catch {
      // local copy already saved
    }
    setSaving(false)
  }

  const showButtons = editing || !selected

  return (
    <div
      className="rounded-[12px] border"
      style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', padding: '20px', marginBottom: '16px' }}
    >
      {/* Title + PRO badge + info button */}
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <h3
          className="m-0 font-bold"
          style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)' }}
        >
          My Classification
        </h3>
        <ProBadge />
        <button
          type="button"
          onClick={() => setShowInfo((v) => !v)}
          aria-label="About My Classification"
          aria-expanded={showInfo}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: '1px solid var(--border)',
            background: showInfo ? 'var(--bg-surface)' : 'transparent',
            color: 'var(--text-muted)',
            fontSize: 11,
            fontStyle: 'italic',
            fontWeight: 700,
            lineHeight: 1,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          i
        </button>
      </div>
      <p className="m-0 text-[12px]" style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
        Apply your own analysis
      </p>

      {/* Info panel */}
      {showInfo ? (
        <div
          className="mb-4 rounded-lg border px-3 py-2.5 text-[12px] leading-relaxed"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
        >
          <p className="m-0 mb-2 font-bold" style={{ color: 'var(--text-primary)', letterSpacing: '0.04em' }}>
            YOUR CLASSIFICATION
          </p>
          <p className="m-0 mb-2">
            These labels reflect YOUR analysis based on the criteria you see above.
          </p>
          <p className="m-0 mb-2">PineX does not classify stocks. You decide — based on the data.</p>
          <p className="m-0">Your classification is stored privately in your account only.</p>
        </div>
      ) : null}

      {/* Saved state */}
      {selected && !editing ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[13px]" style={{ color: 'var(--text-primary)' }}>
            Your classification:{' '}
            <span style={{ color: AMBER, fontWeight: 700 }}>{selected}</span>
          </span>
          {classifiedAt ? (
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Set on {formatDate(classifiedAt)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--info)', fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
          >
            Change
          </button>
        </div>
      ) : null}

      {/* Buttons */}
      {showButtons ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {OPTIONS.map((opt) => {
            const active = selected === opt
            return (
              <button
                key={opt}
                type="button"
                disabled={saving}
                onClick={() => save(opt)}
                style={{
                  flex: '1 1 0',
                  minWidth: 88,
                  padding: '9px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: saving ? 'default' : 'pointer',
                  border: `1px solid ${active ? AMBER : 'var(--border)'}`,
                  background: active ? 'rgba(245,158,11,0.12)' : 'transparent',
                  color: active ? AMBER : 'var(--text-secondary)',
                  transition: 'border-color .15s, background .15s, color .15s',
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Confirmation / notice */}
      {confirm ? (
        <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--positive)' }}>
          ✓ Saved to your watchlist
        </p>
      ) : null}
      {notice ? (
        <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {notice}
        </p>
      ) : null}
      {!user ? (
        <p className="m-0 mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Sign in to save your classification — it stays private to your account.
        </p>
      ) : null}
    </div>
  )
}
