import { C, statusBg, statusColor } from '../../styles/tokens'

const DOT_BG = {
  green: C.green,
  amber: C.amber,
  red: C.red,
  blue: C.blue,
  neutral: C.textMuted,
}

const BG = {
  green: statusBg('green'),
  amber: statusBg('amber'),
  red: statusBg('red'),
  blue: C.blueBg,
  neutral: C.surface2,
}

const FG = {
  green: statusColor('green'),
  amber: statusColor('amber'),
  red: statusColor('red'),
  blue: C.blue,
  neutral: C.textMuted,
}

export default function Badge({ status = 'neutral', text, size = 'sm' }) {
  const isMd = size === 'md'
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full ${isMd ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'}`}
      style={{
        background: BG[status] ?? BG.neutral,
        color: FG[status] ?? FG.neutral,
        border: `1px solid ${C.border}`,
      }}
    >
      <span
        className={`inline-block rounded-full ${isMd ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
        style={{ background: DOT_BG[status] ?? DOT_BG.neutral }}
      />
      {text}
    </span>
  )
}
