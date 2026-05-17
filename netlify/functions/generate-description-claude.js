const Anthropic = require('@anthropic-ai/sdk')

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '' }

  try {
    const {
      symbol,
      name,
      sector,
      stage,
      rs_vs_nifty,
      promoter_pct,
      promoter_pledge_pct,
      revenue_growth,
      margin,
      existing_description,
    } = JSON.parse(event.body || '{}')

    if (!symbol || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'symbol and name required' }),
      }
    }

    const client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY,
    })

    const prompt = `Write a factual 2-3 sentence company description for ${name} (NSE: ${symbol}) for Indian retail investors.

Available data:
- Sector: ${sector || 'Unknown'}
- Stage: ${stage || 'Unknown'}
- RS vs Nifty: ${rs_vs_nifty != null ? `${rs_vs_nifty}%` : 'N/A'}
- Promoter holding: ${promoter_pct != null ? `${promoter_pct}%` : 'N/A'}
- Promoter pledge: ${promoter_pledge_pct != null ? `${promoter_pledge_pct}%` : 'N/A'}
- Revenue growth: ${revenue_growth != null ? `${revenue_growth}%` : 'N/A'}
- Operating margin: ${margin != null ? `${margin}%` : 'N/A'}
${existing_description ? `Existing: ${existing_description}` : ''}

Rules:
1. Max 60 words
2. Describe what the company does first
3. Mention sector and scale
4. One factual data point if notable
5. No buy/sell/bullish/bearish/target/recommend
6. Plain English, no jargon
7. No preamble — start directly with company name`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      system:
        'You write factual company descriptions for an Indian stock platform. Never give investment advice.',
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content?.[0]?.text?.trim()
    if (!text) throw new Error('Empty response')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ description: text }),
    }
  } catch (err) {
    console.error('claude description error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(err?.message || err) }),
    }
  }
}
