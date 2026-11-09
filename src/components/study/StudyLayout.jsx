/**
 * StudyLayout — the .study-surface wrapper. All study CSS is scoped under it.
 * width="wide" widens the column for the homepage / directory (card grids);
 * the default reading measure is for study pages.
 */
export default function StudyLayout({ children, lang, width }) {
  return (
    <div className="study-surface" lang={lang}>
      <article className={`st-article${width === 'wide' ? ' st-wide' : ''}`}>{children}</article>
    </div>
  )
}
