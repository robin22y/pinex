"""
send_reengagement_email.py

Sends personalised re-engagement emails to users who haven't visited
PineX in the last ABSENT_DAYS days.

Runs daily after market close via GitHub Actions (.github/workflows/
daily.yml). Skips users with email_notifications=false. Falls back
to a 7-day calendar lookback for market data so the email never
shows stale "—" values on weekends / NSE holidays.

REQUIRED PROFILE COLUMNS (add via SQL if missing):
  is_active             boolean
  email_notifications   boolean (defaults to true)
  unsubscribe_token     uuid    (per-user token for unsub link)
  last_active_at        timestamptz

USAGE:
  python scripts/send_reengagement_email.py
  python scripts/send_reengagement_email.py --dry-run
  python scripts/send_reengagement_email.py --user=robin22y@gmail.com
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from db import supabase  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent / '.env')

RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
FROM_EMAIL = 'PineX <noreply@pinex.in>'
APP_URL = 'https://pinex.in'

# WHY: 3 days is enough time for meaningful market moves to happen.
# Too soon = annoying. Too late = stale.
ABSENT_DAYS = 3


# ──────────────────────────────────────────────────────────────────
# DATA FETCH
# ──────────────────────────────────────────────────────────────────

def fetch_absent_users():
    """Users absent for ABSENT_DAYS or more, with notifications on."""
    cutoff = (datetime.now() - timedelta(days=ABSENT_DAYS)).isoformat()

    res = (
        supabase.table('profiles')
        .select(
            'id, email, full_name, last_active_at, '
            'academy_completed, unsubscribe_token, email_notifications'
        )
        .eq('is_active', True)
        .neq('email', '')
        .or_(f'last_active_at.lt.{cutoff},last_active_at.is.null')
        .execute()
    )

    return [
        u for u in (res.data or [])
        if u.get('email_notifications', True) is not False
        and u.get('email')
    ]


def fetch_user_watchlist(user_id):
    """User's watchlist with current price + phase merged in."""
    res = (
        supabase.table('watchlists')
        .select('symbol, company_id, reference_date, reference_price')
        .eq('user_id', user_id)
        .limit(10)
        .execute()
    )
    if not res.data:
        return []

    company_ids = [r['company_id'] for r in res.data if r.get('company_id')]
    if not company_ids:
        return []

    # Fetch latest price snapshot. price_change_1d / pct_from_30w may
    # not exist on price_data in every deployment — select '*' so a
    # missing column doesn't break the whole query, then read with
    # .get() defaults.
    price_res = (
        supabase.table('price_data')
        .select('*')
        .in_('company_id', company_ids)
        .eq('is_latest', True)
        .execute()
    )
    price_map = {r['company_id']: r for r in (price_res.data or [])}

    co_res = (
        supabase.table('companies')
        .select('id, symbol, name, sector')
        .in_('id', company_ids)
        .execute()
    )
    co_map = {r['id']: r for r in (co_res.data or [])}

    stocks = []
    for row in res.data:
        cid = row.get('company_id')
        if not cid:
            continue
        price = price_map.get(cid, {})
        co = co_map.get(cid, {})

        close = _safe_float(price.get('close'))
        ma30w = _safe_float(price.get('ma30w'))

        # pct_from_30w: prefer DB column, else compute on the fly.
        pct_from_ma = price.get('pct_from_30w')
        if pct_from_ma is None and ma30w and ma30w > 0 and close is not None:
            pct_from_ma = (close - ma30w) / ma30w * 100

        # Return since user started watching.
        ref_price = _safe_float(row.get('reference_price')) or close
        ret_pct = None
        if ref_price and ref_price > 0 and close is not None:
            ret_pct = (close - ref_price) / ref_price * 100

        stocks.append({
            'symbol':       co.get('symbol') or row.get('symbol', ''),
            'name':         co.get('name', ''),
            'sector':       co.get('sector', ''),
            'stage':        price.get('stage', ''),
            'substage':     price.get('weinstein_substage', ''),
            'rs':           _safe_float(price.get('rs_vs_nifty')) or 0,
            'pct_from_ma':  pct_from_ma or 0,
            'change_1d':    _safe_float(price.get('price_change_1d')) or 0,
            'close':        close or 0,
            'ret_pct':      ret_pct,
        })

    return stocks


