/**
 * Triggers GitHub Actions workflow_dispatch for Daily Market Data (daily.yml).
 * Netlify env: GITHUB_DISPATCH_TOKEN (PAT with workflow scope), GITHUB_REPOSITORY=owner/repo
 * Optional: GITHUB_DISPATCH_REF (default main), GITHUB_WORKFLOW_FILE (default daily.yml)
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

  const token = process.env.GITHUB_DISPATCH_TOKEN || process.env.GITHUB_TOKEN
  const repoFull = process.env.GITHUB_REPOSITORY
  const ref = (process.env.GITHUB_DISPATCH_REF || 'main').trim()
  const workflowFile = (process.env.GITHUB_WORKFLOW_FILE || 'daily.yml').trim()

  if (!token || !repoFull) {
    return {
      statusCode: 501,
      headers,
      body: JSON.stringify({
        ok: false,
        error:
          'Set GITHUB_REPOSITORY (owner/repo) and GITHUB_DISPATCH_TOKEN (or GITHUB_TOKEN) on Netlify to enable dispatch.',
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

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`

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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, message: `Workflow dispatch requested (${workflowFile}, ref ${ref}).` }),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: err?.message || String(err) }),
    }
  }
}
