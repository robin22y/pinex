/**
 * Fixtures for the Company Study components.
 *
 * ENTIRELY FICTIONAL. "Example Materials Ltd" (EXMAT) and "Example
 * Instruments Inc." (EXIN) are invented; every name, figure, date and URL
 * here is made up for testing formatting and layout. None of it describes a
 * real company. URLs use the reserved example.com / example.org domains.
 *
 * Shapes mirror scripts/sql/studies_v3_standalone.sql.
 */

// ── Media (study_media objects) ─────────────────────────────────────────

const media = (name, width, height, extra = {}) => ({
  id: `m-${name}`,
  storage_path: `https://example.com/media/${name}.jpg`,
  variants: [640, 1280].flatMap((w) =>
    ['avif', 'webp', 'jpeg'].map((format) => ({
      width: w,
      path: `https://example.com/media/${name}-${w}.${format === 'jpeg' ? 'jpg' : format}`,
      format,
    })),
  ),
  width,
  height,
  alt_text: `Fictional illustration: ${name.replace(/-/g, ' ')}`,
  credit: 'Illustration: PineX (fictional test image)',
  caption: null,
  focal_x: 0.5,
  focal_y: 0.5,
  ...extra,
})

export const mediaHero = media('exmat-plant', 1600, 1000, {
  caption: 'The original plant, as described in the FY24 annual report.',
  focal_y: 0.35,
})
export const mediaLogo = {
  ...media('exmat-logo', 200, 200),
  variants: [{ width: 200, path: 'https://example.com/media/exmat-logo.png', format: 'png' }],
}
export const mediaFounder = media('founder-portrait', 400, 400, { focal_y: 0.3 })
export const mediaProduct = media('heatbind-sample', 1200, 800)
export const mediaTimeline = media('pilot-line', 1200, 675)
// Missing credit — components must refuse to render it.
export const mediaNoCredit = { ...media('no-credit', 400, 400), credit: '  ' }
// Missing alt text — likewise.
export const mediaNoAlt = { ...media('no-alt', 400, 400), alt_text: '' }

// ── 1. INR / crore — full study ─────────────────────────────────────────