def fetch_market_data():
    """Latest breadth + SwingX + Nifty snapshot for the header."""
    mi = (
        supabase.table('market_internals')
        .select('*')
        .gt('above_ma30w_pct', 0)
        .order('date', desc=True)
        .limit(2)
        .execute()
    )
    today_mi = mi.data[0] if mi.data else {}
    prev_mi = mi.data[1] if len(mi.data or []) > 1 else {}

    breadth_today = _safe_float(today_mi.get('above_ma30w_pct')) or 0
    breadth_prev = _safe_float(prev_mi.get('above_ma30w_pct')) or 0
    breadth_change = breadth_today - breadth_prev if breadth_prev else 0

    swingx = (
        supabase.table('swingx_entries')
        .select('id', count='exact', head=True)
        .eq('is_active', True)
        .execute()
    )
    swingx_count = swingx.count or 0

    swingx_stocks = (
        supabase.table('swingx_entries')
        .select('symbol, sector')
        .eq('is_active', True)
        .execute()
    )
    sector_counts = {}
    for s in (swingx_stocks.data or []):
        sec = s.get('sector') or 'Other'
        sector_counts[sec] = sector_counts.get(sec, 0) + 1
    top_sectors = sorted(
        sector_counts.items(), key=lambda x: x[1], reverse=True
    )[:3]

    return {
        'breadth':        breadth_today,
        'breadth_change': breadth_change,
        'nifty':          _safe_float(today_mi.get('nifty_close')) or 0,
        'vix':            _safe_float(today_mi.get('india_vix')) or 0,
        'stage2_pct':     _safe_float(today_mi.get('stage2_pct')) or 0,
        'swingx_count':   swingx_count,
        'top_sectors':    top_sectors,
        'market_date':    today_mi.get('date', date.today().isoformat()),
    }


def _safe_float(v):
    if v is None or v == '':
        return None
    try:
        n = float(v)
        return n if n == n else None  # NaN guard
    except (TypeError, ValueError):
        return None


# ──────────────────────────────────────────────────────────────────
# COPY HELPERS
# ──────────────────────────────────────────────────────────────────

def get_breadth_message(breadth):
    """SEBI-safe factual statement + neutral context line."""
    if breadth >= 60:
        return (
            'above 60% of NSE stocks are trading above their '
            '30-week trend lines.',
            'Broad participation in the current market move.',
        )
    if breadth >= 45:
        return (
            f'{breadth:.0f}% of NSE stocks are above their '
            '30-week trend lines.',
            'Mixed conditions — selective participation.',
        )
    return (
        f'only {breadth:.0f}% of NSE stocks are above their '
        '30-week trend lines.',
        'Narrow participation — fewer stocks participating.',
    )


def get_rotation_question(breadth, swingx_count):
    """Rotating neutral question — never a directive."""
    if breadth >= 60:
        return (
            f'Breadth is at {breadth:.0f}% today.',
            'What does your cycle framework tell you about the '
            'current conditions?',
        )
    if breadth >= 45:
        return (
            f'{swingx_count} stocks are passing all PineX cycle '
            'filters today.',
            'How many of them align with your watchlist sectors?',
        )
    return (
        f'Breadth has narrowed to {breadth:.0f}%.',
        'How many of your watchlist stocks are still above their '
        '30-week trend lines?',
    )


def stage_display(stage):
    return {
        'Stage 1': 'Basing',
        'Stage 2': 'Advancing',
        'Stage 3': 'Topping',
        'Stage 4': 'Declining',
    }.get(stage, stage or '—')


