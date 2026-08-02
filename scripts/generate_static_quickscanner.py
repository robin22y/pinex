"""generate_static_quickscanner.py — Screener, a static multi-condition
screener.

Writes static_build/quickscanner.html. STAGING ONLY: nothing here
publishes, deploys, or touches the React app.

    python scripts/generate_static_quickscanner.py

── WHERE THE TICKERS LINK ───────────────────────────────────────────────
  /stock/<SYMBOL> — the LIVE React route (App.jsx:399), not a generated
  static file.

  Earlier drafts linked to /stock/<SYMBOL>.html, which would have needed
  a generate_static_stock_pages.py that does not exist; every one of the
  2,122 links 404'd. Pointing at the running app fixes that with no new
  script, and the destination is the real stock page with live data
  rather than a nightly snapshot of it.

  The URL shape is copied from how the app links to itself everywhere
  (Home.jsx, Dashboard.jsx, SearchPage.jsx all use `/stock/${symbol}`),
  so these links behave identically to an in-app click — including
  PublicGate / AcademyGate, which will gate a signed-out or free-tier
  visitor exactly as it does anywhere else in the product. That is
  existing behaviour, not something this page introduces.

  Symbols are percent-encoded (M&M -> /stock/M%26M). React Router
  decodes route params, so the component receives "M&M" either way.

── HOW MULTI-SELECT WORKS WITH ZERO JAVASCRIPT ──────────────────────────
  The obvious design - one pre-rendered panel per condition - can only
  ever show one condition, because CSS cannot compute the intersection of
  panels that were baked separately. Radio inputs enforced that limit.

  So the architecture is inverted. Every stock is emitted ONCE, tagged
  with a short class per condition it satisfies:

      <a class="a c e l" href="/stock/RELIANCE.html">...

  Each filter then contributes one hide rule:

      #c0:checked ~ main a:not(.a) { display: none }

  A row survives only if it carries the class for EVERY checked filter,
  which is exactly AND. Eleven checkboxes cover all 2,048 combinations
  with eleven rules and no script. Plain sibling combinators only - no
  :has(), so support goes back years.

  Requirement: the inputs must be siblings that PRECEDE `main`. Both live
  directly inside the <form>, which is what makes `~ main` resolve.

── WHY STAGE IS RADIO AND THE REST ARE CHECKBOXES ───────────────────────
  Stages are mutually exclusive - a stock is Basing or Advancing, never
  both. As checkboxes, ticking two would AND to zero results every time,
  which reads as a broken page rather than an empty set. As a radio group
  with an "Any stage" default it behaves correctly and cannot produce
  that dead end. The technical conditions genuinely combine, so those are
  checkboxes.

── CLEARING FILTERS ─────────────────────────────────────────────────────
  <button type="reset"> inside the form. That is HTML, not script: the
  browser restores every input to its parsed default. CSS cannot uncheck
  a box, so this is the only zero-JS reset available.

── WHAT THIS DESIGN CANNOT DO ───────────────────────────────────────────
  1. Live result counts. CSS cannot count matched elements, so the menu
     shows how many stocks meet each condition ON ITS OWN. The combined
     total is not shown because it cannot be computed without script.
  2. Cap the visible rows. `nth-child` counts all siblings, not the
     visible ones, so a post-filter limit is impossible. Every stock is
     in the DOM. A single broad filter therefore still yields a long
     list; adding conditions is what narrows it. That is inherent to a
     screener, and the per-condition counts in the menu tell you in
     advance how broad a filter is.

── DATA SOURCES ─────────────────────────────────────────────────────────
  companies                        id, symbol; active = is_suspended is
                                   not true AND is_index_proxy is not true
  price_data WHERE is_latest       close, stage, dma_50/150/200,
                                   vol_ratio, rsi, ma30w, high_52w,
                                   low_52w, date
  price_data WHERE stage NOT NULL  company_id, date, stage - the history
                                   weeks-in-stage is derived from

  Not used: stage_flags is empty (0 rows); delivery_signals
  .weeks_in_stage2 is Stage-2-only. No stored weeks-in-current-stage
  column exists anywhere - it is computed here.

── WEEKS-IN-STAGE ───────────────────────────────────────────────────────
  price_data.stage flickers between adjacent stages day to day as price
  oscillates around its 30-week line, so a raw consecutive-session count
  resets on every one-day excursion. Stage analysis is weekly, so the
  series is resampled to one reading per ISO week (the week's last
  session) before counting back.

  CEILING: stage is populated on ~110k of ~275k price_data rows, so the
  figure is a floor, not the true age of the stage.

── DISCLAIMER ───────────────────────────────────────────────────────────
  The four footer paragraphs are verbatim from
  src/components/layout/Footer.jsx, which warns the copy is
  product-legal text reused on the disclaimer page, the Telegram
  broadcast footer and the WelcomeModal consent block. Its nav links are
  omitted: the brief asks for the disclaimer and forbids calls to action.
"""
from __future__ import annotations

import html
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import quote

from db import supabase

OUT_DIR = Path(__file__).resolve().parent.parent / "static_build"
OUT_FILE = OUT_DIR / "quickscanner.html"

READ_PAGE = 1000
SUPABASE_SLEEP = 0.1

# Trading sessions in a month. avg_volume_30d is a DAILY average over a
# 30-calendar-day window; multiplying by 30 would bill the user for
# weekends the exchange never opened.
SESSIONS_PER_MONTH = 21

# Transfer-size ceiling, measured compressed because that is what a phone
# on a slow connection actually pays for. 80 KB gzip is roughly 55-60 KB
# brotli — comfortably inside one round trip's worth of data.
WIRE_BUDGET = 80 * 1024

STAGE_TO_COLUMN = {
    "stage1": "basing", "stage1+": "basing", "stage2": "advancing",
    "stage3": "topping", "stage4": "declining",
}

# Muted print inks. stageUi.js uses #38BDF8 / #16A34A / #D97706 / #DC2626,
# tuned for a dark neon shell — the same hues at newspaper saturation.
STAGE_ORDER = ["basing", "advancing", "topping", "declining"]
STAGE_LABEL = {"basing": "Basing", "advancing": "Advancing",
               "topping": "Topping", "declining": "Declining"}
# CSS custom properties, not literals — the palette flips between the dark
# default and the light variant in one media query, and hardcoding hex
# here would freeze the stage edges to one theme.
STAGE_VAR = {"basing": "--t-basing", "advancing": "--t-advancing",
             "topping": "--t-topping", "declining": "--t-declining"}

