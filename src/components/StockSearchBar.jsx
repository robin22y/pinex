import { useNavigate } from 'react-router-dom'
import { C } from '../styles/tokens'

function SearchGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}

export default function StockSearchBar({ className = '', variant = 'hero' }) {
  const navigate = useNavigate()
  const isCompact = variant === 'compact'

  const pillShell = {
    borderColor: C.border,
    background: C.surface2,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
  }

  return (
    <button
      onClick={() => navigate('/search')}
      className={`flex w-full items-center gap-2 rounded-full border cursor-pointer transition-colors ${isCompact ? 'px-2.5 py-1' : 'px-3 py-1.5'}`}
      style={pillShell}
    >
      <span className="flex shrink-0 items-center pl-1" style={{ color: C.textMuted }}>
        <SearchGlyph />
      </span>
      <span
        className={`min-w-0 flex-1 text-left text-sm ${isCompact ? 'py-1' : 'py-2'}`}
        style={{ color: C.textMuted }}
      >
        Search stocks…
      </span>
      <span
        className={`shrink-0 rounded-full font-semibold ${isCompact ? 'px-3 py-1.5 text-xs' : 'px-5 py-2 text-sm'}`}
        style={{ background: C.accent, color: C.accentOn }}
      >
        {isCompact ? 'Go' : 'Search'}
      </span>
    </button>
  )
}
