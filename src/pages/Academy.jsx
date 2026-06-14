import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAcademy } from '../hooks/useAcademy'
import { useAuth } from '../context'

import Icon from '../components/ui/Icon'
// Module 9 (BYOK Gemini explainer) — shared display-only component.
// Rendered inline in the modules grid here AND full-page by
// ModuleLesson.jsx when anything deep-links to /learn/<BYOK_MODULE_KEY>.
import ByokExplainer, { BYOK_MODULE_KEY } from '../components/ByokExplainer'
const LANGS = [
  { code: 'en', label: 'EN', full: 'English' },
  { code: 'hi', label: 'हि', full: 'हिंदी' },
  { code: 'ml', label: 'മ', full: 'മലയാളം' },
  { code: 'ta', label: 'த', full: 'தமிழ்' },
]

// Emoji → Flaticon class translator. Module rows are stored in the
// DB with emoji icons; this map translates them to the corresponding
// uicons-regular-rounded glyph at render time. New rows can be
// stored either as emojis (lookup) or as 'fi-rr-...' classes
// (passed through). Returns a Flaticon class suffix.
const EMOJI_TO_FI = {
  '🎓': 'fi-rr-graduation-cap',
  '📊': 'fi-rr-chart-histogram',
  '📈': 'fi-rr-chart-line-up',
  '📉': 'fi-rr-chart-arrow-down',
  '🏆': 'fi-rr-trophy',
  '⚡': 'fi-rr-bolt',
  '🔓': 'fi-rr-unlock',
  '🔒': 'fi-rr-lock',
  '✅': 'fi-rr-check',
  '✓':  'fi-rr-check',
  '🌱': 'fi-rr-seedling',
  '🚀': 'fi-rr-rocket-lunch',
  '🌐': 'fi-rr-globe',
  '🧱': 'fi-rr-cube',
  '🔊': 'fi-rr-volume',
  '💪': 'fi-rr-muscle',
  '🎯': 'fi-rr-bullseye',
  '🔍': 'fi-rr-search',
  '🚪': 'fi-rr-sign-out-alt',
  '🛡': 'fi-rr-shield',
  '🛡️': 'fi-rr-shield',
  '🔄': 'fi-rr-refresh',
  '🧠': 'fi-rr-brain',
  '🗺️': 'fi-rr-map',
  '🗺': 'fi-rr-map',
  '📐': 'fi-rr-triangle',
  '📅': 'fi-rr-calendar',
  '📋': 'fi-rr-clipboard-list',
  '🪟': 'fi-rr-window-frame-open',
  '🏪': 'fi-rr-shop',
  '🏏': 'fi-rr-cricket',
  '📦': 'fi-rr-box',
  '🔬': 'fi-rr-microscope',
  '🌵': 'fi-rr-cactus',
  '🏠': 'fi-rr-home',
  '🔗': 'fi-rr-link',
  '⚠️': 'fi-rr-triangle-warning',
  '⚠': 'fi-rr-triangle-warning',
}
function emojiToFi(v) {
  if (!v) return 'fi-rr-book-alt'
  const s = String(v).trim()
  if (s.startsWith('fi-rr-')) return s          // already a class
  return EMOJI_TO_FI[s] || 'fi-rr-book-alt'     // fallback
}
function FiIcon({ value, size = 22, color = 'currentColor' }) {
  // Icon component strips the `fi-rr-` prefix before looking up the
  // lucide component, so `emojiToFi('🎓')` → `'fi-rr-graduation-cap'`
  // → looked up as `'graduation-cap'`. No data migration needed.
  return (
    <Icon
      name={emojiToFi(value)}
      size={size}
      style={{ color, display: 'inline-flex', verticalAlign: 'middle' }}
      aria-hidden
    />
  )
}

