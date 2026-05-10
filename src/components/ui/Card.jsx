import { C } from '../../styles/tokens'

export default function Card({ children, className = '', highlight }) {
  const borderLeftW = highlight ? 4 : 1
  return (
    <div
      className={`rounded-2xl border border-solid p-5 ${className}`}
      style={{
        background: C.surfaceCard,
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: borderLeftW,
        borderTopColor: C.border,
        borderRightColor: C.border,
        borderBottomColor: C.border,
        borderLeftColor: highlight || C.border,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.035)',
      }}
    >
      {children}
    </div>
  )
}
