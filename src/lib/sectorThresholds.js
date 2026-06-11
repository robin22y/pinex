// Minimum number of stocks a sector needs before its breadth %
// is treated as a meaningful signal. Below this, one or two
// outliers swing the percentage wildly (1/1 = 100% looks
// "Strong" but says nothing about market participation).
//
// The threshold is shared across:
//   - SectorBreadth.jsx (separates Strong/Mixed/Weak from "Small Sectors")
//   - SectorDetail.jsx (top-of-page warning banner)
//   - SectorHealthRow.jsx (greys out the bar on stock pages)
//   - SectorPulse.jsx (filters small sectors out of the picks)
//   - HeatMap.jsx (tile opacity marker; checkbox label)
//   - scripts/telegram_bot.py (mirrors this constant)
export const MEANINGFUL_SECTOR_MIN = 5

export function isSmallSector(totalCompanies) {
  const n = Number(totalCompanies)
  return Number.isFinite(n) && n < MEANINGFUL_SECTOR_MIN
}
