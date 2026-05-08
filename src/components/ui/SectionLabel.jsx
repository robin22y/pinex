export default function SectionLabel({ text, action = null }) {
  return (
    <div className="mb-3 border-b border-slate-100 pb-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{text}</p>
        {action ? <div className="text-xs text-sky-400">{action}</div> : null}
      </div>
    </div>
  )
}
