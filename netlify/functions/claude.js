const Anthropic = require('@anthropic-ai/sdk')

async function logUsageEvent(eventType, metadata) {
  try {
    // Non-blocking local log hook; can be wired to DB later.
    console.log('[usage_event]', eventType, metadata)
  } catch {
    // Never block user response on usage logging.
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method not allowed' }
  }

  try {
    const { question = '', context = '', symbol = '' } = JSON.parse(event.body || '{}')

    const blocked = [
      'buy',
      'sell',
      'invest',
      'should i',
      'recommend',
      'target price',
      'entry point',
      'exit',
      'stop loss',
    ]

    if (blocked.some((w) => question.toLowerCase().includes(w))) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          answer:
            'StockIQ explains data but cannot give investment advice. For buy/sell decisions, please consult a SEBI registered investment adviser.',
        }),
      }
    }

    const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY })

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      system:
        'You explain Indian stock market data to retail investors in plain simple English. Maximum 2 sentences. No jargon. Never recommend buying or selling anything.',
      messages: [
        {
          role: 'user',
          content: `Stock: ${symbol}\nContext: ${context}\nQuestion: ${question}`,
        },
      ],
    })

    logUsageEvent('explain_button_used', { symbol })

    const answer =
      Array.isArray(response.content) && response.content[0] && response.content[0].text
        ? response.content[0].text
        : 'I could not generate an explanation right now.'

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ answer }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        answer: 'Something went wrong while generating the explanation. Please try again.',
        error: String(error?.message || error),
      }),
    }
  }
}