// WHY: Each module that unlocks a feature gets
// a callout badge on its card so the user sees
// the reward, not just the time cost. Keep keys
// in sync with REQUIRED_BY_LEVEL in useAcademy.
const UNLOCK_BADGES = {
  core_foundation: null, // first module, no badge
  volume_rules: {
    label: '🔓 Unlocks Screener',
    color: 'var(--accent)',
    bg: 'var(--accent-dim)',
    border: 'var(--accent-border)',
  },
  stage2_advancing: null,
  relative_strength_selection: {
    label: '⚡ Unlocks SwingX',
    color: '#FBBF24',
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.3)',
  },
  shortterm_50day: {
    label: '🏆 Completes Academy',
    color: 'var(--info)',
    bg: 'var(--info-dim)',
    border: 'var(--info-dim)',
  },
}

// ── Chapter-book redesign palette ─────────────────────────────────
// Sepia, fixed regardless of app theme. The page deliberately reads
// like a textbook — warm paper, near-black ink, restrained accent.
const S = {
  base:       '#F2EDE4',  // warm paper background
  surface:    '#FDFCFA',  // card/section background
  border:     '#E0D9CF',  // warm divider
  borderDark: '#C8BFB3',  // stronger border
  text:       '#1C1917',  // near-black ink
  textMuted:  '#6B6560',  // secondary text
  textFaint:  '#9E9890',  // disabled/locked
  accent:     '#863bff',  // PineX purple
  accentWarm: '#7B5C00',  // warm amber for chapter headings
  green:      '#15803D',  // completed
  ink:        '#292524',  // headings
  inProgress: '#FFF8E7',  // warm cream highlight for in-progress row
  amber:      '#D97706',  // in-progress accent text + dot
  hover:      '#F5EFE6',  // row hover background
}

// Chapter rendering is now data-driven — academy_modules carries
// chapter (int), chapter_label_en, chapter_subtitle_en columns. The
// grouping below in Academy() reads those columns and builds the
// chapter sections at render time. No hardcoded module-id lists.
//
// CHAPTER_WORDS maps the chapter integer to its display word
// ("Chapter ONE", "Chapter TWO", …). Falls through to the integer
// for chapters beyond TEN.
const CHAPTER_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

const PRO_MODULES = ['research_assistant']

// "Unlocks <X>" callouts on individual rows. The DB doesn't carry an
// unlocks_label column yet, so we map keys → display strings here. A
// row whose module.unlocks_label is set will use that instead.
const UNLOCKS_LABEL = {
  volume_rules: 'Screener',
  relative_strength_selection: 'SwingX',
  shortterm_50day: 'Academy',
}

const SPECIAL_TOPICS = [
  { id: 'when-to-sell',     title: 'When to Sell a Stock',   subtitle: 'Stage 2 → 3 → 4 exit rules',          path: '/learn/when-to-sell',     duration: '8 min' },
  { id: 'risk-management',  title: 'Risk Management',         subtitle: 'The 2% rule and position sizing',     path: '/learn/risk-management',  duration: '7 min' },
  { id: 'sector-rotation',  title: 'Sector Rotation',         subtitle: 'Following institutional money',       path: '/learn/sector-rotation',  duration: '6 min' },
]

function Chapter({ chapter, lang, progress, onModuleClick }) {
  const chapterModules = chapter.modules || []
  if (chapterModules.length === 0) return null
  const word = CHAPTER_WORDS[chapter.number - 1] || `${chapter.number}`
  return (
    <div>
      {/* Chapter header */}
      <div style={{
        padding: '24px 20px 12px',
        borderBottom: `1px solid ${S.border}`,
        background: S.surface,
      }}>
        <div style={{
          fontSize: 10,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: S.accentWarm,
          fontWeight: 600,
          marginBottom: 4,
        }}>
          Chapter {word}
        </div>
        <div style={{
          fontSize: 17,
          fontWeight: 700,
          color: S.ink,
          marginBottom: 2,
        }}>
          {chapter.label}
        </div>
        {chapter.subtitle && (
          <div style={{
            fontSize: 13,
            color: S.textMuted,
            fontStyle: 'italic',
          }}>
            {chapter.subtitle}
          </div>
        )}
      </div>

      {/* Module rows */}
      {chapterModules.map((module, idx) => (
        <ModuleRow
          key={module.id}
          module={module}
          title={module[`title_${lang}`] || module.title_en || module.title || ''}
          index={idx}
          progress={progress?.[module.id]}
          onClick={() => onModuleClick(module)}
          isLast={idx === chapterModules.length - 1}
        />
      ))}
    </div>
  )
}

