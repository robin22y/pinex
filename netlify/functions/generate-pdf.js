const React = require('react')
const { createClient } = require('@supabase/supabase-js')
const {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} = require('@react-pdf/renderer')

const FREE_DOWNLOADS_PER_MONTH = 5

try {
  Font.register({
    family: 'Helvetica',
    fonts: [{ src: 'Helvetica' }],
  })
} catch {
  // safe no-op
}

const styles = StyleSheet.create({
  page: { padding: 28, backgroundColor: '#0D1525', color: '#E2E8F0', fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  logo: { fontSize: 14, color: '#38BDF8', fontWeight: 700 },
  smallMuted: { fontSize: 9, color: '#94A3B8' },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 6 },
  sub: { fontSize: 10, color: '#94A3B8', marginBottom: 12 },
  section: { marginTop: 10, borderTop: '1 solid #1E293B', paddingTop: 8 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  p: { fontSize: 10, lineHeight: 1.5, marginBottom: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cell: { fontSize: 9, color: '#E2E8F0', flex: 1 },
  tableHead: { fontSize: 9, color: '#94A3B8', marginBottom: 2 },
  footer: { marginTop: 12, borderTop: '1 solid #1E293B', paddingTop: 8 },
})

function toArray(value) {
  return Array.isArray(value) ? value : []
}

function formatNum(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}

function buildDoc(payload) {
  const {
    symbol,
    companyData = {},
    financials = [],
    shareholding = [],
    changes = {},
    signals = [],
    delivery = {},
    swingConditions = {},
  } = payload

  const generatedAt = new Date().toLocaleString()
  const changeList = toArray(changes.changes)
  const aiSummary = String(changes.ai_summary || '').trim()
  const sigRows = toArray(signals).slice(0, 5)
  const finRows = toArray(financials).slice(0, 8)
  const shRows = toArray(shareholding).slice(0, 4)

  const swingChecks = [
    ['Stage 2 active', Boolean(swingConditions.condition_stage2)],
    ['Delivery above average', Boolean(swingConditions.condition_delivery_above_avg)],
    ['Near 20-day MA', Boolean(swingConditions.condition_near_ma20)],
    ['RSI 40-65', Boolean(swingConditions.condition_rsi_healthy)],
    ['Volume contracting on pullback', Boolean(swingConditions.condition_volume_contracting)],
  ]

  return React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      React.createElement(
        View,
        { style: styles.headerRow },
        React.createElement(Text, { style: styles.logo }, 'PineX'),
        React.createElement(Text, { style: styles.smallMuted }, `Generated: ${generatedAt}`),
      ),
      React.createElement(
        Text,
        { style: styles.title },
        `${companyData.name || symbol || 'Company'} (${symbol || '-'})`,
      ),
      React.createElement(Text, { style: styles.sub }, `Sector: ${companyData.sector || '-'}`),
      React.createElement(Text, { style: styles.p }, companyData.description || companyData.description_ai || 'No description available.'),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'What Changed'),
        React.createElement(Text, { style: styles.p }, `Headline: ${String(changes.headline || '-').replace(/_/g, ' ')}`),
        ...changeList.slice(0, 8).map((c, idx) =>
          React.createElement(Text, { key: `change-${idx}`, style: styles.p }, `- ${String(c.type || 'change').replace(/_/g, ' ')} (${c.severity || '-'})`),
        ),
        aiSummary ? React.createElement(Text, { style: styles.p }, `AI Summary: ${aiSummary}`) : null,
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Signal Panel'),
        ...sigRows.map((s, idx) =>
          React.createElement(
            Text,
            { key: `sig-${idx}`, style: styles.p },
            `${s.name || 'Signal'}: ${s.label || '-'} (${s.status || '-'})`,
          ),
        ),
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Revenue (Last 8 Quarters)'),
        React.createElement(
          View,
          { style: styles.row },
          React.createElement(Text, { style: styles.tableHead }, 'Quarter'),
          React.createElement(Text, { style: styles.tableHead }, 'Revenue'),
          React.createElement(Text, { style: styles.tableHead }, 'PAT'),
          React.createElement(Text, { style: styles.tableHead }, 'Margin'),
        ),
        ...finRows.map((f, idx) =>
          React.createElement(
            View,
            { key: `fin-${idx}`, style: styles.row },
            React.createElement(Text, { style: styles.cell }, f.quarter_name || '-'),
            React.createElement(Text, { style: styles.cell }, formatNum(f.revenue)),
            React.createElement(Text, { style: styles.cell }, formatNum(f.net_profit)),
            React.createElement(Text, { style: styles.cell }, `${formatNum(f.margin)}%`),
          ),
        ),
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Shareholding (Last 4 Quarters)'),
        ...shRows.map((s, idx) =>
          React.createElement(
            Text,
            { key: `sh-${idx}`, style: styles.p },
            `${s.quarter_name || '-'} | Promoter ${formatNum(s.promoter_pct)}% | FII ${formatNum(s.fii_pct)}% | DII ${formatNum(s.dii_pct)}%`,
          ),
        ),
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Delivery Data'),
        React.createElement(Text, { style: styles.p }, `Today: ${formatNum(delivery.today)}%`),
        React.createElement(Text, { style: styles.p }, `7-day avg: ${formatNum(delivery.week_avg)}%`),
        React.createElement(Text, { style: styles.p }, `30-day avg: ${formatNum(delivery.month_avg)}%`),
        React.createElement(Text, { style: styles.p }, `vs 30d avg: ${formatNum(delivery.vs_30d_avg)}x`),
      ),

      React.createElement(
        View,
        { style: styles.section },
        React.createElement(Text, { style: styles.sectionTitle }, 'Swing Conditions'),
        ...swingChecks.map(([label, ok], idx) =>
          React.createElement(Text, { key: `sw-${idx}`, style: styles.p }, `${ok ? '✓' : '□'} ${label}`),
        ),
      ),

      React.createElement(
        View,
        { style: styles.footer },
        React.createElement(Text, { style: styles.smallMuted }, 'Data sourced from NSE, BSE, and public company filings.'),
        React.createElement(Text, { style: styles.smallMuted }, 'AI-generated summaries are for information only. This is not investment advice.'),
        React.createElement(Text, { style: styles.smallMuted }, 'Please consult a SEBI registered investment adviser before making any investment decision.'),
      ),
    ),
  )
}

