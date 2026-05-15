/**
 * Triggers the GitHub Actions daily.yml workflow_dispatch so that
 * the newly-added or stale stock gets price + delivery data on the next run.
 * The daily pipeline fetches ALL active companies, so any stock that is active
 * in the companies table will be picked up automatically.
 *
 * Body: { symbol: string }  (logged but not filtered — full pipeline runs)
 * Env:  GITHUB_DISPATCH_TOKEN (PAT with workflow scope), GITHUB_REPOSITORY=owner/repo
 */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) }
  }

  let symbol = ''
  try {
    const body = JSON.parse(event.body || '{}')
    symbol = String(body.symbol || '').trim().toUpperCase()
  } catch {
    /* body parse error — symbol not required */
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN || process.env.GITHUB_TOKEN
  const repoFull = process.env.GITHUB_REPOSITORY
  const ref = (process.env.GITHUB_DISPATCH_REF || 'main').trim()

  if (!token || !repoFull) {
    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        ok: false,
        error:
          'Set GITHUB_REPOSITORY (owner/repo) and GITHUB_DISPATCH_TOKEN on Netlify to enable workflow dispatch.',
      }),
    }
  }

  const [owner, repo] = repoFull.split('/').map((s) => s.trim())
  if (!owner || !repo) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: 'GITHUB_REPOSITORY must be owner/repo' }),
    }
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent('daily.yml')}/dispatches`

  try {
    const ghRes = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    })

    const text = await ghRes.text()
    if (!ghRes.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: `GitHub ${ghRes.status}: ${text.slice(0, 500)}`,
        }),
      }
    }

    const symNote = symbol ? ` for ${symbol}` : ''
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        message: `Daily pipeline triggered${symNote}. All active stocks (including ${symbol || 'newly added ones'}) will be fetched. Data available in ~30 minutes.`,
      }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    }
  }
}
