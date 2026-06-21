/**
 * CompanyStudy — /learn/company/:symbol
 *
 * Long-form study of one company, paired with Robin's podcast/YouTube
 * episode. Content lives in `company_studies` (5 sections + title in
 * each of EN/ML/HI/TA); live cycle data is read from price_data so the
 * "where they stand today" surface refreshes daily.
 *
 * Language fallback
 *   If a non-EN column is null/empty the renderer falls back to the EN
 *   value, so Robin can publish EN-only studies and add translations
 *   later without changing the page contract.
 *
 * PDF download
 *   Uses html2canvas to render the hidden printable surface as an
 *   image, then drops the image into a jspdf doc. This sidesteps
 *   jspdf's lack of Indic-font support — the browser already rendered
 *   Malayalam / Hindi / Tamil correctly, so the captured image keeps
 *   them legible regardless of fonts available in jspdf.
 */
import { useEffect, useState } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context'

const LANGUAGES = [
  { key: 'en', label: 'EN', display: 'English'   },
  { key: 'ml', label: 'ML', display: 'മലയാളം'    },
  { key: 'hi', label: 'HI', display: 'हिन्दी'    },
  { key: 'ta', label: 'TA', display: 'தமிழ்'    },
]

const SECTIONS = [
  { key: 'what_they_do',        label: 'WHAT THEY DO' },
  { key: 'how_they_make_money', label: 'HOW THEY MAKE MONEY' },
  { key: 'who_built_it',        label: 'WHO BUILT IT' },
  { key: 'similar_companies',   label: 'SIMILAR COMPANIES' },
  { key: 'what_to_watch',       label: 'WHAT TO WATCH' },
]

// PDF section labels per language. EN is the fallback for any tongue
// that doesn't have a translation block yet — preserves the structure.
const SECTION_LABELS = {
  en: {
    what_they_do: 'WHAT THEY DO',
    how_they_make_money: 'HOW THEY MAKE MONEY',
    who_built_it: 'WHO BUILT IT',
    similar_companies: 'SIMILAR COMPANIES',
    what_to_watch: 'WHAT TO WATCH',
    where_today: 'WHERE THEY STAND TODAY',
    stage: 'Stage',
    rs: 'RS vs Nifty',
    as_of: 'As of',
    footer_l1: 'PineX — pinex.in',
    footer_l2: 'This is educational content only.',
    footer_l3: 'Not investment advice.',
    footer_l4: 'Verify at nseindia.com',
    footer_l5: 'Consult a SEBI-registered adviser.',
  },
  ml: {
    what_they_do: 'അവർ എന്താണ് ചെയ്യുന്നത്',
    how_they_make_money: 'അവർ എങ്ങനെ പണം ഉണ്ടാക്കുന്നു',
    who_built_it: 'ഇതിന്റെ പിന്നിലുള്ളവർ',
    similar_companies: 'സമാന കമ്പനികൾ',
    what_to_watch: 'ശ്രദ്ധിക്കേണ്ടത്',
    where_today: 'ഇന്നത്തെ സ്ഥിതി',
    stage: 'സ്റ്റേജ്',
    rs: 'നിഫ്റ്റി-യുമായി ആപേക്ഷിക ശക്തി',
    as_of: 'തീയതി',
    footer_l1: 'PineX — pinex.in',
    footer_l2: 'ഇത് വിദ്യാഭ്യാസ ഉള്ളടക്കം മാത്രമാണ്.',
    footer_l3: 'നിക്ഷേപ ഉപദേശമല്ല.',
    footer_l4: 'nseindia.com ൽ പരിശോധിക്കുക.',
    footer_l5: 'SEBI രജിസ്റ്റർ ചെയ്ത ഉപദേശകനെ സമീപിക്കുക.',
  },
  hi: {
    what_they_do: 'वे क्या करते हैं',
    how_they_make_money: 'वे पैसा कैसे कमाते हैं',
    who_built_it: 'इसे किसने बनाया',
    similar_companies: 'समान कंपनियाँ',
    what_to_watch: 'क्या ध्यान रखें',
    where_today: 'आज की स्थिति',
    stage: 'स्टेज',
    rs: 'निफ्टी सापेक्ष शक्ति',
    as_of: 'तारीख',
    footer_l1: 'PineX — pinex.in',
    footer_l2: 'यह केवल शैक्षिक सामग्री है।',
    footer_l3: 'निवेश सलाह नहीं है।',
    footer_l4: 'nseindia.com पर सत्यापित करें।',
    footer_l5: 'SEBI पंजीकृत सलाहकार से परामर्श लें।',
  },
  ta: {
    what_they_do: 'அவர்கள் என்ன செய்கிறார்கள்',
    how_they_make_money: 'பணம் எப்படி சம்பாதிக்கிறார்கள்',
    who_built_it: 'யார் கட்டினார்கள்',
    similar_companies: 'ஒத்த நிறுவனங்கள்',
    what_to_watch: 'கவனிக்க வேண்டியவை',
    where_today: 'இன்றைய நிலை',
    stage: 'நிலை',
    rs: 'நிஃப்டி ஒப்பீட்டு வலிமை',
    as_of: 'தேதி',
    footer_l1: 'PineX — pinex.in',
    footer_l2: 'இது கல்வி உள்ளடக்கம் மட்டுமே.',
    footer_l3: 'முதலீட்டு ஆலோசனை அல்ல.',
    footer_l4: 'nseindia.com இல் சரிபார்க்கவும்.',
    footer_l5: 'SEBI பதிவு செய்த ஆலோசகரை அணுகவும்.',
  },
}

