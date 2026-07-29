"""generate_static_quickscanner.py — QuickScanner, a static multi-condition
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

STAGE_TO_COLUMN = {
    "stage1": "basing", "stage1+": "basing", "stage2": "advancing",
    "stage3": "topping", "stage4": "declining",
}

# Muted print inks. stageUi.js uses #38BDF8 / #16A34A / #D97706 / #DC2626,
# tuned for a dark neon shell — the same hues at newspaper saturation.
STAGE_ORDER = ["basing", "advancing", "topping", "declining"]
STAGE_LABEL = {"basing": "Basing", "advancing": "Advancing",
               "topping": "Topping", "declining": "Declining"}
STAGE_TONE = {"basing": "#55677A", "advancing": "#4B6B54",
              "topping": "#8A7038", "declining": "#8A524C"}
TONE_NONE = "#9A9A93"

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

    ("e", "Volume 1.2x normal",  "Volume", _vol(1.2)),
    ("f", "Volume 1.5x normal",  "Volume", _vol(1.5)),
    ("g", "Volume 2x normal",    "Volume", _vol(2.0)),

    ("h", "Near 52-week low",    "52-week low",
     lambda r: r["low_52w"] is not None and r["low_52w"] > 0
     and r["close"] <= r["low_52w"] * 1.05),

    ("i", "RSI 50-70",           "RSI and trend",
     lambda r: r["rsi"] is not None and 50.0 <= r["rsi"] <= 70.0),
    ("j", "Above 30-week trend", "RSI and trend", _above("ma30w")),
]

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
                "vol_ratio,rsi,ma30w,high_52w,low_52w")
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
:root{
 --ink:#1a1a1a; --ink-mid:#4a4a4a; --ink-soft:#6e6e6e;
 --rule:#c9c9c9; --rule-faint:#e6e6e6; --paper:#fff; --wash:#f4f4f2;
 --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 --mono:ui-monospace,"SF Mono",Menlo,monospace;
}
body{background:var(--paper);color:var(--ink);font:13px/1.4 var(--sans);
 -webkit-font-smoothing:antialiased;text-align:left}
.wrap{max-width:1100px;margin:0;padding:14px 16px 0}
h1{font-size:13px;font-weight:600;padding-bottom:10px;
 border-bottom:1px solid var(--ink)}
h1 .d{font-weight:400;color:var(--ink-soft);font-family:var(--mono);font-size:12px}
h1 a.up{color:inherit;text-decoration:none;border-bottom:1px solid var(--rule)}
h1 a.up:hover{border-bottom-color:var(--ink)}
.meta{font-size:11px;color:var(--ink-soft);padding:6px 0 12px}
/* Visually hidden, still focusable, still checkable via its label. */
.sw{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
nav{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));
 border:1px solid var(--rule);border-bottom:0}
nav .g{grid-column:1/-1;font-size:10px;font-weight:600;text-transform:uppercase;
 letter-spacing:.08em;color:var(--ink-soft);background:var(--wash);
 padding:4px 8px;border-bottom:1px solid var(--rule)}
nav label{display:flex;justify-content:space-between;gap:6px;cursor:pointer;
 padding:5px 8px;font-size:12px;border-bottom:1px solid var(--rule-faint);
 border-left:2px solid transparent;border-right:1px solid var(--rule-faint)}
nav label .n{font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
nav label:hover{background:var(--wash)}
/* Collapsible group — the zero-JS stand-in for a dropdown. */
nav .dd{grid-column:1/-1;border-bottom:1px solid var(--rule)}
nav .dd>summary{display:flex;justify-content:space-between;gap:6px;
 cursor:pointer;padding:5px 8px;font-size:11px;font-weight:600;
 text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft);
 background:var(--wash)}
nav .dd>summary:hover{color:var(--ink)}
nav .dd>label{border-right:0}
nav .dd>label:last-child{border-bottom:0}
.bar{display:flex;justify-content:space-between;align-items:center;gap:8px;
 border:1px solid var(--rule);border-bottom:0;background:var(--wash);
 padding:5px 8px;font-size:11px;color:var(--ink-soft)}
.bar button{font:inherit;font-family:var(--sans);color:var(--ink);
 background:var(--paper);border:1px solid var(--rule);border-radius:0;
 padding:3px 9px;cursor:pointer}
.bar button:hover{background:var(--wash)}
main{border:1px solid var(--rule)}
/* Hidden until at least one condition is active — see the generated
   "any control checked" rule further down. */
.rows{display:none;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.prompt{display:block;padding:14px 8px;font-size:12px;color:var(--ink-soft)}
.rows a{display:block;padding:4px 8px 5px;text-decoration:none;color:var(--ink);
 border-bottom:1px solid var(--rule-faint);border-right:1px solid var(--rule-faint);
 border-left:2px solid VAR_NONE}
.rows a b{display:block;font-weight:400;overflow:hidden;
 text-overflow:ellipsis;white-space:nowrap}
.rows a i{display:block;font-style:normal;font-family:var(--mono);
 font-size:11px;color:var(--ink-soft)}
.rows a:hover{background:var(--wash)}
.rows a:hover b{text-decoration:underline}
.rows a:focus{outline:2px solid var(--ink);outline-offset:-2px}
/* Keeps a narrow result from collapsing to a bare edge, and gives the
   grid a visible floor when a combination matches nothing at all. */
.rows{min-height:44px}
footer{margin-top:18px;padding:12px 0 20px;border-top:1px solid var(--rule);
 font-size:11px;line-height:1.65;color:var(--ink-mid);max-width:640px}
footer p+p{margin-top:7px}
@media(max-width:639px){
 .wrap{padding:12px 12px 0}
 nav{grid-template-columns:minmax(0,1fr)}
 .rows{grid-template-columns:minmax(0,1fr)}
}"""


