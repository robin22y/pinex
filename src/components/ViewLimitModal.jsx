import { C } from '../styles/tokens'
import { setViewLimitRemindTomorrow } from './view-limit-modal-utils'

export default function ViewLimitModal({ isOpen, onClose, viewedCount = 10 }) {
  if (!isOpen) return null

  const handleRemindTomorrow = () => {
    try {
      setViewLimitRemindTomorrow()
    } catch {
      // no-op
    }
    onClose?.()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/55" />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-2xl border p-4 shadow-2xl md:left-1/2 md:max-w-lg md:-translate-x-1/2"
        style={{ background: C.surface, borderColor: C.border }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-lg font-bold" style={{ color: C.text }}>
          You&apos;ve viewed {viewedCount} stocks today
        </p>
        <p className="mt-2 text-sm leading-6" style={{ color: C.textMuted }}>
          Free accounts get 10 stock views per day.
          <br />
          Resets at midnight IST.
        </p>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-lg border px-3 py-2 text-sm font-medium opacity-70"
            style={{ borderColor: C.border, background: C.surface2, color: C.textMuted }}
          >
            Upgrade to Pro — Coming Soon
          </button>
          <button
            type="button"
            onClick={handleRemindTomorrow}
            className="w-full rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: C.border, background: C.blueBg, color: C.blue }}
          >
            Remind me tomorrow
          </button>
        </div>

        <div className="mt-4 space-y-1 text-sm" style={{ color: C.text }}>
          <p>✓ Your watchlist still works</p>
          <p>✓ Your portfolio still works</p>
          <p>✓ Home page market pulse still works</p>
        </div>

        <p className="mt-3 text-xs leading-5" style={{ color: C.textMuted }}>
          Pro will be available soon.
          <br />
          Free accounts will always have generous access.
        </p>
      </div>
    </div>
  )
}
