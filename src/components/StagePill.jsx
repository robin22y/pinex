import { canonicalStageForBadge, stageBadge, STAGE_EMERGING_TITLE } from '../lib/stageUi'

/**
 * Small stage chip using shared palette (`stageBadge` in `stageUi`).
 * @param {{ stage?: string|null, title?: string, className?: string, children?: React.ReactNode }} props
 */
export default function StagePill({ stage, title: titleOverride, className = '' }) {
  const { bg, color, label } = stageBadge(stage)
  const isEmerging = canonicalStageForBadge(stage) === 'Stage 1+'
  const title = titleOverride ?? (isEmerging ? STAGE_EMERGING_TITLE : undefined)
  const canon = canonicalStageForBadge(stage)
  const uppercase = canon === 'Stage 1+' || canon === 'Unclassified' ? '' : 'uppercase tracking-wide'
  return (
    <span
      title={title}
      role="presentation"
      className={`inline-flex max-w-[14rem] shrink-0 items-center justify-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold sm:text-[11px] ${uppercase} ${className}`}
      style={{
        background: bg,
        color,
        borderColor: `${color}80`,
      }}
    >
      {label}
    </span>
  )
}
