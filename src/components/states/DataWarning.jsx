import { C } from '../../styles/tokens'

export default function DataWarning() {
  return (
    <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.amberBorder, background: C.amberBg, color: C.amber }}>
      ⚠️ This data is under verification
    </div>
  )
}
