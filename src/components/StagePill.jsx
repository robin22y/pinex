import { canonicalStageForBadge, stageBadge, STAGE_EMERGING_TITLE } from '../lib/stageUi'

/**
 * Small stage chip using shared palette (`stageBadge` in `stageUi`).
 * @param {{ stage?: string|null, title?: string, className?: string, children?: React.ReactNode }} props
 */
export default function StagePill({ stage, title: titleOverride, className = '' }) {
  // `bg` (filled fill colour) deliberately destructured but not
  // applied — the chip is border-only now per the design refresh:
  // transparent background, 1px solid stage colour, text in the
  // same stage colour. Keeps padding / radius / typography intact.
  // eslint-disable-next-line no-unused-vars
  const { bg: _bg, color, label } = stageBadge(stage)
  const isEmerging = canonicalStageForBadge(stage) === 'Stage 1+'
  const title = titleOverride ?? (isEmerging ? STAGE_EMERGING_TITLE : undefined)
  // Previously the chip uppercased every label so "STAGE 2" read
  // as a hard label. With the new PineX cycle vocabulary
  // (Basing / Advancing / Topping / Declining) the words carry
  // their own emphasis and title case is much more legible than
  // "ADVANCING". Tracking-wide kept because the chip is small and
  // benefits from the extra letter-spacing.
  //
  // MALAYALAM LAYOUT SAFETY — verified during the Gemini UI audit:
  //   - No fixed width / height; only max-w-[14rem] (soft cap) +
  //     px-2.5 py-0.5 padding so the chip grows with longer labels.
  //   - No whitespace-nowrap, so a long Malayalam phase label can
  //     wrap inside the cap rather than clipping.
  //   - No overflow:hidden — descenders / ascenders render fully.
  return (
    <span
      title={title}
      role="presentation"
      className={`inline-flex max-w-[14rem] shrink-0 items-center justify-center rounded-[3px] border px-2.5 py-0.5 text-[10px] font-bold sm:text-[11px] tracking-wide ${className}`}
      style={{
        background: 'transparent',
        color,
        borderColor: color,
      }}
    >
      {label}
    </span>
  )
}
