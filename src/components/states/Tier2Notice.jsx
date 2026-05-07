import { C } from '../../styles/tokens'

export default function Tier2Notice() {
  return (
    <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: C.blue, background: C.blueBg, color: C.blue }}>
      Basic data only for this company.
      <br />
      Full analysis available for Nifty 500 companies.
    </div>
  )
}
