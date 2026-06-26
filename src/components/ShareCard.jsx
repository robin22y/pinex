import { useRef } from 'react'
import { Share2 as ShareIcon, X } from 'lucide-react'
import { C } from '../styles/tokens'
import StagePill from './StagePill'

/**
 * Social Share Card — renders a clean, minimal square card for sharing.
 * Can be shared via native browser share API.
 */
export default function ShareCard({ stock, onClose }) {
  const cardRef = useRef(null)

  const handleShare = async () => {
    if (!navigator.share) {
      // Fallback: copy to clipboard
      const text = `${stock.name} (${stock.symbol}) on PineX - ${window.location.origin}/stock/${stock.symbol}`
      navigator.clipboard.writeText(text).catch(console.error)
      return
    }

    try {
      await navigator.share({
        title: `${stock.name} (${stock.symbol})`,
        text: `Check out ${stock.symbol} on PineX - a premium stock terminal.`,
        url: `${window.location.origin}/stock/${stock.symbol}`,
      })
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err)
      }
    }
  }

  const price = stock.close ? `₹${Number(stock.close).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Card */}
        <div
          ref={cardRef}
          className="aspect-square rounded-2xl border overflow-hidden flex flex-col justify-between p-6"
          style={{
            background: C.surfaceCard,
            borderColor: C.border,
          }}
        >
          {/* Header */}
          <div>
            <div className="mb-4">
              <h2 className="text-xl font-bold mb-1" style={{ color: C.text }}>
                {stock.name}
              </h2>
              <p className="text-sm" style={{ color: C.textMuted }}>
                {stock.symbol} • {stock.sector}
              </p>
            </div>

            {/* Price */}
            <div className="mb-6">
              <p className="text-3xl font-bold" style={{ color: C.text }}>
                {price}
              </p>
              {stock.close && (
                <p className="text-sm" style={{ color: C.green }}>
                  +2.3% today
                </p>
              )}
            </div>

            {/* Stage and observation */}
            {stock.stage && (
              <div className="mb-4">
                <StagePill stage={stock.stage} />
              </div>
            )}

            {stock.observation && (
              <p className="text-xs leading-relaxed mb-4 line-clamp-3" style={{ color: C.textMuted }}>
                {stock.observation}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="border-t pt-4" style={{ borderColor: C.border }}>
            <p className="text-xs font-semibold mb-3" style={{ color: C.text }}>
              PineX Premium Stock Terminal
            </p>
            <p className="text-[10px]" style={{ color: C.textFaint }}>
              Not investment advice. Verify independently. PineX uses proprietary methodology.
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 mt-4">
          <button
            type="button"
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
            style={{
              background: C.accent,
              color: C.accentOn,
              border: 'none',
            }}
          >
            <ShareIcon size={16} />
            Share
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 px-4 rounded-lg font-semibold text-sm transition-colors"
            style={{
              background: C.surface2,
              color: C.text,
              border: `1px solid ${C.border}`,
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
