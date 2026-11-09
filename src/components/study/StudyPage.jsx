/**
 * StudyPage — composes the full study in the fixed editorial order.
 *
 * Pure and props-only: the same tree renders in the admin draft preview
 * (SPA) and in the static prerender (react-dom/server). No window, no
 * fetching, no Date.now() — dates come from the data, so output is stable.
 *
 * Props
 *   study   { company, sources, founders, timeline, products, tam,
 *             developments, risks, watch_items, financial_periods,
 *             segment_periods, shareholding, ownership_changes, period_notes }
 *   labels         site_content 'site.labels' value ({ updated, min_read, … })
 *   sectionTitles  site_content 'study.sections' value ({ <section id>: title,
 *                  contents }); missing keys fall back to DEFAULT_SECTION_TITLES
 *                  so a draft preview without loaded content still has headings
 *   disclaimer     site_content 'site.disclaimer' text
 *
 * Images: company.hero_image / logo_image, founders[].image, products[].image,
 * timeline[].image are study_media objects (see media.js), already resolved
 * from their *_image_id columns by the loader.
 */
import { DEFAULT_SECTION_TITLES, SECTIONS, numberSources, readingMinutes } from './data.js'
import StudyLayout from './StudyLayout.jsx'
import StudyHeader from './StudyHeader.jsx'
import StudyToc from './StudyToc.jsx'
import StorySection from './StorySection.jsx'
import FoundersSection from './Founders.jsx'
import Timeline from './Timeline.jsx'
import ProductsList from './Products.jsx'
import TamBlock from './TamBlock.jsx'
import LatestQuarter from './LatestQuarter.jsx'
import FinancialHistory from './FinancialHistory.jsx'
import SegmentTable from './SegmentTable.jsx'
import ShareholdingTable from './ShareholdingTable.jsx'
import OwnershipChanges from './OwnershipChanges.jsx'
import DevelopmentsTimeline from './DevelopmentsTimeline.jsx'
import ThenNowNext from './ThenNowNext.jsx'
import RisksList from './Risks.jsx'
import WatchList from './WatchList.jsx'
import CentralQuestion from './CentralQuestion.jsx'
import SourcesList from './SourcesList.jsx'
import StudyDisclaimer from './StudyDisclaimer.jsx'

export default function StudyPage({ study, labels, sectionTitles, disclaimer, lang }) {
  const s = study || {}
  const c = s.company || {}
  const numbered = numberSources(s.sources)
  const refs = numbered.numbers
  const currency = c.reporting_currency
  const unit = c.reporting_unit
  const T = { ...DEFAULT_SECTION_TITLES }
  for (const [k, v] of Object.entries(sectionTitles || {})) {
    if (typeof v === 'string' && v.trim()) T[k] = v
  }
  const toc = SECTIONS.filter((sec) => sec.has(s)).map(({ id }) => ({ id, label: T[id] }))

  return (
    <StudyLayout lang={lang}>
      <StudyHeader company={c} readingMinutes={readingMinutes(s)} labels={labels} />
      <StudyToc items={toc} title={T.contents} />
      <StorySection title={T['story']} story_md={c.story_md} />
      <FoundersSection title={T['founders']} founders={s.founders} sourceNumbers={refs} />
      <Timeline title={T['timeline']} timeline={s.timeline} sourceNumbers={refs} />
      <ProductsList title={T['products']} products={s.products} sourceNumbers={refs} />
      <TamBlock title={T['market']} tam={s.tam} sourceNumbers={refs} />
      <LatestQuarter
        title={T['latest-quarter']}
        financial_periods={s.financial_periods}
        period_notes={s.period_notes}
        currency={currency}
        unit={unit}
        sourceNumbers={refs}
      />
      <FinancialHistory title={T['financial-history']} financial_periods={s.financial_periods} currency={currency} unit={unit} sourceNumbers={refs} />
      <SegmentTable title={T['segments']} segment_periods={s.segment_periods} currency={currency} unit={unit} sourceNumbers={refs} />
      <ShareholdingTable title={T['shareholding']} shareholding={s.shareholding} sourceNumbers={refs} />
      <OwnershipChanges title={T['ownership-changes']} ownership_changes={s.ownership_changes} sourceNumbers={refs} />
      <DevelopmentsTimeline title={T['developments']} developments={s.developments} sourceNumbers={refs} />
      <ThenNowNext title={T['then-now-next']} then_text={c.then_text} now_text={c.now_text} next_text={c.next_text} />
      <RisksList title={T['risks']} risks={s.risks} sourceNumbers={refs} />
      <WatchList title={T['watching']} watch_items={s.watch_items} />
      <CentralQuestion title={T['central-question']} central_question={c.central_question} />
      <SourcesList title={T['sources']} numbered={numbered} />
      <StudyDisclaimer text={disclaimer} />
    </StudyLayout>
  )
}