// Read a section for the selected language with EN fallback.
function getSectionText(study, sectionKey, lang) {
  if (!study) return ''
  const langKey = lang === 'en' ? sectionKey : `${sectionKey}_${lang}`
  const val = study[langKey]
  if (val && String(val).trim()) return val
  return study[sectionKey] || ''
}

function getTitle(study, lang) {
  if (!study) return ''
  if (lang === 'en') return ''  // EN doesn't use a separate title column; symbol is the title
  return study[`title_${lang}`] || ''
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.valueOf())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDuration(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  const mins = Math.round(n / 60)
  return `${mins} min`
}

export default function CompanyStudy() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const { isPro } = useAuth()
  const symU = String(symbol || '').toUpperCase()
  const [study, setStudy] = useState(null)
  const [company, setCompany] = useState(null)
  const [live, setLive] = useState(null)
  const [status, setStatus] = useState('loading')
  const [lang, setLang] = useState('en')
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // 1) Study row — gated by RLS to is_published=true for public
        //    visitors. Drafts surface only for the admin (auth.email()
        //    gate handled server-side).
        const { data: studyRow, error: studyErr } = await supabase
          .from('company_studies')
          .select('*')
          .eq('symbol', symU)
          .maybeSingle()
        if (cancelled) return
        if (studyErr) throw studyErr
        if (!studyRow) { setStatus('not_found'); return }
        setStudy(studyRow)

        // 2) Company row — name + sector for the header card.
        const { data: companyRow } = await supabase
          .from('companies')
          .select('id, symbol, name, sector')
          .eq('symbol', symU)
          .maybeSingle()
        if (cancelled) return
        setCompany(companyRow || null)

        // 3) Live cycle row from price_data is_latest=true. Days-in-
        //    stage = best-effort: count consecutive prior rows that
        //    carry the same stage.
        if (companyRow?.id) {
          const { data: latest } = await supabase
            .from('price_data')
            .select('date, close, stage, weinstein_substage, rs_vs_nifty, vol_ratio')
            .eq('company_id', companyRow.id)
            .eq('is_latest', true)
            .maybeSingle()
          if (cancelled) return
          if (latest) {
            let daysInStage = null
            try {
              const { data: hist } = await supabase
                .from('price_data')
                .select('date, stage')
                .eq('company_id', companyRow.id)
                .order('date', { ascending: false })
                .limit(120)
              if (Array.isArray(hist)) {
                let n = 0
                for (const r of hist) {
                  if (String(r.stage) === String(latest.stage)) n += 1
                  else break
                }
                daysInStage = n
              }
            } catch { /* non-fatal */ }
            setLive({ ...latest, days_in_stage: daysInStage })
          }
        }
        setStatus('ready')
      } catch (e) {
        if (cancelled) return
        // eslint-disable-next-line no-console
        console.warn('[CompanyStudy] load failed:', e?.message || e)
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [symU])

  async function handleDownloadPdf() {
    // Pro-only feature. Free users see a redirect to /rewards
    // instead of the heavy html2canvas/jspdf bundle even loading.
    if (!isPro) {
      navigate('/rewards')
      return
    }
    setPdfBusy(true)
    try {
      const { default: html2canvas } = await import('html2canvas')
      const { jsPDF } = await import('jspdf')
      const node = document.getElementById('company-study-printable')
      if (!node) throw new Error('Printable surface not found')
      // Temporarily reveal the offscreen printable surface so html2canvas
      // can measure it. We keep it absolutely-positioned offscreen rather
      // than display:none so the layout is settled before capture.
      node.style.left = '0'
      node.style.zIndex = '-1'
      const canvas = await html2canvas(node, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      })
      node.style.left = '-99999px'
      node.style.zIndex = ''
      const img = canvas.toDataURL('image/jpeg', 0.92)
      const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      // Fit the canvas to A4 width, maintaining aspect. If it overflows
      // the page vertically, split into multiple pages.
      const ratio = canvas.height / canvas.width
      const imgW = pageW - 32
      const imgH = imgW * ratio
      if (imgH <= pageH - 32) {
        pdf.addImage(img, 'JPEG', 16, 16, imgW, imgH, undefined, 'FAST')
      } else {
        // Multi-page: render at full width and slice by page height.
        let yOffset = 0
        const pxPerPt = canvas.width / imgW
        const pageHeightPx = (pageH - 32) * pxPerPt
        while (yOffset < canvas.height) {
          const slice = document.createElement('canvas')
          slice.width = canvas.width
          slice.height = Math.min(pageHeightPx, canvas.height - yOffset)
          const ctx = slice.getContext('2d')
          ctx.drawImage(canvas, 0, -yOffset)
          const sliceImg = slice.toDataURL('image/jpeg', 0.92)
          pdf.addImage(sliceImg, 'JPEG', 16, 16, imgW, (slice.height / pxPerPt))
          yOffset += pageHeightPx
          if (yOffset < canvas.height) pdf.addPage()
        }
      }
      pdf.save(`${symU}_study_${lang}.pdf`)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[CompanyStudy] PDF download failed:', e)
      alert('PDF download failed: ' + (e?.message || e))
    } finally {
      setPdfBusy(false)
    }
  }

  if (status === 'loading') {
    return <PageShell><p style={muted}>Loading study…</p></PageShell>
  }
  if (status === 'not_found') {
    return (
      <PageShell>
        <h1 style={h1}>Study not found</h1>
        <p style={muted}>No published study exists for {symU} yet.</p>
        <Link to="/learn/companies" style={ctaLink}>← Back to Company Studies</Link>
      </PageShell>
    )
  }
  if (status === 'error') {
    return <PageShell><p style={muted}>Could not load study.</p></PageShell>
  }

  const title = getTitle(study, lang)
  const labels = SECTION_LABELS[lang] || SECTION_LABELS.en
  const durationLabel = fmtDuration(study.podcast_duration_seconds)

  return (
    <>
      <Helmet>
        <title>{(company?.name || symU)} — Company Study · PineX</title>
        <meta name="description" content={`Deep dive into ${company?.name || symU} — what they do, how they make money, where they stand in the market cycle today.`} />
      </Helmet>
      <main style={pageBg}>
        <div style={pageInner}>
          <Link to="/learn/companies" style={backLink}>← All Studies</Link>

          {/* Header */}
          <header style={headerBox}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={eyebrow}>Company Study</p>
              <h1 style={h1}>
                {company?.name || symU}{' '}
                <span style={{ color: '#94A3B8', fontSize: 16, fontWeight: 500 }}>· {symU}</span>
              </h1>
              {title && (
                <p style={{ margin: '6px 0 0', fontSize: 15, color: '#CBD5E1' }}>{title}</p>
              )}
              {company?.sector && (
                <span style={sectorBadge}>{company.sector}</span>
              )}
            </div>
            {study.youtube_url && (
              <a
                href={study.youtube_url}
                target="_blank"
                rel="noreferrer noopener"
                style={listenBtn}
              >
                🎧 Listen {durationLabel ? `${durationLabel} ` : ''}→
              </a>
            )}
          </header>

          {/* Language tabs */}
          <div style={langStrip} role="tablist" aria-label="Choose language">
            {LANGUAGES.map((L) => (
              <button
                key={L.key}
                type="button"
                role="tab"
                aria-selected={lang === L.key}
                onClick={() => setLang(L.key)}
                style={{
                  ...langBtn,
                  background: lang === L.key ? 'rgba(251, 191, 36, 0.12)' : 'transparent',
                  color:      lang === L.key ? '#FBBF24' : '#CBD5E1',
                  border:     `1px solid ${lang === L.key ? '#FBBF24' : '#1E2530'}`,
                }}
                title={L.display}
              >
                {L.label}
              </button>
            ))}
            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={pdfBusy}
                style={pdfBtn}
              >
                {pdfBusy ? 'Generating…' : '📥 Download PDF'}
              </button>
            </div>
          </div>

          {/* Live data card */}
          {live && (
            <section style={liveCard}>
              <p style={eyebrow}>{labels.where_today}</p>
              <div style={liveGrid}>
                <LiveCell label={labels.stage} value={
                  live.weinstein_substage
                    ? `${live.stage || ''} · ${live.weinstein_substage}`
                    : (live.stage || '—')
                } />
                <LiveCell label={labels.rs} value={
                  live.rs_vs_nifty != null
                    ? `${Number(live.rs_vs_nifty).toFixed(1)}%`
                    : '—'
                } />
                <LiveCell label="Days in stage" value={
                  live.days_in_stage != null ? `${live.days_in_stage}d` : '—'
                } />
                <LiveCell label="Volume ratio" value={
                  live.vol_ratio != null ? `${Number(live.vol_ratio).toFixed(2)}×` : '—'
                } />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>
                {labels.as_of}: {fmtDate(live.date)}
              </p>
            </section>
          )}

          {/* Study sections */}
          <article style={studyArticle}>
            {SECTIONS.map((S) => {
              const text = getSectionText(study, S.key, lang)
              if (!text) return null
              return (
                <section key={S.key} style={{ marginTop: 28 }}>
                  <h2 style={h2}>{labels[S.key] || S.label}</h2>
                  <p style={bodyText}>{text}</p>
                </section>
              )
            })}
          </article>

          {/* Footer disclaimer */}
          <p style={footerDisclaimer}>
            Data observed. Not advice. Verify at nseindia.com
          </p>
        </div>

        {/* Hidden printable surface — captured by html2canvas. Stays
            offscreen until handleDownloadPdf nudges it back into the
            viewport for the capture moment. */}
        <PrintableSurface
          symbol={symU}
          company={company}
          study={study}
          live={live}
          lang={lang}
          title={title}
          labels={labels}
        />
      </main>
    </>
  )
}