async function resolveProfile(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return { profile: null, userId: null, error: null }

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) return { profile: null, userId: null, error: 'Missing Supabase env' }

  const admin = createClient(url, serviceKey)
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user?.id) return { profile: null, userId: null, error: 'Invalid auth token' }

  const userId = userData.user.id
  const { data: profile } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
  return { profile: profile || null, userId, error: null, admin }
}

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'Method not allowed' }

  try {
    const payload = JSON.parse(event.body || '{}')
    if (!payload?.symbol) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing symbol' }) }
    }

    const { profile, userId, admin, error } = await resolveProfile(event)
    if (error) return { statusCode: 401, headers: cors, body: JSON.stringify({ error }) }

    const isPaid = profile?.plan === 'paid'
    const today = new Date()
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const resetDate = String(profile?.downloads_reset_date || '')
    let count = Number(profile?.downloads_this_month || 0)
    const shouldReset = !resetDate || resetDate < todayKey
    if (shouldReset) count = 0

    if (!isPaid && count >= FREE_DOWNLOADS_PER_MONTH) {
      return {
        statusCode: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Monthly free download limit exceeded.' }),
      }
    }

    const doc = buildDoc(payload)
    const buffer = await pdf(doc).toBuffer()

    if (admin && userId) {
      await admin
        .from('profiles')
        .update({
          downloads_this_month: count + 1,
          downloads_reset_date: todayKey,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${payload.symbol}_PineX_Report.pdf"`,
      },
      isBase64Encoded: true,
      body: Buffer.from(buffer).toString('base64'),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err?.message || err) }),
    }
  }
}