DISCLAIMER = [
    "PineX displays historical market behaviour and market-structure "
    "observations. It does not provide investment advice, recommendations, "
    "or trade instructions.",
    "Always independently verify all data at nseindia.com before making "
    "any financial decision.",
    "Consult a SEBI-registered investment adviser for personalised guidance.",
    "PineX is not a SEBI-registered Investment Adviser.",
]

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def num(v):
    """float or None. Guards NaN, which compares false against everything
    and would slip through a `> x` test as a silent exclusion."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f


def normalize_stage(raw):
    if raw is None:
        return None
    key = "".join(str(raw).strip().lower().split()).replace("-", "")
    return STAGE_TO_COLUMN.get(key)


def fmt_date(iso: str) -> str:
    """Hand-parsed so a date-only string is never widened to UTC midnight
    and shifted back a day by the local timezone."""
    parts = str(iso)[:10].split("-")
    if len(parts) != 3:
        return str(iso)
    try:
        return f"{int(parts[2])} {MONTHS[int(parts[1]) - 1]} {parts[0]}"
    except (ValueError, IndexError):
        return str(iso)


# ════════════════════════════════════════════════════════════════════════
# Checkbox filters. Order defines the menu; `cls` is the single-character
# class stamped on matching rows. Single characters because this markup is
# repeated ~2,100 times and every byte is multiplied by that.
# ════════════════════════════════════════════════════════════════════════
def _above(field):
    return lambda r: r[field] is not None and r["close"] > r[field]


def _ma_stack(r):
    a, b, c = r["dma_50"], r["dma_150"], r["dma_200"]
    if None in (a, b, c):
        return False
    # A real stack, not merely "above all three": price over the 50 AND the
    # averages in descending order. The ordering is what distinguishes an
    # established trend from a fresh bounce off a falling average.
    return r["close"] > a > b > c


def _vol(mult):
    return lambda r: r["vol_ratio"] is not None and r["vol_ratio"] >= mult


def _below(field):
    return lambda r: r[field] is not None and r["close"] < r[field]


FILTERS = [
    # (cls, label, group, predicate)
    ("a", "Above 50 DMA",        "Price above average", _above("dma_50")),
    ("b", "Above 150 DMA",       "Price above average", _above("dma_150")),
    ("c", "Above 200 DMA",       "Price above average", _above("dma_200")),
    ("d", "Full MA stack",       "Price above average", _ma_stack),

    # The inverse screens. Ticking "Above 50 DMA" and "Below 50 DMA"
    # together yields zero, which is correct for an AND — they are
    # contradictory, not a bug.
    ("k", "Below 50 DMA",        "Price below average", _below("dma_50")),
    ("l", "Below 150 DMA",       "Price below average", _below("dma_150")),
    ("m", "Below 200 DMA",       "Price below average", _below("dma_200")),

    # "normal" said nothing about what the comparison is against. The
    # baseline is the mean of non-zero volumes over the 30 sessions BEFORE
    # today (fetch_bhav_daily.py, vol_ratio), and it is NULL below 20 such
    # sessions — so the label now names the window it actually uses.
    ("e", "Volume 1.2x 30-session avg", "Volume", _vol(1.2)),
    ("f", "Volume 1.5x 30-session avg", "Volume", _vol(1.5)),
    ("g", "Volume 2x 30-session avg",   "Volume", _vol(2.0)),

    ("h", "Near 52-week low",    "52-week low",
     lambda r: r["low_52w"] is not None and r["low_52w"] > 0
     and r["close"] <= r["low_52w"] * 1.05),

    # ── New highs / new lows ────────────────────────────────────────
    # high_52w and low_52w are the max/min CLOSE over a rolling
    # 252-session window ending today, inclusive (fetch_bhav_daily.py).
    # Today's close is inside that window, so a stock setting a new high
    # has close == high_52w exactly. The 0.999 / 1.001 tolerance absorbs
    # numeric-rounding drift between the stored numeric and the close,
    # nothing more — it is not a "near" band.
    #
    # NO NULL CAVEAT IN THE LABEL. Measured on the current page: 2,122 of
    # 2,122 rows carry a usable 52-week high, so exclusion would be
    # invisible. The None guards stay anyway — a new listing hits them.
    ("t", "New 52-week high", "New highs and lows",
     lambda r: r["high_52w"] is not None and r["high_52w"] > 0
     and r["close"] >= r["high_52w"] * 0.999),
    ("u", "New 52-week low",  "New highs and lows",
     lambda r: r["low_52w"] is not None and r["low_52w"] > 0
     and r["close"] <= r["low_52w"] * 1.001),

    # Reuses the vol_ratio thresholds above — same field, same baseline,
    # grouped so a user looking for "unusual activity" finds it without
    # knowing the word ratio.
    ("v", "3x 30-session avg", "High volume activity", _vol(3.0)),
    ("w", "5x 30-session avg", "High volume activity", _vol(5.0)),
]

# "RSI and trend" (RSI 50-70, Above 30-week trend) was removed as a
# section. Classes "i" and "j" are now unused; new filters take letters
# from "t" onward rather than reusing them, so a stale bookmark or cached
# stylesheet cannot silently map an old class onto a new meaning.

# Stage radio classes, kept out of FILTERS because they are single-select.
STAGE_CLS = {"basing": "p", "advancing": "q", "topping": "r", "declining": "s"}

# ── Distance BELOW the 52-week high ─────────────────────────────────────
# Tolerance bands, tightest first. These replaced a single "Near 52-week
# high" checkbox, which only ever answered "within 5%".
#
# ALWAYS BELOW, NEVER ABOVE
#   The 52-week high IS the highest close of the last 52 weeks, so a
#   stock cannot trade above it — the most it can do is equal it by
#   setting a new high today (0% away). Every value here is therefore a
#   distance DOWN from the high, and today 0 of 2,123 stocks sit at a new
#   high.
#
#   The old wording ("Within 15% of high") left the direction implicit
#   and read as though a stock might be 15% ABOVE its high. Labels now
#   say "below" explicitly, and each row prints its own distance so there
#   is nothing left to infer.
#
# WHY RADIO AND NOT A <select> DROPDOWN
#   A <select> cannot drive this. CSS has no selector that responds to a
#   select's VALUE — :checked exists for radio/checkbox, but there is no
#   equivalent for <option> that can reach a sibling and hide rows. A
#   dropdown would need JavaScript to do anything at all.
#
#   So the control is a radio group (correct anyway: the bands are nested,
#   so picking a tolerance is inherently single-select), wrapped in
#   <details> so it collapses to one line like a dropdown. Zero script,
#   same compactness, and it stays keyboard operable.
#
# WHY ONE CLASS PER STOCK, NOT ONE PER BAND IT SATISFIES
#   The bands nest: a stock 3% off its high is inside every band. Tagging
#   all of them would put up to 8 classes on every row, and this markup
#   repeats ~2,100 times. Instead each stock carries exactly ONE class —
#   its TIGHTEST band — and the rule for a looser band excludes every
#   tighter one by chaining :not(). Eight rules, one class per row.
#
# A stock further than the widest band gets no class at all, so it is
# hidden by any band selection, which is the correct behaviour.
HIGH_BANDS = [
    (5,  "n1"), (10, "n2"), (15, "n3"), (20, "n4"),
    (25, "n5"), (30, "n6"), (40, "n7"), (50, "n8"),
]


def high_distance(r) -> float | None:
    """Percent BELOW the 52-week high, as a positive number. 0 = at the
    high. None when there is no usable 52-week high to measure against."""
    high = r["high_52w"]
    if high is None or high <= 0:
        return None
    drop = (high - r["close"]) / high * 100.0
    return max(0.0, drop)


def high_band_cls(dist: float | None) -> str | None:
    """The tightest band this distance falls inside."""
    if dist is None:
        return None
    for pct, cls in HIGH_BANDS:
        if dist <= pct:
            return cls
    return None


def _slug(text: str) -> str:
    """'Price above average' -> 'priceaboveaverage'. Used for the per-group
    <details> ids the ".on" rules target."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