def stage_color(stage):
    return {
        'Stage 2': '#00C805', 'Advancing': '#00C805',
        'Stage 1': '#FBBF24', 'Basing':    '#FBBF24',
        'Stage 3': '#FB923C', 'Topping':   '#FB923C',
        'Stage 4': '#FF3B30', 'Declining': '#FF3B30',
    }.get(stage, '#64748B')


def _sign(n):
    return '+' if n is not None and n > 0 else ''


# ──────────────────────────────────────────────────────────────────
# HTML BUILDER
# ──────────────────────────────────────────────────────────────────

def build_email_html(user, watchlist, market):
    """Full HTML email — dark theme matching the PineX app."""
    name = (
        user.get('full_name')
        or (user.get('email') or '').split('@')[0]
    )
    name = (name.split() or [name])[0].title() if name else 'there'

    unsubscribe_token = user.get('unsubscribe_token') or ''
    unsubscribe_url = f'{APP_URL}/unsubscribe?token={unsubscribe_token}'

    breadth        = market['breadth']
    breadth_change = market['breadth_change']
    swingx_count   = market['swingx_count']
    top_sectors    = market['top_sectors']
    market_date    = market['market_date']
    nifty          = market['nifty']
    vix            = market['vix']

    breadth_stat, breadth_context = get_breadth_message(breadth)
    q_stat, q_question = get_rotation_question(breadth, swingx_count)

    try:
        dt = datetime.strptime(market_date, '%Y-%m-%d')
        date_str = dt.strftime('%d %B %Y')
    except Exception:
        date_str = str(market_date)

    # Split watchlist by phase grouping
    advancing = [
        s for s in watchlist
        if s['stage'] in ('Stage 2', 'Advancing')
    ]
    other_stages = [
        s for s in watchlist
        if s['stage'] and s['stage'] not in ('Stage 2', 'Advancing')
    ]

    breadth_band_color = (
        '#00C805' if breadth >= 50
        else '#FBBF24' if breadth >= 35
        else '#FF3B30'
    )

    def stock_row_html(s):
        """One <tr> for the watchlist table. Pre-computes colors and
        signs so the f-string stays Python 3.11-compatible (no
        nested same-quote expressions inside {...})."""
        sc = stage_color(s['stage'])
        sd = stage_display(s['stage'])
        rs = s.get('rs') or 0
        pma = s.get('pct_from_ma') or 0
        ret = s.get('ret_pct')

        rs_color  = '#00C805' if rs > 0 else '#FF3B30' if rs < 0 else '#64748B'
        ret_color = '#00C805' if (ret or 0) >= 0 else '#FF3B30'

        rs_sign  = _sign(rs)
        pma_sign = _sign(pma)
        ret_sign = '+' if (ret or 0) >= 0 else ''

        raw_name = s.get('name') or s.get('symbol') or ''
        name_str = raw_name[:28] + '…' if len(raw_name) > 28 else raw_name

        ret_block = ''
        if ret is not None:
            ret_block = (
                f'<div style="margin-top:2px">'
                f'<span style="color:{ret_color};font-weight:700">'
                f'{ret_sign}{ret:.1f}%</span></div>'
            )

        return (
            '<tr>'
            '<td style="padding:10px 0;border-bottom:1px solid #1E2530;">'
            f'<div style="font-size:14px;font-weight:700;color:#E2E8F0;font-family:monospace;">{s["symbol"]}</div>'
            f'<div style="font-size:11px;color:#475569;margin-top:1px;">{name_str}</div>'
            '</td>'
            '<td style="padding:10px 8px;border-bottom:1px solid #1E2530;text-align:center;">'
            f'<span style="font-size:11px;font-weight:700;color:{sc};background:{sc}20;padding:2px 8px;border-radius:4px;white-space:nowrap;">{sd}</span>'
            '</td>'
            '<td style="padding:10px 0;border-bottom:1px solid #1E2530;text-align:right;">'
            f'<div style="font-size:12px;color:{rs_color};font-weight:700;">{rs_sign}{rs:.1f}%</div>'
            '<div style="font-size:10px;color:#334155;">RS vs Nifty</div>'
            '</td>'
            '<td style="padding:10px 0 10px 8px;border-bottom:1px solid #1E2530;text-align:right;">'
            f'<div style="font-size:12px;color:#E2E8F0;font-weight:600;">{pma_sign}{pma:.1f}%</div>'
            '<div style="font-size:10px;color:#334155;">vs MA</div>'
            f'{ret_block}'
            '</td>'
            '</tr>'
        )

    rows_html = ''
    if advancing:
        rows_html += (
            '<tr><td colspan="4" style="padding:6px 0 4px;font-size:10px;'
            'font-weight:700;color:#00C805;text-transform:uppercase;'
            'letter-spacing:0.08em;">Advancing phase</td></tr>'
        )
        rows_html += ''.join(stock_row_html(s) for s in advancing)
    if other_stages:
        rows_html += (
            '<tr><td colspan="4" style="padding:10px 0 4px;font-size:10px;'
            'font-weight:700;color:#475569;text-transform:uppercase;'
            'letter-spacing:0.08em;">Other phases</td></tr>'
        )
        rows_html += ''.join(stock_row_html(s) for s in other_stages)

    # Sector rows
    sector_rows_html = ''.join(
        '<tr>'
        '<td style="padding:8px 0;border-bottom:1px solid #1E2530;font-size:13px;color:#E2E8F0;">'
        f'{sec}</td>'
        '<td style="padding:8px 0;border-bottom:1px solid #1E2530;text-align:right;'
        'font-size:13px;font-weight:700;color:#00C805;font-family:monospace;">'
        f'{count} stocks</td>'
        '</tr>'
        for sec, count in top_sectors
    )

    arrow = '↑' if breadth_change > 0 else '↓' if breadth_change < 0 else '→'
    arrow_color = (
        '#00C805' if breadth_change > 0
        else '#FF3B30' if breadth_change < 0
        else '#475569'
    )

    # Optional academy nudge
    academy_section = ''
    if not user.get('academy_completed'):
        academy_section = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.2);border-radius:10px;padding:16px;">
              <div style="font-size:13px;font-weight:700;color:#FBBF24;margin-bottom:4px;">🎓 Complete PineX Academy</div>
              <div style="font-size:12px;color:#94A3B8;line-height:1.6;margin-bottom:12px;">8 minutes. Unlock the full screener, SwingX list, and earn your certificate.</div>
              <a href="{APP_URL}/learn" style="display:inline-block;background:#FBBF24;color:#000;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:700;">Start learning →</a>
            </td>
          </tr>
        </table>"""

    if rows_html:
        watchlist_section = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:#0F1217;border:1px solid #1E2530;border-radius:12px;padding:20px;">
              <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:14px;">Your watchlist</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px;border-bottom:1px solid #1E2530;">Stock</td>
                  <td style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px;border-bottom:1px solid #1E2530;text-align:center;">Phase</td>
                  <td style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px;border-bottom:1px solid #1E2530;text-align:right;">RS</td>
                  <td style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px;border-bottom:1px solid #1E2530;text-align:right;">vs MA</td>
                </tr>
                {rows_html}
              </table>
              <div style="margin-top:14px;text-align:center;">
                <a href="{APP_URL}/dashboard" style="display:inline-block;background:transparent;border:1px solid #1E2530;color:#94A3B8;padding:7px 20px;border-radius:6px;text-decoration:none;font-size:11px;">View full watchlist →</a>
              </div>
            </td>
          </tr>
        </table>"""
    else:
        watchlist_section = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:#0F1217;border:1px solid #1E2530;border-radius:12px;padding:20px;text-align:center;">
              <div style="font-size:13px;color:#475569;margin-bottom:12px;">You haven't added any stocks to your watchlist yet.</div>
              <a href="{APP_URL}" style="display:inline-block;background:#00C805;color:#000;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:700;">Search stocks →</a>
            </td>
          </tr>
        </table>"""

    sectors_section = ''
    if top_sectors:
        sectors_section = f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr>
            <td style="background:#0F1217;border:1px solid #1E2530;border-radius:12px;padding:20px;">
              <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">⚡ SwingX — sectors with most stocks passing all cycle filters</div>
              <div style="font-size:10px;color:#334155;margin-bottom:14px;font-style:italic;">Factual filter data only. Not a recommendation.</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                {sector_rows_html}
              </table>
              <div style="margin-top:14px;">
                <a href="{APP_URL}?filter=swingx" style="display:inline-block;background:rgba(0,200,5,0.1);border:1px solid rgba(0,200,5,0.3);color:#00C805;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:700;">View all SwingX stocks →</a>
              </div>
            </td>
          </tr>
        </table>"""

    html = f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PineX — Market update</title>
