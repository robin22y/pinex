import { C } from '../../styles/tokens'

export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border p-6"
        style={{
          background: C.surfaceCard,
          borderColor: C.border,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded px-2 py-1 text-sm"
          style={{ color: C.textMuted }}
        >
          ×
        </button>
        <h3 className="mb-3 text-lg font-semibold tracking-tight" style={{ color: C.textHeading }}>
          {title}
        </h3>
        <div>{children}</div>
      </div>
    </div>
  )
}