STAGE_LABEL = {"basing": "Basing", "advancing": "Advancing",
               "topping": "Topping", "declining": "Declining"}


def vol_label(mvol: float | None) -> str:
    """Average monthly share volume, compact. Longest output across the
    live universe is 6 chars ("100.1K"), so the right-hand column cannot
    push the ticker off a 390px row."""
    if mvol is None:
        return "—"
    n = float(mvol)
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            return f"{n / div:.1f}{suf}"
    return str(int(n))


def high_label(dist: float | None) -> str:
    """Line 2 of a tile. Spells out the direction — the whole point is
    that "12.4%" alone does not say below what, or which way."""
    if dist is None:
        return "no 52w high"
    if dist < 0.05:
        return "at 52w high"
    return f"{dist:.1f}% below"


# ════════════════════════════════════════════════════════════════════════
def _paginate(build):
    start = 0
    while True:
        resp = build(start, start + READ_PAGE - 1).execute()
        time.sleep(SUPABASE_SLEEP)
        batch = resp.data or []
        yield batch
        if len(batch) < READ_PAGE:
            return
        start += READ_PAGE


def fetch_active_symbols() -> dict[str, str]:
    rows: list[dict] = []
    for batch in _paginate(
        lambda a, b: supabase.table("companies")
        .select("id,symbol,is_suspended,is_index_proxy").order("id").range(a, b)
    ):
        rows.extend(batch)
    # Filtered in Python: PostgREST `neq.true` drops NULL rows, because
    # NULL <> true is NULL rather than true.
    out = {
        r["id"]: r["symbol"] for r in rows
        if r.get("is_suspended") is not True
        and r.get("is_index_proxy") is not True and r.get("symbol")
    }
    print(f"  {len(rows):,} companies, {len(out):,} active with a symbol")
    return out


def fetch_latest() -> tuple[dict[str, dict], str | None]:
    latest: dict[str, dict] = {}
    as_of = None
    for batch in _paginate(
        lambda a, b: supabase.table("price_data")
        .select("company_id,date,close,stage,dma_50,dma_150,dma_200,"
                "vol_ratio,rsi,ma30w,high_52w,low_52w,avg_volume_30d")
        .eq("is_latest", True).order("company_id").range(a, b)
    ):
        for r in batch:
            latest[r["company_id"]] = r
            d = r.get("date")
            if d and (as_of is None or d > as_of):
                as_of = d
    print(f"  {len(latest):,} latest price_data rows (as of {as_of})")
    return latest, as_of


def fetch_stage_history() -> dict[str, list[tuple[str, str]]]:
    """Filtering stage IS NOT NULL server-side cuts this from ~275 pages to
    ~111: 60% of price_data predates stage classification.

    Ordered (company_id, date, id) — the id tiebreaker makes it a total
    order, which is what stops .range() pagination skipping rows.
    """
    hist: dict[str, list[tuple[str, str]]] = {}
    rows = page = 0
    for batch in _paginate(
        lambda a, b: supabase.table("price_data")
        .select("company_id,date,stage").not_.is_("stage", "null")
        .order("company_id").order("date").order("id").range(a, b)
    ):
        for r in batch:
            hist.setdefault(r["company_id"], []).append((r["date"], r["stage"]))
            rows += 1
        page += 1
        if page % 40 == 0:
            print(f"  scanned {rows:,} stage rows ({page} pages)")
    print(f"  scanned {rows:,} stage rows across {len(hist):,} companies")
    return hist


def weeks_in_stage(history) -> tuple[int, int]:
    weekly: dict[tuple[int, int], tuple[str, str | None]] = {}
    for iso_date, raw in history:
        try:
            d = date.fromisoformat(str(iso_date)[:10])
        except ValueError:
            continue
        y, w, _ = d.isocalendar()
        prev = weekly.get((y, w))
        if prev is None or str(iso_date) >= prev[0]:
            weekly[(y, w)] = (str(iso_date), normalize_stage(raw))
    if not weekly:
        return 0, 0
    ordered = [weekly[k][1] for k in sorted(weekly)]
    current = ordered[-1]
    if current is None:
        return 0, len(ordered)
    run = 0
    for col in reversed(ordered):
        if col != current:
            break
        run += 1
    return run, len(ordered)