</head>
<body style="margin:0;padding:0;background:#060810;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#060810;padding:24px 16px 48px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

  <!-- Header -->
  <tr>
    <td style="background:#0F1217;border-radius:16px 16px 0 0;border:1px solid #1E2530;border-bottom:none;padding:24px 24px 0;position:relative;">
      <div style="height:2px;background:linear-gradient(90deg,transparent,#00C805,transparent);margin:-24px -24px 20px;border-radius:16px 16px 0 0;"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td>
            <span style="font-size:22px;font-weight:800;color:#E2E8F0;letter-spacing:-0.03em;">
              pine<span style="color:#00C805;font-weight:900;font-size:26px;">X</span>
            </span>
          </td>
          <td style="text-align:right;">
            <span style="font-size:11px;color:#334155;">{date_str}</span>
          </td>
        </tr>
      </table>

      <div style="font-size:24px;font-weight:800;color:#E2E8F0;letter-spacing:-0.03em;line-height:1.2;margin-bottom:6px;">
        The market moved, {name}.
      </div>
      <div style="font-size:14px;color:#64748B;line-height:1.6;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #1E2530;">
        Here is what changed in your universe since you last visited.
      </div>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td width="33%" style="padding:12px;background:#151A22;border-radius:8px;text-align:center;">
            <div style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Breadth</div>
            <div style="font-size:20px;font-weight:800;color:{breadth_band_color};font-family:monospace;">{breadth:.0f}%</div>
            <div style="font-size:10px;color:{arrow_color};font-weight:700;">{arrow} vs prev</div>
          </td>
          <td width="4%"></td>
          <td width="30%" style="padding:12px;background:#151A22;border-radius:8px;text-align:center;">
            <div style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">SwingX</div>
            <div style="font-size:20px;font-weight:800;color:#00C805;font-family:monospace;">{swingx_count}</div>
            <div style="font-size:10px;color:#334155;">passing filters</div>
          </td>
          <td width="4%"></td>
          <td width="29%" style="padding:12px;background:#151A22;border-radius:8px;text-align:center;">
            <div style="font-size:9px;color:#334155;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Nifty</div>
            <div style="font-size:16px;font-weight:800;color:#E2E8F0;font-family:monospace;">{nifty:,.0f}</div>
            <div style="font-size:10px;color:#334155;">VIX {vix:.1f}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#0B0E11;border:1px solid #1E2530;border-top:none;border-bottom:none;padding:24px;">
      {watchlist_section}
      {academy_section}
      {sectors_section}

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="background:#0F1217;border:1px solid #1E2530;border-left:3px solid {breadth_band_color};border-radius:0 10px 10px 0;padding:16px;">
            <div style="font-size:12px;font-weight:700;color:#E2E8F0;margin-bottom:6px;">Market breadth today: {breadth_stat}</div>
            <div style="font-size:11px;color:#64748B;line-height:1.6;">{breadth_context}</div>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr>
          <td style="background:rgba(255,255,255,0.03);border:1px solid #1E2530;border-radius:10px;padding:18px;">
            <div style="font-size:11px;color:#475569;margin-bottom:6px;">{q_stat}</div>
            <div style="font-size:15px;font-weight:700;color:#E2E8F0;line-height:1.5;">{q_question}</div>
            <div style="margin-top:14px;">
              <a href="{APP_URL}" style="display:inline-block;background:#00C805;color:#000;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">Open PineX →</a>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0F1217;border:1px solid #1E2530;border-top:none;border-radius:0 0 16px 16px;padding:18px 24px;">
      <div style="font-size:10px;color:#334155;line-height:1.8;margin-bottom:10px;">
        All data is end-of-day (EOD) and factual. Phase classifications are generated by automated algorithm. Nothing on this platform constitutes investment advice, a research report, or a recommendation to buy, sell, or hold any security.<br><br>
        PineX is not registered with SEBI as a Research Analyst or Investment Adviser. Users are solely responsible for their own investment decisions.
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="font-size:10px;color:#334155;">
            <a href="{APP_URL}" style="color:#334155;text-decoration:none;">pinex.in</a>
          </td>
          <td style="text-align:right;font-size:10px;">
            <a href="{unsubscribe_url}" style="color:#334155;text-decoration:underline;">Unsubscribe</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""

    return html


