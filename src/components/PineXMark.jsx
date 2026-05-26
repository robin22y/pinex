/**
 * PineXMark — the PineX wordmark with the lowercase "p" lead-in and
 * a heavier, green, slightly-larger "X" terminator.
 *
 * Renders inline so it inherits font-family + base font-size + line-
 * height + letter-spacing from the parent <span> / <p> / <h…> it sits
 * inside. Only the X overrides colour, weight, and size — everything
 * else stays consistent with whatever surface the mark lives on
 * (sidebar logo, share card, login hero, etc.).
 *
 * Props:
 *   xScale  (number)  X size as a multiple of the surrounding letters.
 *                     Default 1.18 — large enough to read as a brand
 *                     accent without breaking baseline alignment.
 *   xColor  (string)  CSS colour for the X. Defaults to the app's
 *                     primary green accent (`var(--accent)`).
 *   xWeight (number)  Weight for the X. Default 900 (heavier than the
 *                     usual 700–800 used on the surrounding letters
 *                     so it reads as deliberately bold).
 */
export default function PineXMark({
  xScale  = 1.18,
  xColor  = 'var(--accent)',
  xWeight = 900,
}) {
  return (
    <>
      <span>pine</span>
      <span
        aria-hidden="false"
        style={{
          color: xColor,
          fontWeight: xWeight,
          fontSize: `${xScale}em`,
          // Reset letter-spacing locally — the inflated X looks
          // crowded if it inherits a tight negative tracking from
          // the parent wordmark.
          letterSpacing: '0',
          // Slight downward nudge keeps the larger letter visually
          // sitting on the same baseline as "pine".
          verticalAlign: 'baseline',
          display: 'inline-block',
          lineHeight: 1,
        }}
      >
        X
      </span>
    </>
  )
}
