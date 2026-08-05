/**
 * NotFound + RouteError — the two pages that were missing.
 *
 * WHY THIS EXISTS
 *   The router is a createBrowserRouter data router with 71 routes and,
 *   until now, no `path: '*'` catch-all and no `errorElement`. Any URL
 *   that matched nothing fell through to React Router's OWN built-in
 *   fallback, which shows end users a developer message:
 *
 *     "Unexpected Application Error! 404 Not Found
 *      💿 Hey developer 👋  You can provide a way better UX than this…"
 *
 *   That is the error users have been reporting. It is reproducible on
 *   the live site at /stock/ — an empty :symbol segment.
 *
 *   The <ErrorBoundary> wrapper in App.jsx could never catch it: a data
 *   router handles routing errors internally and renders its own UI, so
 *   nothing is thrown up to a React error boundary sitting OUTSIDE
 *   <RouterProvider>.
 *
 * WHY IT SHOWS THE PATH
 *   Most of these come from a link that built a URL from an empty value
 *   — `/stock/${symbol}` with no symbol yields `/stock/`, which cannot
 *   match `/stock/:symbol`. Printing the path someone actually landed on
 *   is what makes those reportable instead of mysterious.
 */
import { Link, useRouteError, isRouteErrorResponse, useLocation } from 'react-router-dom'

const S = {
  wrap: {
    maxWidth: 560,
    margin: '0 auto',
    padding: '56px 20px 80px',
    color: 'var(--text-primary)',
  },
  code: {
    fontSize: 12,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    margin: 0,
  },
  title: { fontSize: 22, fontWeight: 700, margin: '10px 0 0', letterSpacing: '-0.01em' },
  body: { fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', margin: '12px 0 0' },
  path: {
    display: 'block',
    marginTop: 14,
    padding: '9px 12px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 12,
    color: 'var(--text-primary)',
    overflowWrap: 'anywhere',
  },
  row: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 },
  primary: {
    padding: '9px 16px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    fontSize: 14,
    textDecoration: 'none',
  },
}

function Shell({ code, title, children, path }) {
  return (
    <div style={S.wrap}>
      <p style={S.code}>{code}</p>
      <h1 style={S.title}>{title}</h1>
      <p style={S.body}>{children}</p>
      {path ? <code style={S.path}>{path}</code> : null}
      <div style={S.row}>
        <Link to="/home" style={S.primary}>Go to Today</Link>
        <Link to="/search" style={S.primary}>Search stocks</Link>
      </div>
    </div>
  )
}

/** Rendered by the `path: '*'` catch-all — a URL that matched no route. */
export default function NotFound() {
  const { pathname } = useLocation()
  // A stock URL missing its symbol is the single most common way to get
  // here, and "search instead" is the useful next step for it.
  const stockish = pathname.startsWith('/stock')
  return (
    <Shell
      code="404"
      title="That page doesn't exist"
      path={pathname}
    >
      {stockish
        ? 'This looks like a stock link that lost its ticker. Search for the company instead.'
        : 'The link may be out of date, or the address may have a typo.'}
    </Shell>
  )
}

/**
 * Rendered by `errorElement` — a route that threw while rendering, or a
 * data-router error response. Distinct from the catch-all above: that one
 * means "no such page", this one means "the page broke".
 */
export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />

  const detail =
    (isRouteErrorResponse(error) && `${error.status} ${error.statusText}`) ||
    error?.message ||
    null

  return (
    <Shell code="Error" title="Something went wrong loading this page" path={detail}>
      Refreshing usually fixes it. If it keeps happening, the page below is
      the one that failed.
    </Shell>
  )
}
