import { C } from '../../styles/tokens'

export default function NoData() {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: C.border, background: C.surface2 }}>
      <p className="text-sm" style={{ color: C.textMuted }}>
        Data for this section is being updated.
        <br />
        Check back in a few hours.
      </p>
    </div>
  )
}