function ModuleRow({ module, title, index, progress, onClick, isLast }) {
  const isCompleted  = progress?.passed === true
  const isInProgress = !!progress && !isCompleted
  const isLocked     = !!module.is_locked && !isCompleted
  const isPro        = module.tier === 'pro' || !!module.is_pro || PRO_MODULES.includes(module.id)
  const isBasics     = module.tier === 'basics'
  const unlocksLabel = module.unlocks_label || UNLOCKS_LABEL[module.id]
  const baseBg       = isInProgress ? S.inProgress : S.surface

  return (
    <button
      type="button"
      onClick={isLocked ? undefined : onClick}
      disabled={isLocked}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '16px 20px',
        background: baseBg,
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        borderBottom: isLast ? 'none' : `1px solid ${S.border}`,
        cursor: isLocked ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        transition: 'background 0.15s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => {
        if (!isLocked) e.currentTarget.style.background = S.hover
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = baseBg
      }}
    >
      {/* Status indicator */}
      <div style={{
        width: 28,
        height: 28,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: isCompleted ? S.green : isInProgress ? S.amber : S.border,
        color: isCompleted || isInProgress ? '#fff' : S.textFaint,
        fontSize: isCompleted ? 14 : 12,
        fontWeight: 700,
      }}>
        {isCompleted ? '✓' : isLocked ? '🔒' : index + 1}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 600,
          color: isLocked ? S.textFaint : S.ink,
          marginBottom: 2,
          lineHeight: 1.3,
        }}>
          {title}
          {isBasics && (
            <span style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 700,
              color: S.accentWarm,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              MUST
            </span>
          )}
          {isPro && (
            <span style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 700,
              color: S.accent,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              PRO
            </span>
          )}
        </div>
        <div style={{
          fontSize: 12,
          color: S.textMuted,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          {module.duration && <span>{module.duration}</span>}
          {module.total_questions > 0 && (
            <span>{module.total_questions} questions</span>
          )}
          {isInProgress && (
            <span style={{ color: S.amber, fontWeight: 600 }}>
              In progress
            </span>
          )}
          {unlocksLabel && (
            <span style={{
              color: S.accent,
              fontWeight: 600,
              fontSize: 11,
            }}>
              Unlocks {unlocksLabel}
            </span>
          )}
        </div>
      </div>

      {/* Arrow */}
      {!isLocked && (
        <div style={{
          color: S.textFaint,
          fontSize: 16,
          flexShrink: 0,
        }}>
          →
        </div>
      )}
    </button>
  )
}