// ── Subcomponents ───────────────────────────────────────────────

function PageShell({ children }) {
  return (
    <main style={pageBg}>
      <div style={pageInner}>{children}</div>
    </main>
  )
}

function LiveCell({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 15, fontWeight: 600, color: '#E2E8F0' }}>{value}</div>
    </div>
  )
}

function PrintableSurface({ symbol, company, study, live, lang, title, labels }) {
  // Light-theme, A4-sized canvas. Drawn off-screen so it doesn't
  // affect layout; html2canvas captures it at request time. Width
  // matches A4 minus 32pt margins at 96 DPI for a clean fit.
  const sections = SECTIONS.map((S) => ({
    label: labels[S.key] || S.label,
    text: getSectionText(study, S.key, lang),
  })).filter((s) => s.text)
  return (
    <div
      id="company-study-printable"
      style={{
        position: 'absolute',
        left: '-99999px',
        top: 0,
        width: 780,
        background: '#ffffff',
        color: '#0B0E11',
        padding: 36,
        fontFamily: 'DM Sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: '#F4ECD8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#1E1E1E', fontSize: 16 }}>p</div>
        <div style={{ fontSize: 12, color: '#64748B' }}>PineX — Company Study</div>
      </div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
        {symbol}
        {company?.name ? ` · ${company.name}` : ''}
      </h1>
      {title && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569' }}>{title}</p>}
      {study.published_at && (
        <p style={{ margin: '4px 0 0', fontSize: 11, color: '#94A3B8' }}>
          Published {fmtDate(study.published_at)}
        </p>
      )}

      {sections.map((s, i) => (
        <section key={i} style={{ marginTop: 18 }}>
          <h2 style={{ margin: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>{s.label}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.65, color: '#1E293B', whiteSpace: 'pre-wrap' }}>{s.text}</p>
        </section>
      ))}

      {live && (
        <section style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid #E2E8F0' }}>
          <h2 style={{ margin: 0, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#64748B', fontWeight: 700 }}>{labels.where_today}</h2>
          <div style={{ marginTop: 8, fontSize: 12, color: '#1E293B', lineHeight: 1.7 }}>
            <div>{labels.stage}: {live.weinstein_substage ? `${live.stage} · ${live.weinstein_substage}` : (live.stage || '—')}</div>
            <div>{labels.rs}: {live.rs_vs_nifty != null ? `${Number(live.rs_vs_nifty).toFixed(1)}%` : '—'}</div>
            <div>{labels.as_of}: {fmtDate(live.date)}</div>
          </div>
        </section>
      )}

      <div style={{ marginTop: 28, paddingTop: 14, borderTop: '1px solid #E2E8F0', fontSize: 10, color: '#64748B', lineHeight: 1.6 }}>
        <div>{labels.footer_l1}</div>
        <div>{labels.footer_l2}</div>
        <div>{labels.footer_l3}</div>
        <div>{labels.footer_l4}</div>
        <div>{labels.footer_l5}</div>
      </div>
    </div>
  )
}

// ── Styles ──────────────────────────────────────────────────────

const pageBg = {
  minHeight: '100vh',
  width: '100%',
  background: '#0B0E11',
  color: '#E2E8F0',
  padding: '40px 20px 100px',
  fontFamily: 'DM Sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

const pageInner = { maxWidth: 760, margin: '0 auto' }

const eyebrow = {
  margin: 0,
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#64748B',
  fontWeight: 700,
}

const h1 = {
  margin: '6px 0 0',
  fontSize: 26,
  fontWeight: 700,
  letterSpacing: '-0.01em',
  color: '#E2E8F0',
}

const h2 = {
  margin: '0 0 8px',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94A3B8',
  fontWeight: 700,
}

const muted = { margin: 0, fontSize: 13, color: '#94A3B8' }

const backLink = {
  display: 'inline-block',
  marginBottom: 14,
  fontSize: 12,
  color: '#94A3B8',
  textDecoration: 'none',
}

const headerBox = {
  display: 'flex',
  gap: 16,
  alignItems: 'flex-start',
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid #1E2530',
  borderRadius: 10,
  padding: '20px 22px',
  flexWrap: 'wrap',
}

const sectorBadge = {
  display: 'inline-block',
  marginTop: 10,
  padding: '3px 9px',
  borderRadius: 12,
  background: 'rgba(251, 191, 36, 0.10)',
  border: '1px solid rgba(251, 191, 36, 0.30)',
  color: '#FBBF24',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.04em',
}

const listenBtn = {
  flexShrink: 0,
  padding: '10px 16px',
  background: '#FBBF24',
  color: '#0B0E11',
  fontWeight: 700,
  fontSize: 13,
  borderRadius: 6,
  textDecoration: 'none',
  border: 'none',
}

const langStrip = {
  display: 'flex',
  gap: 6,
  marginTop: 20,
  alignItems: 'center',
  flexWrap: 'wrap',
}

const langBtn = {
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 4,
  cursor: 'pointer',
}

const pdfBtn = {
  padding: '8px 14px',
  background: 'transparent',
  border: '1px solid #1E2530',
  color: '#CBD5E1',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 4,
  cursor: 'pointer',
}

const liveCard = {
  marginTop: 18,
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid #1E2530',
  borderRadius: 10,
  padding: '14px 18px',
}

const liveGrid = {
  marginTop: 8,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 14,
}

const studyArticle = {
  marginTop: 8,
}

const bodyText = {
  margin: '8px 0 0',
  fontSize: 14,
  lineHeight: 1.75,
  color: '#CBD5E1',
  whiteSpace: 'pre-wrap',
}

const footerDisclaimer = {
  marginTop: 32,
  fontSize: 11,
  color: '#64748B',
  textAlign: 'center',
}

const ctaLink = {
  display: 'inline-block',
  marginTop: 12,
  color: '#FBBF24',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 600,
}
