import { C } from '../../styles/tokens'

export default function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-xl border p-5"
        style={{ background: C.surface, borderColor: C.border }}
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
        <h3 className="mb-3 text-lg font-semibold" style={{ color: C.text }}>
          {title}
        </h3>
        <div>{children}</div>
      </div>
    </div>
  )
}
