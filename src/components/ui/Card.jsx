import { C } from '../../styles/tokens'

export default function Card({ children, className = '', highlight }) {
  return (
    <div
      className={`rounded-xl border p-5 ${className}`}
      style={{
        background: C.surface,
        borderColor: C.border,
        borderLeft: highlight ? `3px solid ${highlight}` : `1px solid ${C.border}`,
      }}
    >
      {children}
    </div>
  )
}
