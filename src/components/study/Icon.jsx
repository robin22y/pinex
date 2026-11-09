/**
 * Icon — small decorative line icons keyed by icon_key (site_content,
 * study_series, site_updates). Unknown or empty keys render nothing.
 * Always aria-hidden: the adjacent text carries the meaning.
 */
const PATHS = {
  document: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  people: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3 3-5 6-5s6 2 6 5 M17 11a2.5 2.5 0 1 0 0-5 M16 15c3 0 5 2 5 5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  chart: 'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5',
  check: 'M4 12l5 5L20 6',
  factory: 'M3 21V10l6 4V10l6 4V5h6v16z',
  leaf: 'M5 19c0-9 6-14 15-14 0 9-5 15-14 15z M5 19l7-7',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  flask: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3',
}

export default function Icon({ name, size = 20, className }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      className={`st-icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
