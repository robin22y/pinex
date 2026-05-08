export default function DataWarning({ message = '' }) {
  const normalized = String(message || '').toLowerCase()
  const label = normalized.includes('manual') ? 'Source: Manual Entry' : 'Delayed Data'
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {label}
    </span>
  )
}
