import { Link } from 'react-router-dom'
import StockSearchBar from '../StockSearchBar'
import { HOME } from '../../styles/homeSkin'
import { C } from '../../styles/tokens'
import { signInWithGoogle } from '../../lib/auth'

function initials(name, email) {
  const source = String(name || email || '').trim()
  if (!source) return 'U'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || 'U'
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

export default function HomeNavbar({ loggedIn, displayName, avatarUrl, userEmail, onAccountClick }) {
  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        height: 56,
        borderColor: HOME.cardBorder,
        background: 'rgba(8,12,20,0.72)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-3 px-4 md:gap-4 md:px-6">
        <Link
          to="/"
          className="md:hidden shrink-0 text-[18px] font-bold tracking-tight"
          style={{ color: '#38bdf8' }}
          title="Home"
        >
          PineX
        </Link>

        <div className="min-w-0 flex-1">
          <StockSearchBar variant="compact" className="relative w-full max-w-xl mx-auto" />
        </div>

        {!loggedIn ? (
          <div className="md:hidden flex shrink-0 items-center gap-2">
            <Link
              to="/login"
              className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-[13px] font-medium"
              style={{ borderColor: HOME.cardBorder, color: C.textMuted }}
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={signInWithGoogle}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold"
              style={{ background: C.blue, color: '#0f172a' }}
            >
              Get started
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onAccountClick}
            className="md:hidden ml-auto flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border"
            style={{ borderColor: HOME.cardBorder, background: HOME.card, color: C.text }}
            aria-label="Account"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-xs font-semibold">{initials(displayName, userEmail)}</span>
            )}
          </button>
        )}
      </div>
    </header>
  )
}