const C1 = 'c0000000-0000-4000-8000-000000000001'
const src = (n) => `s0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const fy = (year, v, extra = {}) => ({
  id: `fy-${year}-${extra.revision ?? 1}`,
  study_company_id: C1,
  period_end: `${year}-03-31`,
  period_type: 'FY',
  fiscal_label: `FY${String(year).slice(2)}`,
  basis: 'consolidated',
  currency: null,
  unit: null,
  source_id: src(1),
  revision: 1,
  ...v,
  ...extra,
})

const q = (end, label, v) => ({
  id: `q-${end}`,
  study_company_id: C1,
  period_end: end,
  period_type: 'Q',
  fiscal_label: label,
  basis: 'consolidated',
  source_id: src(2),
  revision: 1,
  ...v,
})

const sh = (end, rows) =>
  Object.entries(rows).map(([category, pct], i) => ({
    id: `sh-${end}-${category}`,
    study_company_id: C1,
    sort_order: i,
    period_end: end,
    category,
    pct: Array.isArray(pct) ? pct[0] : pct,
    pledged_pct: Array.isArray(pct) ? pct[1] : null,
    source_id: src(5),
    revision: 1,
  }))

export const sampleStudyInr = {
  company: {
    id: C1,
    slug: 'example-materials',
    name: 'Example Materials Ltd',
    country: 'IN',
    exchange: 'NSE',
    ticker: 'EXMAT',
    isin: null,
    sector: 'Materials',
    industry: 'Speciality chemicals',
    website: 'https://example.com',
    logo_url: null,
    hero_image_url: 'https://example.com/images/exmat-hero.jpg',
    reporting_currency: 'INR',
    reporting_unit: 'crore',
    accounting_standard: 'ind_as',
    fiscal_year_end_month: 3,
    status: 'published',
    featured: true,
    label: 'Company Study',
    read_time_minutes: null,
    card_title: 'How a binder maker found three markets',
    card_summary: 'A fictional coatings company and the slow work of qualifying new products.',
    hero_image: mediaHero,
    logo_image: mediaLogo,
    card_image: null,
    headline: 'A small coatings supplier that became a specialist in heat-resistant binders.',
    story_hook:
      'For twenty years it made one product for one industry. Then a single customer request changed what the company was.',
    summary: 'Fictional study used to test the PineX study components.',
    story_md: [
      '### Where it started',
      '',
      'Example Materials began in 1998 as a **two-room workshop** making binders for local paint makers.',
      'For most of its first decade, *one customer* took more than half of what it made.',
      '',
      'The shift came when the company was asked to make a binder that could survive 400 °C. It took',
      'three years and, by the founders\' own account in the [FY24 annual report](https://example.com/ar-fy24.pdf),',
      'nearly exhausted the balance sheet.',
      '',
      '### What it makes today',
      '',
      '- Heat-resistant binders for industrial coatings',
      '- Moisture-barrier resins for packaging',
      '- A small but growing line of _battery separator coatings_',
      '',
      'The company describes its process in three steps:',
      '',
      '1. Formulate with the customer',
      '2. Qualify the batch over six to eighteen months',
      '3. Supply under multi-year contracts',
      '',
      'Raw HTML such as <script>alert(1)</script> must render as text, and a [bad link](javascript:alert(1)) must not become a link.',
    ].join('\n'),
    central_question:
      'Can the newer packaging and battery lines grow large enough to make the company less dependent on industrial coatings?',
    then_text: 'One product, one industry, one dominant customer.',
    now_text:
      'Three product lines. Industrial coatings still provide most of the revenue, but no single customer is above 15%.',
    next_text:
      'A second plant is scheduled for FY28. The company has said battery coatings need two more years of customer qualification.',
    reviewed_at: '2026-10-20T09:00:00Z',
    published_at: '2026-10-22T09:00:00Z',
    updated_at: '2026-11-08T06:30:00Z',
    version: 3,
  },

  sources: [
    { id: src(1), kind: 'annual_report', title: 'Annual Report FY26', publisher: 'Example Materials Ltd', url: 'https://example.com/ar-fy26.pdf', document_date: '2026-07-15', page: '42', accessed_on: '2026-10-01', sort_order: 1 },
    { id: src(6), kind: 'annual_report', title: 'Annual Report FY24', publisher: 'Example Materials Ltd', url: 'https://example.com/ar-fy24.pdf', document_date: '2024-07-12', page: '8', accessed_on: '2026-10-01', sort_order: 2 },
    { id: src(2), kind: 'quarterly_result', title: 'Results for the quarter ended 30 Sep 2026', publisher: 'Example Materials Ltd', url: 'https://example.com/q2fy27.pdf', document_date: '2026-11-04', accessed_on: '2026-11-05', sort_order: 1 },
    { id: src(3), kind: 'investor_presentation', title: 'Investor presentation, Q2 FY27', publisher: 'Example Materials Ltd', url: 'https://example.com/ip-q2fy27.pdf', document_date: '2026-11-05', page: '11', sort_order: 1 },
    { id: src(4), kind: 'concall', title: 'Earnings call transcript, Q2 FY27', publisher: 'Example Materials Ltd', url: 'https://example.com/call-q2fy27.pdf', document_date: '2026-11-06', sort_order: 1 },
    { id: src(5), kind: 'shareholding_filing', title: 'Shareholding pattern, Sep 2026', publisher: 'Stock exchange filing', url: 'https://example.org/shp-sep26', document_date: '2026-10-18', archive_url: 'https://example.org/archive/shp-sep26', sort_order: 1 },
    { id: src(7), kind: 'fund_disclosure', title: 'Monthly portfolio disclosure, Sep 2026', publisher: 'Example Mutual Fund', url: 'https://example.org/mf-sep26.xlsx', document_date: '2026-10-10', sort_order: 1 },
    { id: src(8), kind: 'government', title: 'Chemical industry statistics 2025', publisher: 'Example Ministry of Industry', url: 'https://example.org/stats-2025.pdf', document_date: '2025-12-01', sort_order: 1 },
  ],

  founders: [
    { id: 'f1', sort_order: 1, name: 'Asha Example', image_url: null, education: 'Chemical engineering, fictional institute', previous_career: 'Twelve years in a coatings laboratory.', founding_story: 'Started the workshop with a former colleague after a customer asked for a binder nobody locally made.\n\nKept the laboratory next to the plant floor from day one.', current_role: 'Managing Director', source_id: src(6), image: mediaFounder },
    { id: 'f2', sort_order: 2, name: 'Ravi Sample', image_url: 'https://example.com/images/founder-2.jpg', education: 'Commerce graduate', previous_career: 'Ran a distribution business for industrial adhesives.', founding_story: null, current_role: 'Non-executive director', source_id: null, image: mediaNoCredit },
  ],

  timeline: [
    { id: 't1', sort_order: 1, event_year: 1998, title: 'Workshop opens with two reactors', body: 'Supplies binders to three local paint makers.', is_pull_quote: false, source_id: src(6) },
    { id: 't2', sort_order: 2, event_date: '2009-04-01', title: 'First heat-resistant binder qualified', body: 'Three years of trials for one industrial customer.', is_pull_quote: false, source_id: src(6) },
    { id: 't3', sort_order: 3, event_year: 2011, title: '“We nearly ran out of money proving one product.”', body: 'Managing Director, FY24 annual report', is_pull_quote: true, source_id: src(6) },
    { id: 't4', sort_order: 4, event_date: '2018-02-14', title: 'Listed on the exchange', body: null, is_pull_quote: false, source_id: null },
    { id: 't5', sort_order: 5, event_date: '2024-08-01', title: 'Battery coatings pilot line commissioned', body: 'Capacity disclosed as 600 tonnes a year.', is_pull_quote: false, source_id: src(3), image: mediaTimeline },
  ],

  products: [
    { id: 'p1', sort_order: 1, name: 'HeatBind series', category: 'Industrial coatings', description: 'Binders that hold coatings together at high temperatures.', applications: 'Exhaust systems, industrial ovens, chimneys', end_markets: 'Automotive, capital goods', customers_disclosed: 'Not disclosed by name', interesting_fact: 'Each grade takes six to eighteen months to qualify with a customer.', source_id: src(1), image: mediaProduct },
    { id: 'p2', sort_order: 2, name: 'BarrierCoat', category: 'Packaging', description: 'Water-based resins that slow moisture through paper packaging.', applications: 'Food and pharma cartons', end_markets: 'Packaging converters', customers_disclosed: null, interesting_fact: null, source_id: src(3), image: mediaNoAlt },
    { id: 'p3', sort_order: 3, name: 'SepraLayer', category: 'Energy storage', description: 'Ceramic coatings for battery separators, in customer trials.', applications: 'Lithium-ion cells', end_markets: 'Cell makers', customers_disclosed: null, interesting_fact: 'Pilot line only; no commercial supply disclosed yet.', source_id: src(4) },
  ],

  tam: [
    { id: 'm1', sort_order: 1, market: 'High-temperature coating binders', geography: 'India', level: 'tam', estimate_type: 'third_party', inputs: [], calculation: null, result_value: 2400, result_currency: 'INR', result_unit: 'crore', as_of_year: 2025, notes: 'Industry statistics; includes imports.', source_id: src(8) },
    {
      id: 'm2', sort_order: 2, market: 'Battery separator coatings', geography: 'India', level: 'company_opportunity', estimate_type: 'pinex_calc',
      inputs: [
        { label: 'Announced domestic cell capacity', value: 120, unit: 'GWh', source_id: src(8) },
        { label: 'Coating used per GWh (company disclosure)', value: 45, unit: 'tonnes', source_id: src(4) },
        { label: 'Average realisation (company disclosure)', value: 0.055, unit: '₹ crore per tonne', source_id: src(4) },
      ],
      calculation: '120 GWh × 45 tonnes per GWh = 5,400 tonnes.\n5,400 tonnes × ₹0.055 crore per tonne ≈ ₹297 crore a year if all announced capacity is built.',
      result_value: 297, result_currency: 'INR', result_unit: 'crore', as_of_year: 2026, notes: 'An upper bound: assumes all announced capacity is built and uses this type of coating.', source_id: null,
    },
  ],

  financial_periods: [
    fy(2022, { revenue: 812.4, ebitda: 121.9, pat: 70.2, eps: 14.04, other_income: 6.1, total_debt: 210, cash: 34.5, cfo: 88.7, capex: 41.2 }),
    fy(2023, { revenue: 968.0, ebitda: 139.5, pat: 79.8, eps: 15.96, other_income: 7.4, total_debt: 248, cash: 29.1, cfo: 71.3, capex: 96.4 }),
    fy(2024, { revenue: 1043.6, ebitda: 131.2, pat: 66.3, eps: 13.26, other_income: 5.2, total_debt: 305, cash: 22.8, cfo: 102.6, capex: 118.9 }),
    fy(2025, { revenue: 1188.9, ebitda: 171.4, pat: 92.5, eps: 18.5, other_income: 8.8, total_debt: 290, cash: 41.6, cfo: 140.2, capex: 75.0 }),
    // FY26: revision 1 superseded by revision 2 (restated PAT) — only rev 2 may show.
    fy(2026, { revenue: 1342.7, ebitda: 205.1, pat: 101.0, eps: 20.2, other_income: 9.9, total_debt: 262, cash: 58.3, cfo: 166.8, capex: 88.1 }),
    fy(2026, { revenue: 1342.7, ebitda: 205.1, pat: 108.6, eps: 21.72, other_income: 9.9, total_debt: 262, cash: 58.3, cfo: 166.8, capex: 88.1 }, { revision: 2 }),
    // A year outside the 5-year window — must not appear.
    fy(2021, { revenue: 700.1, ebitda: 98.0, pat: 55.0, eps: 11.0, cfo: 60.0, total_debt: 190 }),
    // A standalone row — must be ignored because consolidated exists.
    { ...fy(2026, { revenue: 1200, ebitda: 180, pat: 90 }), id: 'fy-2026-sa', basis: 'standalone' },
    q('2025-09-30', 'Q2 FY26', { revenue: 330.2, ebitda: 49.8, pat: 26.1, eps: 5.22 }),
    q('2026-03-31', 'Q4 FY26', { revenue: 361.0, ebitda: 57.9, pat: 31.4, eps: 6.28 }),
    q('2026-06-30', 'Q1 FY27', { revenue: 352.5, ebitda: 54.6, pat: 29.0, eps: 5.8 }),
    q('2026-09-30', 'Q2 FY27', { revenue: 371.8, ebitda: 61.3, pat: 33.9, eps: 6.78 }),
  ],

  period_notes: [
    {
      id: 'n1', period_end: '2026-09-30', fiscal_label: 'Q2 FY27',
      what_changed_md: 'Revenue rose on **packaging volumes**; industrial coatings were flat.\n\n- Raw material costs eased, per the earnings call\n- The pilot battery line ran at about a third of capacity',
    },
  ],

  segment_periods: [
    { id: 'sg1', period_end: '2025-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Industrial coatings', revenue: 905.3, ebit: 118.0, source_id: src(1), revision: 1 },
    { id: 'sg2', period_end: '2025-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Packaging', revenue: 270.4, ebit: 22.4, source_id: src(1), revision: 1 },
    { id: 'sg3', period_end: '2025-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Energy storage', revenue: 13.2, ebit: -6.1, source_id: src(1), revision: 1 },
    { id: 'sg4', period_end: '2026-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Industrial coatings', revenue: 958.6, ebit: 131.7, source_id: src(1), revision: 1 },
    { id: 'sg5', period_end: '2026-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Packaging', revenue: 352.9, ebit: 33.1, source_id: src(1), revision: 1 },
    { id: 'sg6', period_end: '2026-03-31', period_type: 'FY', basis: 'consolidated', segment_name: 'Energy storage', revenue: 31.2, ebit: -4.8, source_id: src(1), revision: 1 },
  ],

  shareholding: [
    ...sh('2025-09-30', { promoter_insider: [54.2, 0], institutional_foreign: 8.1, institutional_domestic: 11.4, mutual_funds: 7.9, insurance: 1.2, public_retail: 26.3 }),
    ...sh('2025-12-31', { promoter_insider: [54.2, 0], institutional_foreign: 8.6, institutional_domestic: 11.9, mutual_funds: 8.3, insurance: 1.2, public_retail: 25.3 }),
    ...sh('2026-03-31', { promoter_insider: [53.9, 1.5], institutional_foreign: 9.4, institutional_domestic: 12.2, mutual_funds: 8.8, insurance: 1.1, public_retail: 24.5 }),
    ...sh('2026-06-30', { promoter_insider: [53.9, 1.5], institutional_foreign: 9.1, institutional_domestic: 13.0, mutual_funds: 9.6, insurance: 1.0, public_retail: 24.0 }),
    ...sh('2026-09-30', { promoter_insider: [53.9, 0.8], institutional_foreign: 8.7, institutional_domestic: 13.8, mutual_funds: 10.4, insurance: 1.0, public_retail: 23.6 }),
  ],

  ownership_changes: [
    { id: 'o1', sort_order: 1, period_from: '2026-06-30', period_to: '2026-09-30', holder_name: 'Example Growth Fund', holder_type: 'mf', pct_from: 2.1, pct_to: 2.9, change_pct: 0.8, direction: 'increase', profile: 'A domestic small-cap fund, per its monthly disclosure.', source_id: src(7) },
    { id: 'o2', sort_order: 2, period_from: '2026-06-30', period_to: '2026-09-30', holder_name: 'Northern Sample Capital', holder_type: 'fii', pct_from: 1.9, pct_to: 1.4, change_pct: -0.5, direction: 'decrease', profile: null, source_id: src(5) },
    { id: 'o3', sort_order: 3, period_from: '2026-06-30', period_to: '2026-09-30', holder_name: 'Example Life Insurance', holder_type: 'insurance', pct_from: null, pct_to: 1.05, change_pct: 1.05, direction: 'new', profile: null, source_id: src(5) },
    { id: 'o4', sort_order: 4, period_from: '2026-06-30', period_to: '2026-09-30', holder_name: 'Placeholder Opportunities Fund', holder_type: 'fii', pct_from: 1.12, pct_to: 0, change_pct: -1.12, direction: 'exit', profile: 'Now below the 1% disclosure threshold.', source_id: src(5) },
    // Unchanged holder — must not render.
    { id: 'o5', sort_order: 5, period_from: '2026-06-30', period_to: '2026-09-30', holder_name: 'Steady Example Trust', holder_type: 'other', pct_from: 1.5, pct_to: 1.5, change_pct: 0, direction: null, source_id: src(5) },
  ],

  developments: [
    { id: 'd1', event_date: '2026-11-04', title: 'Board approves second plant', body: 'Estimated cost ₹180 crore, funded from internal accruals and debt, per the filing.', category: 'capex', source_id: src(2) },
    { id: 'd2', event_date: '2026-08-12', title: 'Chief Financial Officer appointed', body: null, category: 'management', source_id: src(5) },
    { id: 'd3', event_date: '2026-05-20', title: 'Supply contract for packaging resins', body: 'Three-year contract with a packaging converter; value not disclosed.', category: 'order', source_id: src(3) },
  ],

  risks: [
    { id: 'r1', sort_order: 1, title: 'Concentration in industrial coatings', body: 'About 71% of FY26 revenue came from one segment.', severity: 'high', source_id: src(1) },
    { id: 'r2', sort_order: 2, title: 'Raw material costs', body: 'Key inputs are petrochemical derivatives with volatile costs.', severity: 'medium', source_id: src(4) },
    { id: 'r3', sort_order: 3, title: 'Battery coatings may not reach commercial scale', body: 'Customer qualification is ongoing and may not succeed.', severity: 'low', source_id: null },
  ],

  watch_items: [
    { id: 'w1', sort_order: 1, label: 'Second plant timeline', note: 'Board-approved; construction start not yet disclosed.', is_active: true },
    { id: 'w2', sort_order: 2, label: 'Battery coatings qualification', note: null, is_active: true },
    { id: 'w3', sort_order: 3, label: 'Old item no longer tracked', note: 'Must not render.', is_active: false },
  ],
}

// ── 2. USD / million — small study ──────────────────────────────────────

const C2 = 'c0000000-0000-4000-8000-000000000002'

export const sampleStudyUsd = {
  company: {
    id: C2,
    slug: 'example-instruments',
    name: 'Example Instruments Inc.',
    country: 'US',
    exchange: 'NYSE',
    ticker: 'EXIN',
    sector: 'Industrials',
    industry: 'Test and measurement',
    reporting_currency: 'USD',
    reporting_unit: 'million',
    accounting_standard: 'us_gaap',
    fiscal_year_end_month: 12,
    status: 'draft',
    label: 'Company Study',
    read_time_minutes: 4,
    headline: 'A maker of calibration equipment for laboratories.',
    summary: 'Devices plus recurring calibration services.',
    story_hook: null,
    story_md: 'Example Instruments sells **calibration services** alongside its devices. This is a short fictional study.',
    updated_at: '2026-11-01T00:00:00Z',
  },
  sources: [
    { id: 'u-s1', kind: 'regulatory_filing', title: 'Annual report on Form 10-K, 2025', publisher: 'Example Instruments Inc.', url: 'https://example.com/10k-2025', document_date: '2026-02-20' },
  ],
  financial_periods: [
    { id: 'u1', period_end: '2023-12-31', period_type: 'FY', fiscal_label: 'FY2023', basis: 'consolidated', revenue: 1234567.8, ebitda: 210450.25, pat: 98000, eps: 3.21, cfo: 150000, total_debt: 400000, source_id: 'u-s1', revision: 1 },
    { id: 'u2', period_end: '2024-12-31', period_type: 'FY', fiscal_label: 'FY2024', basis: 'consolidated', revenue: 1310004.2, ebitda: 225300, pat: -12500.5, eps: -0.41, cfo: null, total_debt: 380000, source_id: 'u-s1', revision: 1 },
    { id: 'u3', period_end: '2025-12-31', period_type: 'FY', fiscal_label: 'FY2025', basis: 'consolidated', revenue: 1402000, ebitda: 240100, pat: 105300, eps: 3.44, cfo: 171000, total_debt: 355000, source_id: 'u-s1', revision: 1 },
  ],
  risks: [{ id: 'ur1', title: 'Customer concentration in pharmaceutical laboratories', body: null, severity: 'medium' }],
}

// ── 3. Bare study — every optional section empty ────────────────────────

export const sampleStudyEmpty = {
  company: {
    id: 'c0000000-0000-4000-8000-000000000003',
    slug: 'example-empty',
    name: 'Example Empty Co.',
    country: null,
    exchange: null,
    ticker: null,
    headline: '   ',
    story_hook: null,
    story_md: '',
    then_text: null,
    now_text: '',
    next_text: null,
    central_question: null,
  },
  sources: [],
  founders: [{ id: 'x', name: '' }],
  timeline: [],
  products: [],
  tam: [],
  developments: [],
  risks: [],
  watch_items: [{ id: 'w', label: 'Inactive', is_active: false }],
  financial_periods: [{ id: 'z', period_end: '2026-03-31', period_type: 'FY', basis: 'consolidated', revenue: null }],
  segment_periods: [],
  shareholding: [],
  ownership_changes: [{ id: 'oc', holder_name: 'Unchanged', pct_from: 1, pct_to: 1 }],
  period_notes: [],
}

// ── 4. Homepage / site_content ──────────────────────────────────────────

export const sampleLabels = {
  min_read: '{n} min read',
  updated: 'Updated',
  kind_update: 'Update',
  kind_period_note: 'Results note',
  kind_development: 'Development',
  studies_in_series: '{n} studies',
}

export const sampleSectionTitles = { story: 'The story so far' }

export const sampleHome = {
  hero: {
    study_company_id: C1,
    eyebrow: 'Featured study',
    headline_override: null,
    intro_override: null,
    cta_label: 'Read the study',
    image: null, // falls back to the study's hero image
  },
  heroStudy: { ...sampleStudyInr.company, read_time_minutes: 9 },
  valueProps: [
    { title: 'Built from filings', text: 'Every figure links back to the document it came from.', icon_key: 'document' },
    { title: 'History kept', text: 'Each quarter is added, never overwritten.', icon_key: 'layers' },
    { title: 'Ownership, both ways', text: 'Increases and decreases in disclosed holdings, side by side.', icon_key: 'people' },
    { title: 'Reviewed and dated', text: 'Every study shows when it was last reviewed.', icon_key: 'not-a-real-icon' },
  ],
  sections: {
    latest_studies: { title: 'Latest studies', visible: true },
    whats_new: { title: "What's new", visible: true },
    popular_series: { title: 'Popular series', visible: true },
  },
  studies: [
    { ...sampleStudyInr.company, read_time_minutes: 9, card_image: mediaProduct },
    { ...sampleStudyUsd.company, card_image: mediaNoCredit },
  ],
  whatsNew: [
    { kind: 'development', id: 'wn1', title: 'Board approves second plant', date: '2026-11-04', study_slug: 'example-materials', study_name: 'Example Materials Ltd', icon_key: null, link_href: null },
    { kind: 'period_note', id: 'wn2', title: 'Q2 FY27', date: '2026-11-05', study_slug: 'example-materials', study_name: 'Example Materials Ltd', icon_key: 'chart', link_href: null },
    { kind: 'update', id: 'wn3', title: 'New series: speciality materials', date: '2026-11-01', study_slug: null, study_name: null, icon_key: 'layers', link_href: null },
    { kind: 'update', id: 'wn4', title: 'Unsafe link must not be linked', date: '2026-10-30', study_slug: null, study_name: null, icon_key: null, link_href: 'javascript:alert(1)' },
  ],
  series: [
    { id: 'se1', slug: 'speciality-materials', name: 'Speciality materials', description: 'Companies that qualify products slowly with industrial customers.', icon_key: 'flask', image: mediaTimeline, sort_order: 1, is_active: true, study_count: 1 },
    { id: 'se2', slug: 'founder-led', name: 'Founder-led companies', description: null, icon_key: 'people', image: null, sort_order: 2, is_active: true, study_count: 3 },
    { id: 'se3', slug: 'retired', name: 'Retired series', description: 'Must not render.', is_active: false },
  ],
}
