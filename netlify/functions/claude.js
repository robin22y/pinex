const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')

// Service-key client — writes to usage_events bypass RLS. Created once
// per container (module scope) so warm invocations reuse the client.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

async function logUsageEvent(eventType, metadata) {
  try {
    // Previously this only console.logged — the admin dashboard never
    // saw explain-button usage. Now writes the real usage_events row.
    // Question/answer text is NOT in the payload — symbol + user_id
    // only, consistent with the "never log question text" rule.
    await supabase.from('usage_events').insert({
      event_type: eventType,
      user_id: metadata.user_id || null,
      metadata,
      created_at: new Date().toISOString(),
    })
  } catch (e) {
    // Never block user response on usage logging.
    console.log('[usage_event_failed]', e.message)
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
    const { question = '', context = '', symbol = '', user_id = null } = JSON.parse(event.body || '{}')

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
            'PineX explains data but cannot give investment advice. For buy/sell decisions, please consult a SEBI registered investment adviser.',
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

    // AWAITED deliberately — in a Lambda, un-awaited promises can be
    // frozen when the handler returns and the insert may never land.
    // logUsageEvent catches its own errors so this can't fail the
    // user's response; cost is one small insert (~30 ms).
    await logUsageEvent('explain_button_used', { symbol, user_id })

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
