/**
 * Trigger a GitHub Actions workflow_dispatch run of fetch-results.yml.
 *
 * Wired from AdminResultCalendar.jsx after a successful save —
 * fires the dispatch so the daily pipeline doesn't have to wait for cron.
 *
 * Netlify env:
 *   GITHUB_TOKEN  (PAT with `workflow` scope)   — also accepts GITHUB_DISPATCH_TOKEN
 *   GITHUB_REPO   (owner/repo, e.g. robin22y/stockiq)
 *                                               — also accepts GITHUB_REPOSITORY
 * Optional:
 *   GITHUB_DISPATCH_REF (default 'main')
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: 'Method not allowed' }),
    }
  }

  let body = {}
  try {
    body = JSON.parse(event.body || '{}')
  } catch (err) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ success: false, error: `Bad JSON: ${err.message}` }),
    }
  }

  const { date, symbols } = body
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_DISPATCH_TOKEN
  const REPO = process.env.GITHUB_REPO || process.env.GITHUB_REPOSITORY
  const REF = (process.env.GITHUB_DISPATCH_REF || 'main').trim()

  console.log(`admin-fetch-results: date=${date} symbols=${symbols?.length || 0}`)

  let dispatched = false
  let dispatchError = null

  if (GITHUB_TOKEN && REPO) {
    const url =
      `https://api.github.com/repos/${REPO}` +
      `/actions/workflows/fetch-results.yml/dispatches`
    try {
      const ghRes = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: REF,
          inputs: { date: date || '' },
        }),
      })
      if (ghRes.ok) {
        dispatched = true
      } else {
        const text = await ghRes.text()
        dispatchError = `GitHub ${ghRes.status}: ${text.slice(0, 300)}`
        console.error(dispatchError)
      }
    } catch (err) {
      dispatchError = err?.message || String(err)
      console.error(`Workflow dispatch failed: ${dispatchError}`)
    }
  } else {
    dispatchError =
      'GITHUB_TOKEN and GITHUB_REPO not set on Netlify — falling back to daily cron.'
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      success: true,
      dispatched,
      dispatchError,
      date: date || null,
      symbols: symbols || [],
      fetched: symbols?.length || 0,
      message: dispatched
        ? 'Workflow dispatched. Results land in ~3 min.'
        : 'Fetch queued. Daily cron will pick it up.',
    }),
  }
}