# ════════════════════════════════════════════════════════════════════════
BASE_CSS = """*{margin:0;padding:0;box-sizing:border-box}
/* ── Palette ───────────────────────────────────────────────────────────
   Lifted from src/theme.css so the page reads as part of PineX rather
   than a document that happens to live on the same domain. The app
   defaults to DARK and treats its warm "sepia" as the opt-in light
   theme, so this does the same: dark by default, sepia under
   prefers-color-scheme: light.

   Matching matters here — the scanner opens from the app's own nav, and
   a stark white page arriving out of a dark shell reads as broken.

   Theme cannot follow the user's saved choice: that lives in
   localStorage and reading it needs JavaScript, which this page does
   not have. The OS preference is the closest zero-JS approximation. */
:root{
 --bg:#0B0E11; --surface:#0F1217; --raised:#141820; --hover:#141820;
 --line:#1E2530; --line-soft:#161C24;
 /* One step lighter than theme.css's --text-secondary/--text-muted
    (#94A3B8/#64748B). Those are tuned against --bg-surface; this page
    sits on --bg-primary, which is darker, and #64748B measured 4.07:1
    there — under AA for text that carries actual data ("12.4% below" is
    on every row). Lightening the ramp keeps the hierarchy and clears
    4.5:1. */
 --ink:#E2E8F0; --ink-2:#B6C2D4; --ink-3:#96A4B8;
 --accent:#00C805;                      /* PineX green — the one accent */
 --accent-dim:rgba(0,200,5,.10);
 --t-basing:#38BDF8; --t-advancing:#16A34A;
 --t-topping:#D97706; --t-declining:#DC2626;
 --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
@media(prefers-color-scheme:light){
 :root{
  --bg:#F2F0E9; --surface:#EAE7DF; --raised:#E2DED4; --hover:#E6E2D8;
  --line:#D4CFBF; --line-soft:#E0DCD0;
  /* --ink-3 carries real content — the "% below high" on every row and
     the summary line — so it has to clear WCAG AA, not just look quiet.
     #8A7B69 measured 3.60:1 here. src/theme.css hit this exact problem
     and settled on #6E5F4F (~4.9:1); reusing that rather than inventing
     another value that fails the same way. */
  --ink:#2A2622; --ink-2:#5A4E42; --ink-3:#6E5F4F;
  --accent:#046A08; --accent-dim:rgba(4,106,8,.08);
  --t-basing:#0369A1; --t-advancing:#15803D;
  --t-topping:#B45309; --t-declining:#B91C1C;
 }
}
body{background:var(--bg);color:var(--ink);
 font:13px/1.45 var(--sans);-webkit-font-smoothing:antialiased;
 text-align:left;
 /* Counts and prices sit in columns — proportional digits make them
    jitter as the numbers change. */
 font-variant-numeric:tabular-nums}
.wrap{max-width:1120px;margin:0 auto;padding:20px 18px 0}
h1{font-size:15px;font-weight:600;letter-spacing:-.01em;
 padding-bottom:12px;border-bottom:1px solid var(--line);
 display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
h1 a.up{color:var(--accent);text-decoration:none;font-weight:700}
h1 a.up:hover{text-decoration:underline}
h1 .d{margin-left:auto;font-weight:400;color:var(--ink-3);
 font-family:var(--mono);font-size:11px}
.meta{font-size:11.5px;color:var(--ink-3);padding:9px 0 14px;max-width:70ch}
.sw{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
nav{display:block;border:1px solid var(--line);border-radius:2px;
 overflow:hidden}
nav .dd+.dd{border-top:1px solid var(--line)}
nav .dd>summary{display:flex;justify-content:space-between;gap:8px;
 cursor:pointer;padding:9px 12px;font-size:10.5px;font-weight:600;
 text-transform:uppercase;letter-spacing:.09em;color:var(--ink-2);
 background:var(--surface);list-style:none;user-select:none}
nav .dd>summary::-webkit-details-marker{display:none}
nav .dd>summary::after{content:'+';font-family:var(--mono);font-weight:400;
 font-size:13px;color:var(--ink-3);line-height:1}
nav .dd[open]>summary::after{content:'3'}
nav .dd>summary:hover{color:var(--ink);background:var(--raised)}
nav .dd[open]>summary{color:var(--ink);border-bottom:1px solid var(--line)}
/* A collapsed group must still say whether it is doing anything. */
nav .dd>summary .on{display:none;margin-left:auto;margin-right:6px;
 font-family:var(--sans);font-weight:700;font-size:9px;
 text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}
nav .opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr))}
nav label{display:flex;justify-content:space-between;gap:8px;cursor:pointer;
 padding:8px 12px;font-size:12px;color:var(--ink-2);
 border-bottom:1px solid var(--line-soft);
 border-right:1px solid var(--line-soft);
 border-left:2px solid transparent;
 transition:background .12s,color .12s}
nav label .n{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
nav label:hover{background:var(--hover);color:var(--ink)}
.bar{display:flex;justify-content:space-between;align-items:center;gap:10px;
 border:1px solid var(--line);border-top:0;background:var(--surface);
 padding:8px 12px;font-size:11px;color:var(--ink-3)}
.bar .lede{min-width:0}
.bar button,.bar .jump{font:inherit;font-family:var(--sans);font-size:11px;
 color:var(--ink);background:var(--bg);border:1px solid var(--line);
 border-radius:2px;padding:5px 11px;cursor:pointer;text-decoration:none;
 white-space:nowrap}
.bar button:hover,.bar .jump:hover{border-color:var(--accent);
 color:var(--accent)}
.bar .jump{display:none}
/* Volume range — the one control that is a free numeric input. */
.vrange{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
 padding:10px 12px;border-top:1px solid var(--line-soft)}
.vrange label{display:inline;padding:0;border:0;font-size:11px;
 text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3)}
.vrange input{width:104px;font:inherit;font-family:var(--mono);font-size:12px;
 padding:6px 9px;color:var(--ink);background:var(--bg);
 border:1px solid var(--line);border-radius:2px}
.vrange input:focus{outline:2px solid var(--accent);outline-offset:-1px}
.vrange input.bad{border-color:var(--t-declining)}
.vrange .sep{font-size:11px;color:var(--ink-3)}
.vrange .hint{flex-basis:100%;font-size:10.5px;color:var(--ink-3)}
/* Rows the volume range excludes. Separate from the CSS class filters so
   the two compose: a row shows only if neither mechanism hides it. */
.rows a.vout{display:none}
/* A volume range on its own is a filter too, but CSS cannot see it — the
   script sets .vshow so the list opens for it exactly as a checkbox does. */
main.vshow .rows{display:grid}
main.vshow .prompt{display:none}
#g_volrange.act .on{display:inline}
.showbtn{display:none}
main{border:1px solid var(--line);border-top:0}
/* VISIBLE ON LOAD. This was `display:none` until a condition was
   ticked — a deliberate earlier choice, deliberately reversed: eight
   closed accordions over an empty list told a first-time visitor
   nothing about what the page is. The data explains the product.

   The per-filter `:checked ~ main .rows{display:grid}` rules and the
   script's .vshow class are now redundant for REVEALING the list. They
   are harmless (grid -> grid) and left in place because the same
   selector lists drive .prompt and the scroll nudge. */
.rows{display:grid;min-height:44px;
 grid-template-columns:repeat(auto-fill,minmax(158px,1fr))}
.prompt{display:none}
.rows a{display:block;padding:7px 11px 8px;text-decoration:none;
 color:var(--ink);border-bottom:1px solid var(--line-soft);
 border-right:1px solid var(--line-soft);
 border-left:2px solid var(--line);transition:background .12s}
.rows a b{display:block;font-weight:500;font-size:12.5px;
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rows a i{display:block;font-style:normal;font-family:var(--mono);
 font-size:10.5px;color:var(--ink-3);margin-top:1px}
.rows a:hover{background:var(--hover)}
.rows a:hover b{color:var(--accent)}
.rows a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
footer{margin-top:26px;padding:16px 0 28px;border-top:1px solid var(--line);
 font-size:11px;line-height:1.7;color:var(--ink-3);max-width:640px}
footer p+p{margin-top:8px}
.side{display:none}
@media(min-width:1024px){
 /* The app shell's DesktopSidebar is React and does not render on this
    page, so at desktop the scanner had NO navigation at all: the bottom
    tab bar is mobile-only and the only way back was the PineX wordmark
    in the h1. This is a static mirror of that sidebar — same order, same
    destinations, same active treatment. Plain links, no JS. */
 .side{display:block;position:fixed;top:0;left:0;bottom:0;width:212px;
  background:var(--surface);border-right:1px solid var(--line);
  padding:16px 0;overflow-y:auto;z-index:10}
 .side .bd{padding:0 16px 14px;border-bottom:1px solid var(--line);
  margin-bottom:10px}
 .side .bd b{display:block;font-size:15px;font-weight:800;
  letter-spacing:-.02em;color:var(--ink)}
 .side .bd i{display:block;font-style:normal;font-size:10px;
  letter-spacing:.05em;color:var(--ink-3);margin-top:2px}
 .side a{display:block;padding:9px 16px;font-size:14px;color:var(--ink-2);
  text-decoration:none;border-left:2px solid transparent}
 .side a:hover{color:var(--ink);background:var(--hover)}
 .side a.cur{color:var(--ink);background:var(--raised);font-weight:600;
  border-left-color:var(--accent)}
 .side a:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
 .side hr{border:0;border-top:1px solid var(--line);margin:9px 16px}
 /* Shift the page, not .wrap — .wrap keeps margin:0 auto and stays
    centred inside whatever width is left. */
 body{padding-left:212px}
}
.rows a{min-height:44px;box-sizing:border-box}
.rows a .l1,.rows a .l2{display:flex;justify-content:space-between;
 align-items:baseline;gap:10px}
.rows a b{min-width:0;overflow:hidden;text-overflow:ellipsis;
 white-space:nowrap}
.rows a em{font-style:normal;flex-shrink:0;font-size:11px;color:var(--ink-2)}
.rows a u{text-decoration:none;flex-shrink:0;font-family:var(--mono);
 font-size:10.5px;color:var(--ink-3)}
.rows a i{display:inline;min-width:0;overflow:hidden;
 text-overflow:ellipsis;white-space:nowrap}
.filterbtn{display:none}
.done{display:none}
.tabs{display:none}
@media(max-width:639px){
 .wrap{padding:14px 12px 0}
 h1{font-size:14px;padding-bottom:10px}
 h1 .d{margin-left:0;flex-basis:100%}
 .meta{padding:7px 0 11px;font-size:10.5px}
 /* Collapsed groups keep the menu to ~7 rows; this cap is the safety net
    for a user who opens several at once, so the list can never be pushed
    off screen however much is expanded. */
 nav{max-height:45vh;overflow-y:auto;overscroll-behavior:contain}
 nav label{padding:7px 10px;font-size:11.5px}
 nav .dd>summary{padding:8px 10px;font-size:9.5px;
                 position:sticky;top:0;z-index:1}
 nav .opts{grid-template-columns:repeat(2,minmax(0,1fr))}
 .bar{padding:7px 10px;font-size:10.5px}
 /* One column. Two right-aligned fields cannot both fit beside a
    ticker in half of 390px without truncating something. */
 .rows{grid-template-columns:1fr}
 .rows a{padding:7px 12px 8px;min-height:44px}

 /* FULL-SCREEN FILTER SHEET — pure CSS.
    #sheet_open is a checkbox before nav; .filterbtn and .done are both
    <label for="sheet_open">, so either toggles it. No JS involved in
    opening or closing. nav KEEPS class="sheet" rather than being wrapped
    in one: every filter rule is `#f_x:checked ~ nav ...`, and a wrapper
    would demote nav from sibling to child and silently kill all of them. */
 .filterbtn{display:flex;align-items:center;justify-content:center;
  gap:6px;width:100%;min-height:48px;box-sizing:border-box;
  margin:0 0 10px;cursor:pointer;
  background:var(--surface);border:1px solid var(--line);border-radius:2px;
  font:600 12px/1 var(--sans);letter-spacing:.04em;
  text-transform:uppercase;color:var(--ink)}
 .filterbtn:active{background:var(--raised)}
 nav.sheet{display:none}
 #sheet_open:checked~nav.sheet{display:block;position:fixed;inset:0;
  z-index:40;max-height:none;border:0;border-radius:0;
  background:var(--bg);overflow-y:auto;
  padding-bottom:calc(64px + env(safe-area-inset-bottom))}
 #sheet_open:checked~nav.sheet .dd>summary{min-height:44px}
 #sheet_open:checked~nav.sheet label{min-height:44px;align-items:center}
 .done{display:flex;align-items:center;justify-content:center;
  position:sticky;bottom:0;min-height:48px;cursor:pointer;
  background:var(--accent);color:var(--bg);
  font:700 12px/1 var(--sans);letter-spacing:.06em;text-transform:uppercase}
 body{padding-bottom:60px}
 .tabs{display:flex;position:fixed;bottom:0;left:0;right:0;z-index:20;
  background:var(--surface);border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom)}
 .tabs a{flex:1;display:flex;align-items:center;justify-content:center;
  min-height:52px;font-size:10px;text-transform:uppercase;
  letter-spacing:.06em;color:var(--ink-3);text-decoration:none;
  border-right:1px solid var(--line-soft)}
 .tabs a:last-child{border-right:0}
 .tabs a.cur{color:var(--accent);font-weight:700}
 .tabs a:active{background:var(--raised)}
 /* Sits directly above the tab bar and stays put while the menu is
    scrolled, so choosing filters and seeing the result are never more
    than one thumb movement apart. */
 body{padding-bottom:118px}
 .showbtn{display:block;position:fixed;left:10px;right:10px;
  bottom:calc(56px + env(safe-area-inset-bottom));z-index:21;
  padding:13px 16px;text-align:center;text-decoration:none;
  font-size:13px;font-weight:700;letter-spacing:.02em;
  color:var(--bg);background:var(--accent);border-radius:3px}
 .showbtn:active{opacity:.85}
 .vrange input{width:92px}
}"""


