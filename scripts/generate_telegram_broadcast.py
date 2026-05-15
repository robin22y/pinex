"""
generate_telegram_broadcast.py
Reads top multi-factor stocks + market
internals, generates weekly Telegram message
using Claude, posts to channel.

Run: Sunday after weekly data refresh via GitHub Actions
     or manually: python generate_telegram_broadcast.py [--preview]
"""
import os
import sys
import requests
from datetime import datetime, timezone
from db import supabase

CLAUDE_KEY = os.environ.get('CLAUDE_API_KEY')
TELEGRAM_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHANNEL = (os.environ.get('TELEGRAM_CHANNEL_ID') or '').replace('t.me/', '@')

PREVIEW_ONLY = '--preview' in sys.argv


def get_top_stocks():
    """Get stocks meeting multi-factor criteria."""
    res = supabase.rpc('get_home_stocks').execute()
    stocks = res.data or []

    top = [s for s in stocks if
           s.get('stage') == 'Stage 2' and
           s.get('close', 0) > s.get('ma30w', 0) and
           s.get('close', 0) > s.get('ma50', 0) and
           s.get('avg_delivery_30d', 0) > 40 and
           s.get('vol_ratio', 0) > 1.0 and
           s.get('price_change_7d', 0) > 0]

    top.sort(key=lambda x: x.get('rs_vs_nifty') or -999, reverse=True)
    return top[:10]


def get_market_context():
    """Get latest market internals (last 7 days)."""
    res = (supabase.table('market_internals')
           .select('*')
           .order('date', desc=True)
           .limit(7)
           .execute())
    return res.data or []


def generate_message(stocks, history):
    """Use Claude Haiku to generate the broadcast message."""
    latest = history[0] if history else {}
    prev = history[1] if len(history) > 1 else {}

    breadth_now = latest.get('above_ma150_pct', 0)
    breadth_prev = prev.get('above_ma150_pct', 0)
    stage2_pct = latest.get('stage2_pct', 0)
    vix = latest.get('india_vix', 0)
    nifty = latest.get('nifty_close', 0)

    stock_list = '\n'.join([
        f"- {s['symbol']} ({s.get('sector', '')}) "
        f"RS: {s.get('rs_vs_nifty', 0):.1f}% "
        f"Del: {s.get('avg_delivery_30d', 0):.0f}%"
        for s in stocks[:10]
    ])

    prompt = f"""You are writing a weekly market update for Indian retail investors on a Telegram channel called PineX.

MARKET DATA THIS WEEK:
- Nifty 50: {nifty:,.0f}
- Stocks above 30W MA: {breadth_now:.0f}% (was {breadth_prev:.0f}% last week)
- Stocks in uptrend phase: {stage2_pct:.0f}%
- India VIX: {vix:.1f}

STOCKS MEETING ALL 5 CONDITIONS (Stage 2 + above MAs + high delivery + positive momentum):
{stock_list if stock_list else 'None meeting all criteria this week.'}

Write a Telegram message with these rules:
1. Maximum 200 words
2. Start with market breadth context
3. Mention how many stocks meet all conditions
4. Name top 3 stocks with one factual observation each (delivery, sector, RS)
5. End with one factual market observation
6. NO buy/sell advice, NO price targets
7. Plain language — no jargon
8. Use emojis sparingly (1-2 max)
9. Add disclaimer: "Data for educational purposes only. Not investment advice."

Tone: Factual, calm, informative. Like a knowledgeable friend explaining what the data shows this week."""

    resp = requests.post(
        'https://api.anthropic.com/v1/messages',
        headers={
            'x-api-key': CLAUDE_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        json={
            'model': 'claude-haiku-4-5-20251001',
            'max_tokens': 500,
            'messages': [{'role': 'user', 'content': prompt}],
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()['content'][0]['text']


def save_to_db(message):
    """Save generated message to telegram_broadcasts table for admin editing."""
    try:
        supabase.table('telegram_broadcasts').insert({
            'message': message,
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'status': 'draft',
        }).execute()
    except Exception as e:
        print(f'Warning: could not save to DB: {e}')


def post_to_telegram(message):
    """Post message to Telegram channel."""
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage'
    resp = requests.post(url, json={
        'chat_id': TELEGRAM_CHANNEL,
        'text': message,
        'parse_mode': 'HTML',
        'disable_web_page_preview': True,
    }, timeout=15)
    return resp.json()


def main():
    print('Generating weekly broadcast...')

    stocks = get_top_stocks()
    history = get_market_context()

    print(f'Multi-factor stocks: {len(stocks)}')
    if not stocks:
        print('No stocks meet all criteria — aborting broadcast.')
        return

    if not CLAUDE_KEY:
        print('CLAUDE_API_KEY not set — cannot generate.')
        sys.exit(1)

    message = generate_message(stocks, history)
    print('\nGenerated message:')
    print('-' * 60)
    print(message)
    print('-' * 60)

    save_to_db(message)
    print('Saved to telegram_broadcasts table.')

    if PREVIEW_ONLY:
        print('\n[Preview mode — not posting to Telegram]')
        return

    if not TELEGRAM_TOKEN or not TELEGRAM_CHANNEL:
        print('Telegram not configured — skipping send.')
        return

    result = post_to_telegram(message)
    if result.get('ok'):
        print('\nPosted to Telegram ✅')
        try:
            supabase.table('telegram_broadcasts').update({'status': 'sent'}).eq('status', 'draft').execute()
        except Exception:
            pass
    else:
        print(f'\nTelegram send failed: {result}')
        sys.exit(1)


if __name__ == '__main__':
    main()
