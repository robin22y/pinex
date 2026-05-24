import { useRef, useState } from 'react'
import { useAuth } from '../context'
import { useAcademy } from '../hooks/useAcademy'
import { useNavigate } from 'react-router-dom'

export default function Certificate() {
  const { user, profile } = useAuth()
  const { progress, modules } = useAcademy()
  const navigate = useNavigate()
  const cardRef = useRef(null)
  const [sharing, setSharing] = useState(false)

  const totalScore = modules.reduce(
    (sum, m) => sum + (progress[m.id]?.best_score || 0),
    0
  )
  const maxScore = modules.reduce(
    (sum, m) => sum + (m.total_questions || 0),
    0
  )
  const pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0
  const completedDate = profile?.academy_completed_at
    ? new Date(profile.academy_completed_at).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })

  const name =
    profile?.full_name || user?.email?.split('@')[0] || 'Student'

  const handleShare = async () => {
    setSharing(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: '#0B0E11',
        useCORS: true,
        logging: false,
      })
      canvas.toBlob(async (blob) => {
        try {
          const file = new File([blob], 'pinex-certificate.png', {
            type: 'image/png',
          })
          if (
            navigator.share &&
            navigator.canShare &&
            navigator.canShare({ files: [file] })
          ) {
            await navigator.share({
              title: 'PineX Academy Certificate',
              text: `I completed PineX Academy with ${pct}% score! Stage Analysis for NSE stocks.`,
              files: [file],
            })
          } else {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'pinex-certificate.png'
            a.click()
            URL.revokeObjectURL(url)
          }
        } catch {
          // ignore — user cancelled share, etc.
        }
        setSharing(false)
      }, 'image/png')
    } catch {
      setSharing(false)
    }
  }

  const passed =
    profile?.academy_completed || profile?.academy_grandfathered

  if (!passed) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'var(--bg-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <div style={{ fontSize: 48 }}>🔒</div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Complete the academy first
          </div>
          <button
            onClick={() => navigate('/learn')}
            style={{
              marginTop: 16,
              padding: '12px 24px',
              borderRadius: 10,
              border: 'none',
              background: '#00C805',
              color: '#000',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Start learning →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px 16px 80px',
      }}
    >
      {/* Back */}
      <div style={{ width: '100%', maxWidth: 520, marginBottom: 16 }}>
        <button
          onClick={() => navigate('/learn')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            padding: 0,
          }}
        >
          <i className="ti ti-arrow-left" style={{ fontSize: 16 }} />
          Back
        </button>
      </div>

      {/* Certificate */}
      <div
        ref={cardRef}
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#0B0E11',
          borderRadius: 20,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Outer border */}
        <div
          style={{
            margin: 12,
            borderRadius: 14,
            border: '2px solid #00C805',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {/* Inner border */}
          <div
            style={{
              margin: 4,
              borderRadius: 10,
              border: '1px solid rgba(0,200,5,0.3)',
              padding: '28px 24px',
              position: 'relative',
            }}
          >
            {/* Corner decorations */}
            {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map((pos) => (
              <div
                key={pos}
                style={{
                  position: 'absolute',
                  [pos.includes('top') ? 'top' : 'bottom']: 8,
                  [pos.includes('left') ? 'left' : 'right']: 8,
                  width: 20,
                  height: 20,
                  borderTop: pos.includes('top') ? '2px solid #00C805' : 'none',
                  borderBottom: pos.includes('bottom')
                    ? '2px solid #00C805'
                    : 'none',
                  borderLeft: pos.includes('left') ? '2px solid #00C805' : 'none',
                  borderRight: pos.includes('right')
                    ? '2px solid #00C805'
                    : 'none',
                }}
              />
            ))}

            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: '#E2E8F0',
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                }}
              >
                Pine<span style={{ color: '#00C805' }}>X</span> Academy
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: '#475569',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginTop: 3,
                }}
              >
                Certificate of Completion
              </div>
            </div>

            {/* Divider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'rgba(0,200,5,0.2)' }} />
              <div style={{ fontSize: 16, color: '#00C805' }}>✦</div>
              <div style={{ flex: 1, height: 1, background: 'rgba(0,200,5,0.2)' }} />
            </div>

            {/* This certifies */}
            <div
              style={{
                textAlign: 'center',
                marginBottom: 8,
                fontSize: 11,
                color: '#64748B',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              This certifies that
            </div>

            {/* Name */}
            <div
              style={{
                textAlign: 'center',
                fontSize: 26,
                fontWeight: 800,
                color: '#E2E8F0',
                letterSpacing: '-0.01em',
                marginBottom: 8,
                fontFamily: 'var(--font-serif, Georgia, serif)',
              }}
            >
              {name}
            </div>

            <div
              style={{
                textAlign: 'center',
                fontSize: 12,
                color: '#64748B',
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              has demonstrated understanding of
              <br />
              the Weinstein Stage Analysis method
            </div>

            {/* Score */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  padding: '8px 24px',
                  borderRadius: 8,
                  background: 'rgba(0,200,5,0.1)',
                  border: '1px solid rgba(0,200,5,0.2)',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: '#00C805',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1,
                  }}
                >
                  {pct}%
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#475569',
                    marginTop: 2,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Final Score
                </div>
              </div>
            </div>

            {/* Modules completed */}
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 8,
                padding: '12px',
                marginBottom: 20,
              }}
            >
              {[
                "Weinstein's 4 Stage methodology",
                '30-Week Moving Average analysis',
                'Volume & Delivery confirmation',
                'Relative Strength vs Index',
                'Sector & Market context',
              ].map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: i < 4 ? 6 : 0,
                    fontSize: 11,
                    color: '#94A3B8',
                  }}
                >
                  <span style={{ color: '#00C805', fontSize: 10 }}>✓</span>
                  {item}
                </div>
              ))}
            </div>

            {/* Divider */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'rgba(0,200,5,0.15)' }} />
              <div style={{ fontSize: 14, color: 'rgba(0,200,5,0.4)' }}>✦</div>
              <div style={{ flex: 1, height: 1, background: 'rgba(0,200,5,0.15)' }} />
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-end',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#E2E8F0' }}>
                  Pine<span style={{ color: '#00C805' }}>X</span>
                </div>
                <div style={{ fontSize: 9, color: '#334155', marginTop: 2 }}>
                  pinex.in
                </div>
                <div
                  style={{
                    fontSize: 8,
                    color: '#1E2530',
                    marginTop: 4,
                    fontStyle: 'italic',
                  }}
                >
                  Educational purposes only
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  style={{
                    fontSize: 9,
                    color: '#475569',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 2,
                  }}
                >
                  Completed
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>
                  {completedDate}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Share button */}
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          marginTop: 16,
          display: 'flex',
          gap: 10,
        }}
      >
        <button
          onClick={handleShare}
          disabled={sharing}
          style={{
            flex: 2,
            padding: '14px',
            borderRadius: 10,
            border: 'none',
            background: '#00C805',
            color: '#000',
            fontSize: 14,
            fontWeight: 700,
            cursor: sharing ? 'wait' : 'pointer',
            opacity: sharing ? 0.7 : 1,
          }}
        >
          {sharing ? 'Preparing...' : '📤 Share / Download'}
        </button>
        <button
          onClick={() => navigate('/learn')}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Back
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          fontSize: 11,
          color: 'var(--text-disabled)',
          textAlign: 'center',
        }}
      >
        Share on WhatsApp, Twitter, or save to photos
      </div>
    </div>
  )
}
