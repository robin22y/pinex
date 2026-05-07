import { C } from '../../styles/tokens'

export default function Skeleton({ height = 16, width = '100%', className = '' }) {
  return (
    <div
      className={`relative overflow-hidden rounded ${className}`}
      style={{
        height,
        width,
        background: C.surface2,
      }}
    >
      <div
        className="absolute inset-y-0 -left-1/2 w-1/2"
        style={{
          background:
            'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(148,163,184,0.18) 50%, rgba(255,255,255,0) 100%)',
          animation: 'stockiq-shimmer 1.2s infinite',
        }}
      />
      <style>{`
        @keyframes stockiq-shimmer {
          0% { transform: translateX(0); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  )
}
