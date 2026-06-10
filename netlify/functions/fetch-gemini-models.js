// ── /.netlify/functions/fetch-gemini-models ─────────────────────────────
// Server-side proxy for the Google AI Studio models-list endpoint.
//
// WHY a proxy:
//   The admin browser would otherwise need to (a) carry the admin's
//   personal Gemini key just to list models and (b) hit Google directly
//   from an arbitrary origin. We already have GEMINI_API_KEY in the
//   Netlify env (used by the weekly AI pipeline), so this endpoint
//   reuses that key — admins don't have to paste theirs.
//
// SHAPE returned:
//   { models: [{ id, displayName, description, inputTokenLimit, outputTokenLimit }] }
//
// Filters to text-generation models (supportedGenerationMethods
// includes 'generateContent'). Strips the "models/" prefix from `name`
// so the id matches the format used in our ai_config rows.

export default async () => {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY not configured in Netlify env' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=50`
    const res = await fetch(url)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return new Response(
        JSON.stringify({ error: `Google returned HTTP ${res.status}`, detail: body.slice(0, 500) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const data = await res.json()

    const models = (data?.models || [])
      .filter((m) => Array.isArray(m?.supportedGenerationMethods)
        && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        displayName: m.displayName || null,
        description: m.description || null,
        inputTokenLimit: m.inputTokenLimit ?? null,
        outputTokenLimit: m.outputTokenLimit ?? null,
      }))
      .filter((m) => m.id)

    return new Response(
      JSON.stringify({ models, fetchedAt: new Date().toISOString() }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          // 5-minute edge cache — admin won't hammer this on a hot
          // refresh, and the live list doesn't change every minute.
          'Cache-Control': 'public, max-age=300',
        },
      },
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err?.message || err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
}