export default function Academy() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const {
    modules,
    progress,
    hasScreenerAccess,
    hasSwingXAccess,
    loading,
  } = useAcademy()

  const [lang, setLang] = useState(
    localStorage.getItem('pinex_lang') || 'en'
  )

  const setLanguage = (l) => {
    setLang(l)
    localStorage.setItem('pinex_lang', l)
  }

  // Per-device "show Pro modules" preference. Default = true (Pro
  // visible upfront for discoverability). The literal string check
  // means a brand-new browser without the key set falls back to true.
  const [showPro, setShowPro] = useState(
    () => localStorage.getItem('pinex_show_pro_modules') !== 'false',
  )

  const toggleShowPro = () => {
    setShowPro((cur) => {
      const next = !cur
      try { localStorage.setItem('pinex_show_pro_modules', String(next)) } catch {}
      return next
    })
  }

  const getTitle = (mod) => {
    if (!mod) return ''
    return mod[`title_${lang}`] || mod.title_en || mod.title || ''
  }

  const completedCount = modules.filter((m) => progress[m.id]?.passed).length
  // WHY: Previously this added an `upcoming.length`
  // for phantom "Coming soon" cards that have
  // since been published. That made the progress
  // bar denominator larger than the real module
  // count. Use the live module list only.
  const totalModules = modules.length

  // Derive chapters from module data. academy_modules carries
  // chapter (int), chapter_label_en, chapter_subtitle_en. Modules with
  // chapter=null land in proModules if is_pro=true, otherwise drop off
  // the page (Pro/Special handled separately; legacy explainer ids on
  // hiddenIds are never rendered).
  //
  // `completedCount` / `totalModules` above still reflect the raw module
  // list so the progress bar denominator counts every module the user
  // owes — even ones temporarily hidden from the chaptered view.
  const chapterMap = {}
  const proModules = []
  const hiddenIds = ['byok_gemini_explainer', 'psychologyofmarkets']

  modules
    .filter((m) => !hiddenIds.includes(m.id) && m.is_published)
    .forEach((m) => {
      // Pro routing — tier='pro' is authoritative; fall through to the
      // legacy is_pro boolean and the hardcoded PRO_MODULES list so
      // rows not yet migrated still land in the Pro section.
      const isProRow = m.tier === 'pro' || m.is_pro || PRO_MODULES.includes(m.id)
      if (isProRow) {
        proModules.push(m)
        return
      }
      // Basics + Standard belong in a chapter. A row with no chapter
      // assignment drops off the page (admin can fix in the editor).
      if (!m.chapter) return
      if (!chapterMap[m.chapter]) {
        chapterMap[m.chapter] = {
          number: m.chapter,
          label: m.chapter_label_en || `Chapter ${m.chapter}`,
          subtitle: m.chapter_subtitle_en || '',
          modules: [],
        }
      }
      chapterMap[m.chapter].modules.push(m)
    })

  // Within each chapter, Basics come first (so the "must-do" rows lead
  // visually), then everything else by sort_order. Across chapters,
  // chapters render in numeric order.
  const chapters = Object.values(chapterMap)
    .sort((a, b) => a.number - b.number)
    .map((ch) => ({
      ...ch,
      modules: ch.modules.sort((a, b) => {
        const aBasics = a.tier === 'basics' ? 0 : 1
        const bBasics = b.tier === 'basics' ? 0 : 1
        if (aBasics !== bBasics) return aBasics - bBasics
        return (a.sort_order || 0) - (b.sort_order || 0)
      }),
    }))

  const hasContent = chapters.length > 0 || proModules.length > 0

  const handleModuleClick = (mod) => {
    navigate(`/learn/${mod.id}?lang=${lang}`)
  }

  const isCertReady = totalModules > 0 && completedCount >= totalModules

  return (
    <div style={{
      minHeight: '100vh',
      background: S.base,
      maxWidth: 680,
      margin: '0 auto',
      paddingBottom: 80,
    }}>
      {/* ── Hero ──────────────────────────────────────────────── */}
      <div style={{
        padding: '32px 20px 24px',
        borderBottom: `1px solid ${S.border}`,
        background: S.base,
        position: 'relative',
      }}>
        {/* Language picker — top-right, minimal style */}
        <div style={{
          position: 'absolute',
          top: 20,
          right: 16,
          display: 'flex',
          gap: 2,
        }}>
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              title={l.full}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 7px',
                fontSize: 11,
                color: lang === l.code ? S.ink : S.textFaint,
                fontWeight: lang === l.code ? 700 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: '0.04em',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>

        {/* Academy wordmark */}
        <div style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: S.textMuted,
          marginBottom: 8,
          fontFamily: 'inherit',
        }}>
          PineX Academy
        </div>

        {/* Human headline */}
        <h1 style={{
          fontSize: 26,
          fontWeight: 700,
          color: S.ink,
          lineHeight: 1.25,
          margin: 0,
          marginBottom: 6,
        }}>
          The market has a structure.<br />
          Most people never see it.
        </h1>

        <p style={{
          fontSize: 14,
          color: S.textMuted,
          margin: 0,
          lineHeight: 1.6,
          marginBottom: (user && totalModules > 0) || proModules.length > 0 ? 12 : 0,
        }}>
          Eight modules. One method. Read in order.
        </p>

        {/* Pro visibility toggle — only render when Pro modules exist,
            so the control doesn't appear on an empty curriculum. The
            choice is stored per-device in localStorage. */}
        {proModules.length > 0 && (
          <button
            type="button"
            onClick={toggleShowPro}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              marginBottom: user && totalModules > 0 ? 16 : 0,
              fontSize: 12,
              color: S.accent,
              fontFamily: 'inherit',
              cursor: 'pointer',
              letterSpacing: '0.02em',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {showPro
              ? `Hide Pro module${proModules.length === 1 ? '' : 's'}`
              : `Show ${proModules.length} Pro module${proModules.length === 1 ? '' : 's'}`}
          </button>
        )}

        {/* Progress bar */}
        {user && totalModules > 0 && (
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
              fontSize: 12,
              color: S.textMuted,
            }}>
              <span>{completedCount} of {totalModules} complete</span>
              <span>{Math.round(completedCount / totalModules * 100)}%</span>
            </div>
            <div style={{
              height: 3,
              background: S.border,
              borderRadius: 0,
            }}>
              <div style={{
                height: 3,
                width: `${(completedCount / totalModules) * 100}%`,
                background: S.accent,
                transition: 'width 0.6s ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      {loading ? (
        <div style={{
          padding: 40,
          textAlign: 'center',
          color: S.textMuted,
          fontSize: 13,
          background: S.surface,
        }}>
          Loading…
        </div>
      ) : !hasContent ? (
        <div style={{
          padding: '24px 20px',
          color: S.textMuted,
          background: S.surface,
          borderBottom: `1px solid ${S.border}`,
          fontSize: 13,
          lineHeight: 1.6,
          textAlign: 'center',
        }}>
          {lang === 'en' && 'Modules are being prepared. Check back soon.'}
          {lang === 'hi' && 'Modules जल्द ही उपलब्ध होंगे।'}
          {lang === 'ml' && 'Modules ഉടൻ ലഭ്യമാകും.'}
          {lang === 'ta' && 'Modules விரைவில் வரும்.'}
        </div>
      ) : (
        <>
          {/* ── Chapters (DB-driven) ──────────────────────────── */}
          {chapters.map((chapter) => (
            <Chapter
              key={chapter.number}
              chapter={chapter}
              lang={lang}
              progress={progress}
              onModuleClick={handleModuleClick}
            />
          ))}

          {/* ── Pro Modules ───────────────────────────────────── */}
          {/* Gated by the per-device showPro toggle in the hero — when
              the user hides Pro, the section vanishes entirely (the
              hero toggle is how they bring it back). */}
          {proModules.length > 0 && showPro && (
            <div style={{ borderTop: `2px solid ${S.borderDark}` }}>
              <div style={{
                padding: '24px 20px 12px',
                borderBottom: `1px solid ${S.border}`,
                background: S.surface,
              }}>
                <div style={{
                  fontSize: 10,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: S.accent,
                  fontWeight: 600,
                  marginBottom: 4,
                }}>
                  Pro
                </div>
                <div style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: S.ink,
                  marginBottom: 2,
                }}>
                  Pro Modules
                </div>
                <div style={{
                  fontSize: 13,
                  color: S.textMuted,
                  fontStyle: 'italic',
                }}>
                  Advanced tools for paying members.
                </div>
              </div>
              {proModules
                .slice()
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((module, idx, arr) => (
                  <ModuleRow
                    key={module.id}
                    module={module}
                    title={module[`title_${lang}`] || module.title_en || module.title || ''}
                    index={idx}
                    progress={progress?.[module.id]}
                    onClick={() => handleModuleClick(module)}
                    isLast={idx === arr.length - 1}
                  />
                ))}
            </div>
          )}

          {/* ── Special Topics ────────────────────────────────── */}
          <div style={{
            borderTop: `2px solid ${S.borderDark}`,
          }}>
            <div style={{
              padding: '24px 20px 12px',
              borderBottom: `1px solid ${S.border}`,
              background: S.surface,
            }}>
              <div style={{
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: S.textMuted,
                fontWeight: 600,
                marginBottom: 4,
              }}>
                Special Topics
              </div>
              <div style={{
                fontSize: 17,
                fontWeight: 700,
                color: S.ink,
                marginBottom: 2,
              }}>
                Going Deeper
              </div>
              <div style={{
                fontSize: 13,
                color: S.textMuted,
                fontStyle: 'italic',
              }}>
                Optional. Return after completing the main curriculum.
              </div>
            </div>

            {SPECIAL_TOPICS.map((topic, idx, arr) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => navigate(topic.path)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '16px 20px',
                  background: S.surface,
                  borderTop: 'none',
                  borderLeft: 'none',
                  borderRight: 'none',
                  borderBottom: idx < arr.length - 1 ? `1px solid ${S.border}` : 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = S.hover }}
                onMouseLeave={(e) => { e.currentTarget.style.background = S.surface }}
              >
                <div style={{
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${S.border}`,
                  borderRadius: '50%',
                  fontSize: 14,
                  color: S.textMuted,
                  lineHeight: 1,
                }}>
                  +
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: S.ink,
                    marginBottom: 2,
                  }}>
                    {topic.title}
                  </div>
                  <div style={{
                    fontSize: 12,
                    color: S.textMuted,
                  }}>
                    {topic.subtitle} · {topic.duration}
                  </div>
                </div>
                <div style={{
                  color: S.textFaint,
                  fontSize: 16,
                  flexShrink: 0,
                }}>
                  →
                </div>
              </button>
            ))}
          </div>

          {/* ── Certification ─────────────────────────────────── */}
          <div
            onClick={isCertReady ? () => navigate('/certificate') : undefined}
            style={{
              padding: '28px 20px',
              borderTop: `2px solid ${S.borderDark}`,
              background: S.base,
              textAlign: 'center',
              cursor: isCertReady ? 'pointer' : 'default',
            }}
          >
            <div style={{
              fontSize: 13,
              fontWeight: 700,
              color: S.ink,
              marginBottom: 6,
            }}>
              Complete all modules to earn your certificate
            </div>
            <div style={{
              fontSize: 12,
              color: S.textMuted,
              lineHeight: 1.6,
              marginBottom: 16,
            }}>
              PineX Certified — Market Structure Analysis
            </div>
            <div style={{
              display: 'inline-block',
              border: `1px solid ${S.borderDark}`,
              borderRadius: 4,
              padding: '8px 20px',
              fontSize: 12,
              color: S.textMuted,
              fontStyle: 'italic',
            }}>
              {isCertReady
                ? 'Ready to certify →'
                : `${totalModules - completedCount} modules remaining`}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Small inline section header — keeps the file self-contained ──
function SectionHeader({ icon, title, subtitle, marginTop = 0 }) {
  return (
    <div style={{ marginTop, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
      {icon && (
        <div
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <i className={`ti ${icon}`} style={{ fontSize: 14, color: 'var(--text-muted)' }} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
          {title}
        </p>
        {subtitle && (
          <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-hint)', letterSpacing: '0.02em' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
