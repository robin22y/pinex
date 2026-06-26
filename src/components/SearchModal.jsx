import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { C } from '../styles/tokens'
import SearchResult from './SearchResult'
import SearchCard from './SearchCard'
import ShareCard from './ShareCard'

/**
 * Premium search modal — three interactive states:
 * 1. Idle: Recent searches, popular, trending
 * 2. Typing: Compact 8-result list with live search
 * 3. Exact Match: Full snapshot card with details
 */
export default function SearchModal({
  isOpen,
  onClose,
  searchQuery,
  onSearchChange,
  searchResults,
  recentSearches,
  onSelectStock,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [showShareCard, setShowShareCard] = useState(false)
  const inputRef = useRef(null)

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return

      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => (i + 1) % Math.max(searchResults.length, 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => (i - 1 + Math.max(searchResults.length, 1)) % Math.max(searchResults.length, 1))
          break
        case 'Enter':
          e.preventDefault()
          if (searchResults[selectedIndex]) {
            onSelectStock(searchResults[selectedIndex])
          }
          break
        default:
          break
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, searchResults, selectedIndex, onSelectStock, onClose])

  const visibleResults = searchQuery ? searchResults : recentSearches
  const hasTypedQuery = searchQuery && searchQuery.trim().length > 0
  const state = !hasTypedQuery ? 'idle' : searchResults.length > 0 ? 'typing' : 'empty'

  // For exact match, try to find a single stock match
  const exactMatch =
    hasTypedQuery &&
    searchResults.length === 1
      ? searchResults[0]
      : searchResults.find((r) => r.symbol?.toUpperCase() === searchQuery?.trim().toUpperCase())

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Dimmed background */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.2, type: 'spring', bounce: 0.3 }}
            className="fixed inset-x-4 top-16 z-50 mx-auto max-w-2xl max-h-[calc(100vh-120px)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search bar */}
            <div
              className="rounded-t-2xl border-b overflow-hidden sticky top-0 z-10"
              style={{
                background: C.surfaceCard,
                borderColor: C.border,
              }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <SearchGlyph />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    onSearchChange(e.target.value)
                    setSelectedIndex(0)
                  }}
                  placeholder="Search stocks…"
                  className="flex-1 border-0 bg-transparent text-sm outline-none"
                  style={{ color: C.text }}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1 hover:opacity-70 transition-opacity"
                    style={{ color: C.textMuted }}
                  >
                    <X size={18} />
                  </button>
                )}
              </div>
            </div>

            {/* Content area */}
            <div
              className="rounded-b-2xl border flex-1 overflow-y-auto"
              style={{
                background: C.surfaceCard,
                borderColor: C.border,
              }}
            >
              {/* Exact Match — snapshot card */}
              {exactMatch && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="p-6 border-b"
                  style={{ borderColor: C.border }}
                >
                  <SearchCard
                    stock={exactMatch}
                    onOpen={() => {
                      onSelectStock(exactMatch)
                      onClose()
                    }}
                    onShare={() => setShowShareCard(true)}
                  />
                </motion.div>
              )}

              {/* Typing state — result list */}
              {hasTypedQuery && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-1 p-3"
                >
                  {searchResults.length > 0 ? (
                    searchResults.map((item, idx) => (
                      <SearchResult
                        key={`${item.symbol}-${item.id}`}
                        item={item}
                        isSelected={idx === selectedIndex}
                        onSelect={() => {
                          setSelectedIndex(idx)
                          onSelectStock(item)
                          onClose()
                        }}
                      />
                    ))
                  ) : (
                    <p className="px-4 py-8 text-center text-sm" style={{ color: C.textMuted }}>
                      No matching stocks
                    </p>
                  )}
                </motion.div>
              )}

              {/* Idle state — recent searches */}
              {state === 'idle' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="p-6"
                >
                  {recentSearches.length > 0 ? (
                    <>
                      <p className="text-xs uppercase font-semibold mb-3" style={{ color: C.textMuted }}>
                        Recent Searches
                      </p>
                      <div className="space-y-2">
                        {recentSearches.map((item) => (
                          <button
                            key={`${item.symbol}-${item.id}`}
                            type="button"
                            onClick={() => {
                              onSelectStock(item)
                              onClose()
                            }}
                            className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg transition-colors"
                            style={{
                              background: C.surface2,
                              color: C.text,
                              border: `1px solid ${C.border}`,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = C.borderHover
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = C.border
                            }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{item.symbol}</p>
                              <p className="text-xs truncate" style={{ color: C.textMuted }}>
                                {item.name}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-center py-8" style={{ color: C.textMuted }}>
                      Start typing to search…
                    </p>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>
        </>
      )}

      {/* Share Card Modal */}
      {showShareCard && exactMatch && (
        <ShareCard
          stock={exactMatch}
          onClose={() => setShowShareCard(false)}
        />
      )}
    </AnimatePresence>
  )
}

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
      style={{ color: 'var(--text-muted)' }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