def render(rows, counts, stage_counts, band_counts, as_of) -> str:
    css = [BASE_CSS]

    # Stage left-edge tone. Static per row — the stage a stock is in does
    # not change with which filters are ticked. Emitted as var() so the
    # light-theme media query can repoint all four without touching this.
    for col in STAGE_ORDER:
        css.append(
            f".rows a.{STAGE_CLS[col]}"
            f"{{border-left-color:var({STAGE_VAR[col]})}}"
        )

    # ── The filter engine ───────────────────────────────────────────────
    # One rule per control. A checked control hides every row lacking its
    # class, so a row survives only by carrying all checked classes: AND
    # across the whole menu, from 15 rules and no script.
    for col in STAGE_ORDER:
        css.append(f"#s_{col}:checked~main a:not(.{STAGE_CLS[col]}){{display:none}}")
        css.append(f"#s_{col}:checked~nav label[for=s_{col}]"
                   f"{{background:var(--accent-dim);"
                   f"border-left-color:var(--accent);"
                   f"color:var(--ink);font-weight:600}}")
        css.append(f"#s_{col}:focus-visible~nav label[for=s_{col}]"
                   f"{{outline:2px solid var(--accent);outline-offset:-2px}}")
    for cls, *_ in FILTERS:
        css.append(f"#f_{cls}:checked~main a:not(.{cls}){{display:none}}")
        css.append(f"#f_{cls}:checked~nav label[for=f_{cls}]"
                   f"{{background:var(--accent-dim);"
                   f"border-left-color:var(--accent);"
                   f"color:var(--ink);font-weight:600}}")
        css.append(f"#f_{cls}:focus-visible~nav label[for=f_{cls}]"
                   f"{{outline:2px solid var(--accent);outline-offset:-2px}}")

    # 52-week-high bands. Selecting a band keeps every TIGHTER band too,
    # which is what the chained :not() does — .n5 ("within 25%") hides
    # only rows outside n1..n5.
    for idx, (pct, cls) in enumerate(HIGH_BANDS):
        keep = "".join(f":not(.{c})" for _p, c in HIGH_BANDS[: idx + 1])
        css.append(f"#h_{cls}:checked~main a{keep}{{display:none}}")
        css.append(f"#h_{cls}:checked~nav label[for=h_{cls}]"
                   f"{{background:var(--accent-dim);"
                   f"border-left-color:var(--accent);"
                   f"color:var(--ink);font-weight:600}}")
        css.append(f"#h_{cls}:focus-visible~nav label[for=h_{cls}]"
                   f"{{outline:2px solid var(--accent);outline-offset:-2px}}")

    # ── "Nothing until something is picked" ─────────────────────────────
    # .rows is display:none by default. These two rules flip that as soon
    # as ANY real control is checked, via one comma-separated selector
    # list per rule — CSS has no "if nothing is checked", but a list of
    # "if this is checked" covering every control is equivalent.
    #
    # s_any / h_any are EXCLUDED on purpose: they are checked on load, so
    # counting them would make the page look filtered when it is not.
    #
    # The AND narrowing above is unaffected — it hides non-matching rows
    # within an already-visible .rows.
    active = ([f"#s_{c}" for c in STAGE_ORDER]
              + [f"#h_{cls}" for _p, cls in HIGH_BANDS]
              + [f"#f_{cls}" for cls, *_ in FILTERS])
    css.append(",".join(f"{sel}:checked~main .rows" for sel in active)
               + "{display:grid}")
    css.append(",".join(f"{sel}:checked~main .prompt" for sel in active)
               + "{display:none}")
    # Same list again for the scroll nudge — it lives in .bar, which sits
    # BEFORE <main>, so it needs its own selector chain rather than
    # riding on the two above.
    css.append(",".join(f"{sel}:checked~.bar .jump" for sel in active)
               + "{display:inline-block}")

    # Light up a COLLAPSED group's summary when something inside it is
    # selected. Without this the menu can be filtering hard while every
    # group reads as untouched, which is the main hazard of collapsing
    # them by default. Grouped by target so each group emits one rule.
    on_groups: dict[str, list[str]] = {}
    for col in STAGE_ORDER:
        on_groups.setdefault("stage", []).append(f"#s_{col}")
    for _pct, cls in HIGH_BANDS:
        on_groups.setdefault("high", []).append(f"#h_{cls}")
    for cls, _label, grp, _pred in FILTERS:
        on_groups.setdefault(_slug(grp), []).append(f"#f_{cls}")
    for gid, sels in on_groups.items():
        css.append(",".join(f"{s}:checked~nav #g_{gid} .on" for s in sels)
                   + "{display:inline}")

    p: list[str] = []
    add = p.append
    # Desktop-only left sidebar. Mirrors src/lib/appNav.js in order and
    # label; the React DesktopSidebar cannot render on a static page, so
    # this stands in for it. Emitted BEFORE .wrap so it never sits inside
    # the `inputs ~ nav` / `inputs ~ main` sibling chain the CSS-only
    # filtering depends on.
    add('<aside class="side" aria-label="Site navigation">'
        '<div class="bd"><b>PineX</b><i>MARKET INTELLIGENCE</i></div>'
        '<a href="/pulse">Health</a>'
        '<a href="/home">Today</a>'
        '<hr>'
        '<a href="/home?tab=sectors">Sectors</a>'
        '<a class="cur" aria-current="page" href="/quickscanner">Screener</a>'
        '<a href="/heatmap">Heatmap</a>'
        '<hr>'
        '<a href="/dashboard">Watchlist</a>'
        '<a href="/journal">Journal</a>'
        '<a href="/learn">Learn</a>'
        '<a href="/profile">Profile</a>'
        "</aside>")
    add('<div class="wrap">')
    stamp = fmt_date(as_of) if as_of else "date unavailable"
    # "PineX" is the way back into the app. The page is served outside
    # React, so the app shell's nav does not render here — without this
    # link the page is a dead end.
    add(f'<h1><a class="up" href="/pulse">PineX</a> — Screener '
        f'<span class="d">{html.escape(stamp)}</span></h1>')
    add(f'<p class="meta">{len(rows):,} stocks screened · pick one or more '
        f'conditions to list them · a stock appears only if it meets all '
        f'of them · each row shows how far it sits below its 52-week '
        f'high</p>')

    add("<form>")
    # Inputs first: `~ nav` and `~ main` below depend on this order.
    add('<input class="sw" type="radio" name="s" id="s_any" checked>')
    for col in STAGE_ORDER:
        add(f'<input class="sw" type="radio" name="s" id="s_{col}">')
    add('<input class="sw" type="radio" name="h" id="h_any" checked>')
    for _pct, cls in HIGH_BANDS:
        add(f'<input class="sw" type="radio" name="h" id="h_{cls}">')
    for cls, *_ in FILTERS:
        add(f'<input class="sw" type="checkbox" id="f_{cls}">')

    # ── Menu: one <details> per group ───────────────────────────────────
    # Collapsed, the whole menu is ~7 rows instead of ~27, so the first
    # result sits on screen at 390px instead of ~800px down the page.
    #
    # The INPUTS stay at form level above — only the labels live inside
    # these <details>. `#id:checked ~ main` needs the inputs to remain
    # siblings of <main>, and a <label for> works from anywhere in the
    # document, so nesting the labels costs nothing.
    #
    # Each group carries an id so the generated ".on" rules can light up
    # the summary of a group that has something selected — a collapsed
    # group must still say whether it is doing anything.
    def group_block(gid, title, options):
        """options: list of (input_id, label_html, count_str)."""
        add(f'<details class="dd" id="g_{gid}"><summary>{html.escape(title)}'
            f'<span class="on">on</span></summary>')
        add('<div class="opts">')
        for input_id, text, count in options:
            add(f'<label for="{input_id}">{text}'
                f'<span class="n">{count}</span></label>')
        add("</div></details>")
    # Sheet toggle. Sits with the other inputs, BEFORE nav and main.
    add('<input type="checkbox" id="sheet_open" class="sw">')
    add('<label class="filterbtn" for="sheet_open">Filter<span id="fcount"></span></label>')

    # Sheet toggle + button, emitted BEFORE nav so the existing
    # `#f_x:checked ~ nav` and `~ main` sibling chains still resolve.
    add('<input type="checkbox" id="sheet_open" class="sw">')
    add('<label class="filterbtn" for="sheet_open">Filter<span id="fcount"></span></label>')
    add('<nav class="sheet">')

    group_block("stage", "Stage",
                [("s_any", "Any stage", f"{len(rows):,}")]
                + [(f"s_{c}", STAGE_LABEL[c], f"{stage_counts.get(c, 0):,}")
                   for c in STAGE_ORDER])

    # ── Average monthly volume ──────────────────────────────────────
    # A free numeric range, unlike every other control here, because
    # "between X and Y shares" has no natural set of buckets. That makes
    # it the one filter CSS cannot drive — hence the small script at the
    # bottom of the page. Without JS these inputs simply do nothing and
    # every other filter still works.
    #
    # Accepts 500K / 4.2M / 1.5B as well as plain digits; typing
    # 4200000 by hand is not a reasonable ask.
    add('<details class="dd" id="g_volrange"><summary>Average monthly volume'
        '<span class="on">on</span></summary>')
    add('<div class="vrange">'
        '<label for="vmin">Min</label>'
        '<input id="vmin" type="text" inputmode="decimal" autocomplete="off"'
        ' placeholder="0" aria-label="Minimum average monthly volume">'
        '<span class="sep">to</span>'
        '<label for="vmax">Max</label>'
        '<input id="vmax" type="text" inputmode="decimal" autocomplete="off"'
        ' placeholder="100B" aria-label="Maximum average monthly volume">'
        '<span class="hint">shares/month &middot; K, M, B accepted '
        '&middot; median 4.2M</span>'
        "</div></details>")

    group_block("high", "How far BELOW the 52-week high",
                [("h_any", "Any distance", f"{len(rows):,}")]
                + [(f"h_{cls}", f"Down {pct}% or less",
                    f"{band_counts.get(cls, 0):,}")
                   for pct, cls in HIGH_BANDS])

    # FILTERS is already ordered by group, so walk it once and flush a
    # block whenever the group name changes.
    pending: list[tuple[str, str, str]] = []
    current: str | None = None
    for cls, label, grp, _pred in FILTERS:
        if grp != current:
            if pending and current:
                group_block(_slug(current), current, pending)
            pending, current = [], grp
        pending.append((f"f_{cls}", html.escape(label), f"{counts[cls]:,}"))
    if pending and current:
        group_block(_slug(current), current, pending)

    add('<label class="done" for="sheet_open">Done</label>')
    add("</nav>")

    # Phrased to be true whether the result is full or empty. CSS cannot
    # detect "no rows are currently displayed" — that would need :has() to
    # test computed display, which does not exist — so a conditional
    # empty-state message would either never show or always show. Static
    # wording that covers both states is the honest option.
    add('<div class="bar"><span class="lede">Counts are per condition on '
        'its own. Each tick narrows further; an empty list means no stock '
        'meets all of them.</span>'
        '<a class="jump" href="#results">See results</a>'
        '<button type="reset">Clear filters</button></div>')

    # Thumb-reachable action bar, mobile only. Picking filters on a phone
    # meant scrolling the menu, then scrolling further to find out what
    # you had done; this pins the answer and the way to it in one place.
    # It is an anchor, so it still scrolls to the results with JS off —
    # the script only rewrites the label with a live count and swaps the
    # jump for a smooth one.
    add('<a class="showbtn" href="#results">'
        '<span id="showcount">See results</span></a>')

    add('<main id="results">')
    # The second helper line lived here — "Pick a condition above to list
    # stocks. Each one you add narrows the result further." It said the
    # same thing as the .lede in the bar above, which is closer to the
    # controls and stays on screen. One explanation, not two.
    add('<div class="rows">')
    for sym, line2, classes, mvol, stage_label, vol_label in rows:
        # Live React route, no .html — see the module docstring.
        href = f"/stock/{quote(sym, safe='')}"
        cls = f' class="{classes}"' if classes else ""
        # data-v is the monthly share volume the range filter reads. Left
        # off entirely when unknown, so a stock with no volume history is
        # excluded by any range rather than treated as zero.
        dv = "" if mvol is None else f' data-v="{int(mvol)}"'
        # Two lines, four fields, right-hand column right-aligned:
        #   L1  ticker            stage
        #   L2  % from 52w high   avg monthly volume
        # weeks-in-stage was the original plan for the L2 right slot and
        # was dropped: it is Stage-2 only (880 blanks) and saturates at
        # the 60-session read cap in substage.py, so "14 wk" cannot be
        # told from "two years". Monthly volume has 99.7% coverage and is
        # already in scope.
        add(f'<a{cls}{dv} href="{href}">'
            f'<span class="l1"><b>{html.escape(sym)}</b>'
            f'<em>{html.escape(stage_label)}</em></span>'
            f'<span class="l2"><i>{html.escape(line2)}</i>'
            f'<u>{html.escape(vol_label)}</u></span></a>')
    add("</div>")
    add("</main>")
    add("</form>")

    add("<footer>")
    for para in DISCLAIMER:
        add(f"<p>{html.escape(para)}</p>")
    add("</footer>")
    add("</div>")

    # Mirrors src/components/BottomNav.jsx tab-for-tab. Keep the order in
    # sync with that file — the whole point is that the bar does not
    # appear to move when crossing between the app and this page.
    add('<nav class="tabs" aria-label="Site sections">'
        '<a href="/home">Today</a>'
        '<a href="/pulse">Health</a>'
        '<a class="cur" aria-current="page" href="/quickscanner">Scanner</a>'
        '<a href="/journal">Journal</a>'
        '<a href="/profile">Profile</a>'
        "</nav>")

    # ── The only script on the page ─────────────────────────────────────
    # Everything else filters in pure CSS and keeps working with this
    # disabled. This exists for the three things CSS provably cannot do:
    #   1. read a numeric input's value (the volume range)
    #   2. count matched elements (the live result count)
    #   3. scroll smoothly to the results
    #
    # It therefore duplicates the CSS matching logic in order to COUNT,
    # not to filter — the class filters are still applied by the
    # stylesheet. The two must agree, so the maps below are generated
    # from the same Python constants that emit the rules.
    stage_map = "{" + ",".join(f"s_{c}:'{STAGE_CLS[c]}'" for c in STAGE_ORDER) + "}"
    band_list = "[" + ",".join(f"'{cls}'" for _p, cls in HIGH_BANDS) + "]"
    script = f"""
(function(){{
var $=function(i){{return document.getElementById(i)}};
var main=document.querySelector('main'),grid=document.querySelector('.rows');
if(!grid)return;
var rows=[].map.call(grid.children,function(a){{
 return {{e:a,c:a.className?a.className.split(' '):[],
         v:a.hasAttribute('data-v')?+a.getAttribute('data-v'):null}};
}});
var STAGE={stage_map},BANDS={band_list};
var vmin=$('vmin'),vmax=$('vmax'),grp=$('g_volrange'),btn=$('showcount'),
    jump=document.querySelector('.bar .jump');
// '4.2M' -> 4200000. NaN signals unparseable so the field can be marked.
function pv(s){{
 s=(s||'').trim().replace(/,/g,'');
 if(!s)return null;
 var m=/^([0-9]*\\.?[0-9]+)\\s*([kmb]?)$/i.exec(s);
 if(!m)return NaN;
 var n=parseFloat(m[1]),u=m[2].toLowerCase();
 return u==='k'?n*1e3:u==='m'?n*1e6:u==='b'?n*1e9:n;
}}
function apply(){{
 var need=[],anyOf=null,i,k;
 for(var id in STAGE) if($(id)&&$(id).checked) need.push(STAGE[id]);
 for(i=0;i<BANDS.length;i++){{
  var el=$('h_'+BANDS[i]);
  if(el&&el.checked){{anyOf=BANDS.slice(0,i+1);break;}}
 }}
 var boxes=document.querySelectorAll('input[type=checkbox]:checked');
 for(i=0;i<boxes.length;i++) need.push(boxes[i].id.slice(2));
 var lo=pv(vmin.value),hi=pv(vmax.value);
 var badLo=lo!==null&&isNaN(lo),badHi=hi!==null&&isNaN(hi);
 vmin.className=badLo?'bad':'';vmax.className=badHi?'bad':'';
 if(badLo)lo=null;if(badHi)hi=null;
 var vActive=lo!==null||hi!==null;
 var n=0;
 for(i=0;i<rows.length;i++){{
  var r=rows[i],ok=true;
  for(k=0;k<need.length;k++) if(r.c.indexOf(need[k])<0){{ok=false;break;}}
  if(ok&&anyOf){{ok=false;for(k=0;k<anyOf.length;k++) if(r.c.indexOf(anyOf[k])>=0){{ok=true;break;}}}}
  // Unknown volume is excluded by any range rather than treated as zero.
  var vok=!vActive||(r.v!==null&&(lo===null||r.v>=lo)&&(hi===null||r.v<=hi));
  if(vActive&&!vok){{if(r.e.className.indexOf('vout')<0)r.e.className+=' vout';}}
  else r.e.className=r.e.className.replace(/ ?vout/,'');
  if(ok&&vok)n++;
 }}
 if(grp)grp.className='dd'+(vActive?' act':'');
 if(vActive)main.className='vshow';else main.className='';
 var anyFilter=need.length>0||anyOf||vActive;
 var txt=!anyFilter?'Pick a condition':(n===0?'No matches':'See '+n.toLocaleString()+(n===1?' result':' results'));
 if(btn)btn.textContent=txt;
 if(jump)jump.textContent=n.toLocaleString()+(n===1?' result':' results');
}}
document.addEventListener('change',apply);
document.addEventListener('input',apply);
document.addEventListener('click',function(e){{
 var a=e.target.closest?e.target.closest('a[href="#results"]'):null;
 if(!a)return;
 e.preventDefault();
 main.scrollIntoView({{behavior:'smooth',block:'start'}});
}});
apply();
}})();"""

    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        # Netlify serves this file at BOTH /quickscanner (via the
        # netlify.toml rewrite) and /quickscanner.html (the file itself),
        # so search engines see one page at two URLs. Canonical names the
        # clean one as the original.
        '<link rel="canonical" href="https://pinex.in/quickscanner">\n'
        "<title>PineX — Screener</title>\n"
        f"<style>\n{chr(10).join(css)}\n</style>\n</head>\n<body>\n"
        + "\n".join(p)
        + f"\n<script>{script}</script>\n</body>\n</html>\n"
    )


