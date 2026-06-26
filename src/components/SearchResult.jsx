import { C } from '../styles/tokens'
import StagePill from './StagePill'

/**
 * Individual search result row — shown in Typing state.
 * Compact list item with stock symbol, name, sector, and stage badge.
 */
export default function SearchResult({ item, isSelected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors rounded-lg`}
      style={{
        background: isSelected ? C.base : 'transparent',
        borderColor: isSelected ? C.borderHover : 'transparent',
        border: `1px solid`,
        color: C.text,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = C.surface2
          e.currentTarget.style.borderColor = C.borderHover
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.borderColor = 'transparent'
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>
          {item.symbol}
        </p>
        <p className="text-xs truncate" style={{ color: C.textMuted }}>
          {item.name}
        </p>
        <p className="text-xs truncate" style={{ color: C.textFaint }}>
          {item.sector || 'Unknown sector'}
        </p>
      </div>
      {item.stage && <StagePill stage={item.stage} />}
    </button>
  )
}
