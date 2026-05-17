const https = require('https')

function httpsPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data)
    const urlObj = new URL(url)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => {
        raw += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve({ raw })
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

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

    const GEMINI_KEY = process.env.GEMINI_API_KEY
    if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set')

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`

    const result = await httpsPost(url, {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 200,
        temperature: 0.3,
      },
    })

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!text) {
      console.error('Gemini raw response:', JSON.stringify(result))
      throw new Error('Empty Gemini response')
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ description: text }),
    }
  } catch (err) {
    console.error('gemini description error:', err)
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(err?.message || err) }),
    }
  }
}