# ════════════════════════════════════════════════════════════════════════
def main() -> int:
    print("=" * 68)
    print("QUICKSCANNER — STATIC MULTI-CONDITION SCREENER")
    print("=" * 68)

    symbols = fetch_active_symbols()
    latest, as_of = fetch_latest()
    history = fetch_stage_history()

    stocks: list[dict] = []
    ceiling = 0
    for cid, symbol in symbols.items():
        src = latest.get(cid)
        if not src:
            continue
        close = num(src.get("close"))
        if close is None or close <= 0:
            continue
        wks, span = weeks_in_stage(history.get(cid, []))
        ceiling = max(ceiling, span)
        stocks.append({
            "symbol": symbol, "close": close,
            "col": normalize_stage(src.get("stage")),
            "dma_50": num(src.get("dma_50")), "dma_150": num(src.get("dma_150")),
            "dma_200": num(src.get("dma_200")), "vol_ratio": num(src.get("vol_ratio")),
            "rsi": num(src.get("rsi")), "ma30w": num(src.get("ma30w")),
            "high_52w": num(src.get("high_52w")), "low_52w": num(src.get("low_52w")),
            "weeks": wks,
            # Average SHARES traded per month. avg_volume_30d is a daily
            # average, and a month is ~21 trading sessions — not 30, which
            # would count weekends the exchange was shut.
            "mvol": (lambda v: None if v is None else v * SESSIONS_PER_MONTH)(
                num(src.get("avg_volume_30d"))),
        })

    # Closest to its 52-week high first. That matches what the second line
    # now shows, so the ordering explains itself; stocks with no usable
    # high sort last rather than jumping to the top on a None.
    for r in stocks:
        r["dist"] = high_distance(r)
    stocks.sort(key=lambda r: (r["dist"] is None,
                               r["dist"] if r["dist"] is not None else 0.0,
                               r["symbol"]))

    counts = {cls: 0 for cls, *_ in FILTERS}
    stage_counts: dict[str, int] = {}
    raw_bands: dict[str, int] = {}
    rendered: list[tuple[str, str, str, float | None, str, str]] = []
    for r in stocks:
        classes: list[str] = []
        if r["col"]:
            classes.append(STAGE_CLS[r["col"]])
            stage_counts[r["col"]] = stage_counts.get(r["col"], 0) + 1
        band = high_band_cls(r["dist"])
        if band:
            classes.append(band)
            raw_bands[band] = raw_bands.get(band, 0) + 1
        for cls, _label, _grp, pred in FILTERS:
            if pred(r):
                classes.append(cls)
                counts[cls] += 1
        rendered.append((r["symbol"], high_label(r["dist"]), " ".join(classes),
                         r["mvol"], STAGE_LABEL.get(r["col"], "—"),
                         vol_label(r["mvol"])))

    # Band counts shown in the menu must be CUMULATIVE, because selecting
    # "within 25%" keeps every tighter band too. raw_bands holds only each
    # stock's tightest band, so accumulate down the list.
    band_counts: dict[str, int] = {}
    running = 0
    for _pct, cls in HIGH_BANDS:
        running += raw_bands.get(cls, 0)
        band_counts[cls] = running

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # newline="" so the file is byte-identical whoever generates it; the
    # Windows default added ~2 KB of carriage returns for nothing.
    OUT_FILE.write_text(
        render(rendered, counts, stage_counts, band_counts, as_of),
        encoding="utf-8", newline="")

    size = OUT_FILE.stat().st_size
    print()
    print("  [Stage]  (single-select)")
    for col in STAGE_ORDER:
        print(f"    {STAGE_LABEL[col]:<22} {stage_counts.get(col, 0):>5,}")
    print("  [How far below the 52-week high]  (single-select, cumulative)")
    for pct, cls in HIGH_BANDS:
        print(f"    Down {pct}% or less{'':<8} {band_counts.get(cls, 0):>5,}")
    group = None
    for cls, label, grp, _pred in FILTERS:
        if grp != group:
            print(f"  [{grp}]  (combinable)")
            group = grp
        print(f"    {label:<22} {counts[cls]:>5,}")
    print()
    print(f"  universe screened  {len(stocks):,}")
    combos = (2 ** len(FILTERS)) * (len(STAGE_ORDER) + 1) * (len(HIGH_BANDS) + 1)
    print(f"  filter combinations {combos:,}")
    print(f"  weeks ceiling      {ceiling} wk (history depth, not stage age)")
    print(f"  wrote {OUT_FILE}")
    # ── Budget is measured on the WIRE, not on disk ─────────────────────
    # The original 200 KB budget assumed the raw file size was what users
    # download. It is not: Netlify serves this Content-Encoding: br, and
    # the markup is extremely repetitive, so it compresses ~85%. Measured
    # on the live deploy, a 200 KB file was 30.6 KB over the wire.
    #
    # Warning on the raw size therefore fires on a page that is genuinely
    # small, and would push someone into optimising the wrong number.
    # gzip is the closest thing available without a brotli dependency,
    # and it is CONSERVATIVE — brotli lands ~20-30% below it.
    import gzip
    wire = len(gzip.compress(OUT_FILE.read_bytes(), 6))
    print(f"  {size:,} bytes on disk ({size/1024:.1f} KB)")
    print(f"  ~{wire/1024:.1f} KB over the wire (gzip; brotli is smaller still)")
    if wire > WIRE_BUDGET:
        print(f"  ::warning:: over the {WIRE_BUDGET/1024:.0f} KB transfer budget")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