# ──────────────────────────────────────────────────────────────────
# SEND
# ──────────────────────────────────────────────────────────────────

def send_email(to_email, subject, html, dry_run=False):
    """Send via Resend API."""
    if dry_run:
        print(f'  [DRY RUN] Would send to: {to_email}')
        return True
    try:
        res = requests.post(
            'https://api.resend.com/emails',
            headers={
                'Authorization': f'Bearer {RESEND_API_KEY}',
                'Content-Type': 'application/json',
            },
            json={
                'from': FROM_EMAIL,
                'to': [to_email],
                'subject': subject,
                'html': html,
            },
            timeout=15,
        )
        return res.status_code in (200, 201)
    except Exception as e:
        print(f'    Resend error: {e}')
        return False


def get_subject_line(name, market):
    """Rotating subject lines based on day-of-week to avoid fatigue."""
    breadth = market['breadth']
    swingx  = market['swingx_count']
    subjects = [
        f'{name}, the market moved while you were away',
        f'Your watchlist update — {swingx} stocks passing all cycle filters',
        f'Breadth at {breadth:.0f}% — what changed in your stocks',
        f'{name} — PineX market data for today',
        f'{swingx} stocks passing SwingX filters · Your watchlist update',
    ]
    idx = datetime.now().weekday() % len(subjects)
    return subjects[idx]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview without sending')
    parser.add_argument('--user', type=str, default=None,
                        help='Send to a specific email only')
    parser.add_argument('--limit', type=int, default=500,
                        help='Max users to email per run')
    args = parser.parse_args()

    if not RESEND_API_KEY and not args.dry_run:
        print('ERROR: RESEND_API_KEY not set')
        sys.exit(1)

    print('Fetching market data...')
    market = fetch_market_data()
    print(
        f'  Breadth: {market["breadth"]:.0f}%  '
        f'SwingX: {market["swingx_count"]}  '
        f'Nifty: {market["nifty"]:,.0f}'
    )

    if args.user:
        res = (
            supabase.table('profiles')
            .select('*')
            .eq('email', args.user)
            .maybe_single()
            .execute()
        )
        users = [res.data] if res.data else []
    else:
        print(f'Fetching users absent {ABSENT_DAYS}+ days...')
        users = fetch_absent_users()
        users = users[:args.limit]

    print(f'Users to email: {len(users)}')

    sent = failed = skipped = 0
    for user in users:
        email = user.get('email', '')
        if not email:
            skipped += 1
            continue

        name = (
            user.get('full_name')
            or email.split('@')[0]
        )
        first = (name.split() or [name])[0].title()

        print(f'  Processing {email}...', end='', flush=True)

        watchlist = fetch_user_watchlist(user['id'])
        html = build_email_html(user, watchlist, market)
        subject = get_subject_line(first, market)

        ok = send_email(email, subject, html, dry_run=args.dry_run)
        if ok:
            sent += 1
            print(' ✓')
        else:
            failed += 1
            print(' ✗')

    print(f'\nDone! Sent={sent} Failed={failed} Skipped={skipped}')


if __name__ == '__main__':
    main()
