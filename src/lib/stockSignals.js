/** Normalize quarterly_changes.signal_panel from DB (JSON array or string). */
export function parseSignalPanel(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw)
      return Array.isArray(p) ? p : []
    } catch {
      return []
    }
  }
  return []
}

function vn(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Map DB row to { name, label, status, description } for At a glance UI.
 * Supports common shapes: { name, label, status, description }, { name, status_label, status }.
 */
export function normalizeSignalRow(row, fallbackName) {
  if (!row || typeof row !== 'object') return null
  const rawSt = String(row.status || row.signal_status || row.colour || row.color || 'neutral').toLowerCase()
  const status = rawSt === 'yellow' ? 'amber' : rawSt
  const st = status === 'green' || status === 'amber' || status === 'red' ? status : 'neutral'
  return {
    name: String(row.name || row.title || row.signal_name || fallbackName || 'Signal'),
    label: String(row.label || row.status_label || row.value || '—'),
    status: st,
    description: row.description != null ? String(row.description) : row.detail != null ? String(row.detail) : '',
  }
}

/**
 * Build 5 synthetic signals when signal_panel is empty.
 * deliveryAvg: avg_delivery_30d from delivery_signals (0–100 scale).
 */
export function buildSyntheticSignals({
  financials = [],
  deliveryAvg = null,
  priceLatest = null,
  latestShare = null,
  prevShare = null,
}) {
  const slice = financials.slice(0, 3)
  const revs = slice.map((r) => vn(r?.revenue))
  let revSignal = { status: 'amber', label: 'Mixed trend', description: 'Not enough revenue history.' }
  if (revs.filter((x) => x > 0).length >= 2) {
    const up = revs[0] > revs[1] && revs[1] > revs[2]
    const down = revs[0] < revs[1] && revs[1] < revs[2]
    const up2 = revs[0] > revs[1]
    const down2 = revs[0] < revs[1]
    if (up || (up2 && revs.length === 2)) {
      revSignal = {
        status: 'green',
        label: 'Growing consistently',
        description: 'Last 3 quarters show revenue growth.',
      }
    } else if (down || (down2 && revs.length === 2)) {
      revSignal = {
        status: 'red',
        label: 'Revenue declining',
        description: 'Revenue trend turned down in recent quarters.',
      }
    } else {
      revSignal = {
        status: 'amber',
        label: 'Mixed trend',
        description: 'Revenue path is uneven quarter to quarter.',
      }
    }
  }

  const margins = slice.map((row) => {
    const rev = vn(row?.revenue)
    const pat = vn(row?.pat ?? row?.net_profit)
    return rev > 0 ? (pat / rev) * 100 : null
  })
  const validM = margins.filter((m) => m != null && Number.isFinite(m))
  let marginSignal = { status: 'amber', label: 'Stable margins', description: 'Insufficient margin history.' }
  if (validM.length >= 2) {
    const m0 = validM[0]
    const mLast = validM[validM.length - 1]
    const diff = m0 - mLast
    if (diff > 1) {
      marginSignal = {
        status: 'green',
        label: 'Margins expanding',
        description: 'Net margin improved vs prior quarters.',
      }
    } else if (diff < -1) {
      marginSignal = {
        status: 'red',
        label: 'Margins under pressure',
        description: 'Net margin compressed recently.',
      }
    } else {
      marginSignal = {
        status: 'amber',
        label: 'Stable margins',
        description: 'Margins within a tight band.',
      }
    }
  }

  const avgD = deliveryAvg != null && Number.isFinite(Number(deliveryAvg)) ? Number(deliveryAvg) : null
  let delSignal = {
    status: 'amber',
    label: 'Moderate delivery',
    description: 'Delivery data not available.',
  }
  if (avgD != null) {
    if (avgD > 45) {
      delSignal = {
        status: 'green',
        label: 'Sustained investor delivery',
        description: '30d average delivery is above typical levels.',
      }
    } else if (avgD >= 30) {
      delSignal = {
        status: 'amber',
        label: 'Moderate delivery',
        description: 'Delivery is in a middling range.',
      }
    } else {
      delSignal = {
        status: 'red',
        label: 'Low investor delivery',
        description: '30d average delivery is on the low side.',
      }
    }
  }

  const stageRaw = String(priceLatest?.stage || '').toLowerCase().replace(/\s+/g, '')
  const obvTrend = String(priceLatest?.obv_trend || '').toLowerCase()
  const obvSlope = vn(priceLatest?.obv_slope)
  let stageSignal = { status: 'amber', label: 'Building base', description: 'Stage or trend unclear.' }
  if (stageRaw === 'stage2' && (obvTrend === 'rising' || obvSlope > 0.01)) {
    stageSignal = {
      status: 'green',
      label: 'Advancing confirmed',
      description: 'Advancing phase with supportive OBV.',
    }
  } else if (stageRaw === 'stage1') {
    stageSignal = {
      status: 'amber',
      label: 'Building base',
      description: 'Stage 1 — early structure.',
    }
  } else if (stageRaw === 'stage3' || stageRaw === 'stage4') {
    stageSignal = {
      status: 'red',
      label: 'Downtrend',
      description: 'Later stage — volume decline or relative softness vs prior phase.',
    }
  }

  const promoterNow = vn(latestShare?.promoter_pct)
  const promoterPrev = vn(prevShare?.promoter_pct)
  const pledgeNow = vn(latestShare?.promoter_pledge_pct)
  const pledgePrev = vn(prevShare?.promoter_pledge_pct)
  const fiiNow = vn(latestShare?.fii_pct)
  const fiiPrev = vn(prevShare?.fii_pct)

  let concerns = 0
  if (promoterPrev > 0 && promoterNow < promoterPrev - 0.2) concerns += 1
  if (pledgeNow > pledgePrev + 0.3) concerns += 1
  if (fiiPrev > 0 && fiiNow < fiiPrev - 0.5) concerns += 1

  let riskSignal = {
    status: 'green',
    label: 'No major red flags',
    description: 'Promoter, pledge, and FII moves look calm.',
  }
  if (concerns >= 2) {
    riskSignal = {
      status: 'red',
      label: 'Risk signals present',
      description: 'Multiple ownership or flow concerns flagged.',
    }
  } else if (concerns === 1) {
    riskSignal = {
      status: 'amber',
      label: 'Monitor closely',
      description: 'One ownership or flow point worth watching.',
    }
  }

  return [
    { key: 'rev', name: 'Revenue quality', ...revSignal },
    { key: 'margin', name: 'Margin trend', ...marginSignal },
    { key: 'delivery', name: 'Delivery behaviour', ...delSignal },
    { key: 'stage', name: 'Stage momentum', ...stageSignal },
    { key: 'risk', name: 'Risk flags', ...riskSignal },
  ]
}

export function mergeSignalPanel(rawPanel, syntheticFallback) {
  const parsed = parseSignalPanel(rawPanel)
  const normalized = parsed
    .slice(0, 5)
    .map((r, i) => normalizeSignalRow(r, syntheticFallback[i]?.name || `Signal ${i + 1}`))
    .filter(Boolean)
  if (!normalized.length) return syntheticFallback
  return Array.from({ length: 5 }, (_, i) => {
    const s = normalized[i]
    if (s) return s
    const fb = syntheticFallback[i]
    return fb || { name: '—', label: '—', status: 'neutral', description: '' }
  })
}
