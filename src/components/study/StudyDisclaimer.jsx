/**
 * StudyDisclaimer — text from site_content 'site.disclaimer'. Falls back to
 * the approved wording so a page is never published without a disclaimer.
 */
export const DISCLAIMER =
  'For information and education only. Not investment advice. PineX Research is not registered as an investment adviser or research analyst. Verify independently against the original filings.'

export default function StudyDisclaimer({ text }) {
  return (
    <footer className="st-disclaimer">
      <p>{typeof text === 'string' && text.trim() ? text : DISCLAIMER}</p>
    </footer>
  )
}