def render(rows, counts, stage_counts, band_counts, as_of) -> str:
    css = [BASE_CSS.replace("VAR_NONE", TONE_NONE)]

    # Stage left-edge tone. Static per row — the stage a stock is in does
    # not change with which filters are ticked.
    for col in STAGE_ORDER:
        css.append(f".rows a.{STAGE_CLS[col]}{{border-left-color:{STAGE_TONE[col]}}}")

    # ── The filter engine ───────────────────────────────────────────────
    # One rule per control. A checked control hides every row lacking its
    # class, so a row survives only by carrying all checked classes: AND
    # across the whole menu, from 15 rules and no script.
    for col in STAGE_ORDER:
        css.append(f"#s_{col}:checked~main a:not(.{STAGE_CLS[col]}){{display:none}}")
        css.append(f"#s_{col}:checked~nav label[for=s_{col}]"
                   f"{{background:var(--wash);border-left-color:var(--ink);"
                   f"font-weight:600}}")
        css.append(f"#s_{col}:focus-visible~nav label[for=s_{col}]"
                   f"{{outline:2px solid var(--ink);outline-offset:-2px}}")
    for cls, *_ in FILTERS:
        css.append(f"#f_{cls}:checked~main a:not(.{cls}){{display:none}}")
        css.append(f"#f_{cls}:checked~nav label[for=f_{cls}]"
                   f"{{background:var(--wash);border-left-color:var(--ink);"
                   f"font-weight:600}}")
        css.append(f"#f_{cls}:focus-visible~nav label[for=f_{cls}]"
                   f"{{outline:2px solid var(--ink);outline-offset:-2px}}")

    # 52-week-high bands. Selecting a band keeps every TIGHTER band too,
    # which is what the chained :not() does — .n5 ("within 25%") hides
    # only rows outside n1..n5.
    for idx, (pct, cls) in enumerate(HIGH_BANDS):
        keep = "".join(f":not(.{c})" for _p, c in HIGH_BANDS[: idx + 1])
        css.append(f"#h_{cls}:checked~main a{keep}{{display:none}}")
        css.append(f"#h_{cls}:checked~nav label[for=h_{cls}]"
                   f"{{background:var(--wash);border-left-color:var(--ink);"
                   f"font-weight:600}}")
        css.append(f"#h_{cls}:focus-visible~nav label[for=h_{cls}]"
                   f"{{outline:2px solid var(--ink);outline-offset:-2px}}")

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

    p: list[str] = []
    add = p.append
    add('<div class="wrap">')
    stamp = fmt_date(as_of) if as_of else "date unavailable"
    # "PineX" is the way back into the app. The page is served outside
    # React, so the app shell's nav does not render here — without this
    # link the page is a dead end.
    add(f'<h1><a class="up" href="/home">PineX</a> — QuickScanner '
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

    add("<nav>")
    add('<div class="g">Stage</div>')
    add(f'<label for="s_any">Any stage<span class="n">{len(rows):,}</span></label>')
    for col in STAGE_ORDER:
        add(f'<label for="s_{col}">{STAGE_LABEL[col]}'
            f'<span class="n">{stage_counts.get(col, 0):,}</span></label>')
    # 52-week-high tolerance. <details> collapses eight options to one
    # line, which is the closest zero-JS thing to a dropdown. The INPUTS
    # stay at form level above — only the labels live in here, because
    # `#id:checked ~ main` needs the inputs to remain siblings of <main>.
    add('<details class="dd"><summary>How far BELOW the 52-week high'
        '<span class="n">select</span></summary>')
    add(f'<label for="h_any">Any distance<span class="n">{len(rows):,}</span></label>')
    for pct, cls in HIGH_BANDS:
        add(f'<label for="h_{cls}">Down {pct}% or less'
            f'<span class="n">{band_counts.get(cls, 0):,}</span></label>')
    add("</details>")

    group = None
    for cls, label, grp, _pred in FILTERS:
        if grp != group:
            add(f'<div class="g">{html.escape(grp)}</div>')
            group = grp
        add(f'<label for="f_{cls}">{html.escape(label)}'
            f'<span class="n">{counts[cls]:,}</span></label>')
    add("</nav>")

    # Phrased to be true whether the result is full or empty. CSS cannot
    # detect "no rows are currently displayed" — that would need :has() to
    # test computed display, which does not exist — so a conditional
    # empty-state message would either never show or always show. Static
    # wording that covers both states is the honest option.
    add('<div class="bar"><span>Counts are per condition on its own. '
        'Each tick narrows further; an empty list means no stock meets '
        'all of them.</span>'
        '<button type="reset">Clear filters</button></div>')

    add("<main>")
    add('<p class="prompt">Pick a condition above to list stocks. '
        'Each one you add narrows the result further.</p>')
    add('<div class="rows">')
    for sym, line2, classes in rows:
        # Live React route, no .html — see the module docstring.
        href = f"/stock/{quote(sym, safe='')}"
        cls = f' class="{classes}"' if classes else ""
        add(f'<a{cls} href="{href}"><b>{html.escape(sym)}</b>'
            f'<i>{html.escape(line2)}</i></a>')
    add("</div>")
    add("</main>")
    add("</form>")

    add("<footer>")
    for para in DISCLAIMER:
        add(f"<p>{html.escape(para)}</p>")
    add("</footer>")
    add("</div>")

    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        "<title>PineX — QuickScanner</title>\n"
        f"<style>\n{chr(10).join(css)}\n</style>\n</head>\n<body>\n"
        + "\n".join(p) + "\n</body>\n</html>\n"
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
    rendered: list[tuple[str, str, str]] = []
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
        rendered.append((r["symbol"], high_label(r["dist"]), " ".join(classes)))

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
    print(f"  {size:,} bytes ({size/1024:.1f} KB)")
    if size > 200 * 1024:
        print("  ::warning:: over the 200 KB budget")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    sys.exit(main())
