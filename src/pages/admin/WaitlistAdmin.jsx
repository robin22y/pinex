import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getWaitlist, approveWaitlist, rejectWaitlist } from '../../lib/waitlist'
import { useAuth } from '../../context'

export default function WaitlistAdmin() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [waitlist, setWaitlist] = useState([])
  const [filter, setFilter] = useState('pending')
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState({})

  useEffect(() => {
    loadWaitlist()
  }, [filter])

  const loadWaitlist = async () => {
    setLoading(true)
    const { data } = await getWaitlist(filter === 'all' ? null : filter)
    setWaitlist(data || [])
    setLoading(false)
  }

  const handleApprove = async (id) => {
    setProcessing(p => ({ ...p, [id]: 'approving' }))
    const { error, email } = await approveWaitlist(id, user.email)
    if (error) {
      alert(`Error: ${error.message}`)
    } else {
      alert(`✅ Invite sent to ${email}`)
      loadWaitlist()
    }
    setProcessing(p => { const n = { ...p }; delete n[id]; return n })
  }

  const handleReject = async (id) => {
    const reason = prompt('Rejection reason (optional):')
    if (reason === null) return
    setProcessing(p => ({ ...p, [id]: 'rejecting' }))
    const { error } = await rejectWaitlist(id, reason)
    if (error) {
      alert(`Error: ${error.message}`)
    } else {
      loadWaitlist()
    }
    setProcessing(p => { const n = { ...p }; delete n[id]; return n })
  }

  const pending  = waitlist.filter(w => w.status === 'pending').length
  const approved = waitlist.filter(w => w.status === 'approved').length
  const rejected = waitlist.filter(w => w.status === 'rejected').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: 24 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Waitlist</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Manage access requests</div>
        </div>
        <button
          onClick={() => navigate('/admin')}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
        >
          ← Back to Admin
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
          { key: 'all', label: 'All' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid var(--border)', background: filter === tab.key ? 'var(--info)' : 'transparent', color: filter === tab.key ? '#fff' : 'var(--text-muted)', fontSize: 12, fontWeight: filter === tab.key ? 700 : 400, cursor: 'pointer' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Pending',  value: pending,  color: 'var(--warning)' },
          { label: 'Approved', value: approved, color: 'var(--positive)' },
          { label: 'Rejected', value: rejected, color: 'var(--negative)' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : waitlist.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 14 }}>
          No {filter} requests
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {waitlist.map(item => (
            <div key={item.id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.name}</span>
                  <span style={{
                    fontSize: 10, padding: '1px 7px', borderRadius: 10, fontWeight: 600,
                    background: item.status === 'pending' ? 'var(--warning-dim)' : item.status === 'approved' ? 'var(--accent-dim)' : 'var(--negative-dim)',
                    color: item.status === 'pending' ? 'var(--warning)' : item.status === 'approved' ? 'var(--positive)' : 'var(--negative)',
                  }}>
                    {item.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.email}</div>
                <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 3 }}>
                  {item.how_heard ? `via ${item.how_heard}` : 'source not specified'}
                  {' · '}
                  {new Date(item.requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                {item.rejection_reason && (
                  <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 3 }}>
                    Reason: {item.rejection_reason}
                  </div>
                )}
              </div>

              {item.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => handleApprove(item.id)}
                    disabled={!!processing[item.id]}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--info)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: processing[item.id] ? 'wait' : 'pointer', opacity: processing[item.id] ? 0.7 : 1 }}
                  >
                    {processing[item.id] === 'approving' ? 'Sending...' : 'Approve'}
                  </button>
                  <button
                    onClick={() => handleReject(item.id)}
                    disabled={!!processing[item.id]}
                    style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--negative)', fontSize: 12, cursor: processing[item.id] ? 'wait' : 'pointer' }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
