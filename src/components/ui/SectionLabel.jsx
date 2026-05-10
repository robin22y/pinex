import { C } from '../../styles/tokens'

export default function SectionLabel({ text, action = null }) {
  return (
    <div className="mb-3 border-b pb-2" style={{ borderColor: C.border }}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.textMuted }}>
          {text}
        </p>
        {action ? <div className="text-xs" style={{ color: C.blue }}>{action}</div> : null}
      </div>
    </div>
  )
}
