"""generate_screener.py — PineX Screener, rebuilt from scratch.

REPLACES generate_static_quickscanner.py. That script filtered with
generated CSS sibling selectors — roughly 1.47 million combination rules,
which broke twice under editing and could never produce a live match
count. This emits data and behaviour separately instead:

  static_build/screener.json      one minified array, short keys
  static_build/quickscanner.html  layout, styling, one vanilla script

The HTML keeps the quickscanner.html filename so the existing
netlify.toml rewrite (/quickscanner -> /quickscanner.html) and the
publish step in daily.yml keep working untouched. Renaming the route to
/screener is a separate pass.

PIPELINE NOTE — daily.yml step (12) copies only quickscanner.html into
public/. It needs one more `cp` for screener.json before this page can
deploy. Not changed here: the pipeline is out of scope for this pass.

Reads price_data (is_latest) + companies. Writes nothing to the database.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import supabase  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent.parent / "static_build"
HTML_FILE = OUT_DIR / "quickscanner.html"
JSON_FILE = OUT_DIR / "screener.json"

# A month is ~21 trading sessions, not 30 — 30 would count days the
# exchange was shut.
SESSIONS_PER_MONTH = 21
PAGE_SIZE = 1000

# Stage codes. -1 is unclassified: 117 of 2,122 rows carry no stage, so
# the four named stages do not sum to the universe. The sheet shows the
# gap as its own row rather than leaving the arithmetic unexplained.
STAGES = [(0, "Basing"), (1, "Advancing"), (2, "Topping"), (3, "Declining")]
STAGE_BY_NAME = {
    "stage 1": 0, "basing": 0,
    "stage 2": 1, "advancing": 1,
    "stage 3": 2, "topping": 2,
    "stage 4": 3, "declining": 3,
}

# Bitmask. One integer per row instead of nine booleans — it is the
# difference between ~48 and ~110 bytes per record.
F_DMA50, F_DMA150, F_DMA200 = 1, 2, 4
F_NEAR_HIGH, F_NEW_HIGH, F_NEW_LOW = 8, 16, 32
F_VOL15, F_VOL20, F_LAKH = 64, 128, 256

# (filter id, label, bit) — the page renders these in order.
PRICE_FILTERS = [
    ("p1", "Above 50 DMA", F_DMA50),
    ("p2", "Above 150 DMA", F_DMA150),
    ("p3", "Above 200 DMA", F_DMA200),
    ("p4", "Within 5% of high", F_NEAR_HIGH),
    ("p5", "New 52-week high", F_NEW_HIGH),
    ("p6", "New 52-week low", F_NEW_LOW),
]
VOLUME_FILTERS = [
    ("v1", "1.5x normal volume", F_VOL15),
    ("v2", "2x normal volume", F_VOL20),
    ("v3", "Over 1L shares a day", F_LAKH),
]


def num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN check


def paginate(build):
    out, start = [], 0
    while True:
        res = build(start, start + PAGE_SIZE - 1).execute()
        batch = res.data or []
        out.extend(batch)
        if len(batch) < PAGE_SIZE:
            return out
        start += PAGE_SIZE


def fetch_symbols() -> dict[str, str]:
    rows = paginate(
        lambda a, b: supabase.table("companies")
        .select("id,symbol,is_suspended,is_index_proxy").order("id").range(a, b)
    )
    # Filtered in Python: PostgREST neq.true drops NULL rows, because
    # NULL <> true is NULL rather than true.
    out = {
        r["id"]: r["symbol"] for r in rows
        if r.get("is_suspended") is not True
        and r.get("is_index_proxy") is not True and r.get("symbol")
    }
    print(f"  {len(rows):,} companies -> {len(out):,} in the screener universe")
    return out


def fetch_latest() -> tuple[dict, str | None]:
    rows = paginate(
        lambda a, b: supabase.table("price_data")
        .select("company_id,date,close,stage,dma_50,dma_150,dma_200,"
                "vol_ratio,high_52w,low_52w,avg_volume_30d")
        .eq("is_latest", True).order("company_id").range(a, b)
    )
    latest, as_of = {}, None
    for r in rows:
        latest[r["company_id"]] = r
        d = r.get("date")
        if d and (as_of is None or d > as_of):
            as_of = d
    print(f"  {len(latest):,} is_latest price_data rows (as of {as_of})")
    return latest, as_of


def build_rows(symbols, latest) -> list[dict]:
    rows = []
    for cid, symbol in symbols.items():
        src = latest.get(cid)
        if not src:
            continue
        close = num(src.get("close"))
        if close is None or close <= 0:
            continue

        raw = (src.get("stage") or "").strip().lower()
        stage = STAGE_BY_NAME.get(raw, -1)

        high = num(src.get("high_52w"))
        low = num(src.get("low_52w"))
        # Percent from the 52-week high, signed. The high is the max close
        # of the window and today is inside it, so this is <= 0 always;
        # 0 means a new high is being set right now.
        dist = None
        if high and high > 0:
            dist = round((close - high) / high * 100.0, 1)

        vr = num(src.get("vol_ratio"))
        adv = num(src.get("avg_volume_30d"))

        f = 0
        for field, bit in (("dma_50", F_DMA50), ("dma_150", F_DMA150),
                           ("dma_200", F_DMA200)):
            ma = num(src.get(field))
            if ma is not None and ma > 0 and close > ma:
                f |= bit
        if dist is not None and dist >= -5.0:
            f |= F_NEAR_HIGH
        if high and high > 0 and close >= high * 0.999:
            f |= F_NEW_HIGH
        if low and low > 0 and close <= low * 1.001:
            f |= F_NEW_LOW
        if vr is not None and vr >= 1.5:
            f |= F_VOL15
        if vr is not None and vr >= 2.0:
            f |= F_VOL20
        if adv is not None and adv > 100_000:
            f |= F_LAKH

        rows.append({
            "t": symbol,
            "s": stage,
            "d": dist,
            # Average monthly SHARES. Stored as an int — the page formats it.
            "v": None if adv is None else int(adv * SESSIONS_PER_MONTH),
            "f": f,
        })

    # Alphabetical by ticker. Sorting by distance-from-high put ~1,100
    # consecutive Advancing rows at the top, which reads as a broken page.
    rows.sort(key=lambda r: r["t"])
    return rows


def counts(rows) -> dict[str, int]:
    c = {f"st{code}": 0 for code, _ in STAGES}
    c["stU"] = 0
    for fid, _label, _bit in PRICE_FILTERS + VOLUME_FILTERS:
        c[fid] = 0
    for r in rows:
        c["stU" if r["s"] == -1 else f"st{r['s']}"] += 1
        for fid, _label, bit in PRICE_FILTERS + VOLUME_FILTERS:
            if r["f"] & bit:
                c[fid] += 1
    return c


# ── Page ────────────────────────────────────────────────────────────────
# Colour direction: the DATA is the brightest thing. Near-white tickers
# and numbers, mid-grey labels; the contrast between those two carries the
# hierarchy, not colour or weight. Accent is a desaturated green used only
# on selected filter ticks — never on a large button.
#
# Stage hues are four muted tones of similar saturation. Deliberately NOT
# red-for-declining / green-for-advancing: that reads as a verdict, and
# the page is a classification, not advice.
CSS = """*{margin:0;padding:0;box-sizing:border-box}
:root{
 --bg:#0d0f11;--surface:#14171a;--line:#1e2226;--line-soft:#191c1f;
 --ink:#e8eaed;--ink-2:#9aa0a6;--ink-3:#6b7075;
 --accent:#6ea882;
 --s0:#6e8ca8;--s1:#8a9a6b;--s2:#a89060;--s3:#9c7a86;--sU:#5c6166;
 --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
 --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
body{background:var(--bg);color:var(--ink);font:13px/1.4 var(--sans);
 -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:760px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:baseline;
 gap:12px;padding:12px 14px;border-bottom:1px solid var(--line)}
header b{font-size:14px;font-weight:600;letter-spacing:-.01em}
header time{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.bar{position:sticky;top:0;z-index:20;background:var(--bg);
 border-bottom:1px solid var(--line);padding:8px 14px;
 display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.bar .chain{flex:1;min-width:0;font-size:11.5px;color:var(--ink-2);
 overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .n{font-family:var(--mono);font-size:12px;color:var(--ink);
 flex-shrink:0}
.bar .clear{font-size:11.5px;color:var(--ink-3);text-decoration:underline;
 background:none;border:0;cursor:pointer;flex-shrink:0;padding:4px;
 font-family:var(--sans)}
.bar .clear[hidden]{display:none}
/* Filters are always on screen. They were behind a full-screen sheet,
   which hid the very thing the page is for AND hid the live count while
   you were ticking — you had to close the sheet to see what you had
   done, which reads as "nothing happened". */
.filters{padding:2px 0 10px;border-bottom:1px solid var(--line)}
.filters h2{font:600 10px/1 var(--sans);letter-spacing:.12em;
 text-transform:uppercase;color:var(--ink-3);padding:12px 14px 7px}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;
 padding:0 11px;border:1px solid var(--line);border-radius:2px;
 background:var(--surface);cursor:pointer;font-size:12px;color:var(--ink-2)}
.chip em{font-style:normal;font-family:var(--mono);font-size:10.5px;
 color:var(--ink-3)}
.chip input{appearance:none;-webkit-appearance:none;width:13px;height:13px;
 border:1px solid var(--ink-3);border-radius:2px;background:transparent;
 flex-shrink:0;cursor:pointer}
.chip input:checked{background:var(--accent);border-color:var(--accent)}
.chip:has(input:checked){color:var(--ink);border-color:var(--ink-3)}
.note{padding:10px 14px 0;font-size:11px;color:var(--ink-3);line-height:1.6}
#list a{display:block;padding:11px 14px;text-decoration:none;
 color:var(--ink);border-bottom:1px solid var(--line-soft);min-height:44px}
#list a:active{background:var(--surface)}
.r1,.r2{display:flex;justify-content:space-between;align-items:baseline;
 gap:12px}
.r1 b{font-weight:600;font-size:13.5px;min-width:0;overflow:hidden;
 text-overflow:ellipsis;white-space:nowrap}
.r1 span{flex-shrink:0;font-size:11px}
.r2{margin-top:2px}
.r2 i,.r2 u{font-style:normal;text-decoration:none;font-family:var(--mono);
 font-size:11px;color:var(--ink-2)}
.r2 u{flex-shrink:0;color:var(--ink-3)}
.s0{color:var(--s0)}.s1{color:var(--s1)}.s2{color:var(--s2)}
.s3{color:var(--s3)}.sU{color:var(--sU)}
/* NAVIGATION. The rebuild dropped both bars, leaving no way off this
   page except the browser back button. Mirrors src/components/BottomNav.jsx
   and DesktopSidebar.jsx — this page is served outside React, so it
   renders its own copy and the two must be kept in step by hand. */
.tabs{position:fixed;bottom:0;left:0;right:0;z-index:30;display:flex;
 background:var(--surface);border-top:1px solid var(--line);
 padding-bottom:env(safe-area-inset-bottom)}
.tabs a{flex:1;display:flex;align-items:center;justify-content:center;
 min-height:52px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;
 color:var(--ink-3);text-decoration:none;
 border-right:1px solid var(--line-soft)}
.tabs a:last-child{border-right:0}
.tabs a.cur{color:var(--accent)}
.side{display:none}
/* Clears the fixed bar so nothing can ever sit on the disclaimer.
   56px, not 52: the tabs are 52px of link plus a 1px top border, and a
   52px reserve left the footer's last pixel under the bar. Measured at
   390px — footer bottom 792 against nav top 791. */
body{padding-bottom:calc(56px + env(safe-area-inset-bottom))}
@media(min-width:1024px){
 .tabs{display:none}
 body{padding-bottom:0;padding-left:212px}
 .side{display:block;position:fixed;top:0;left:0;bottom:0;width:212px;
  background:var(--surface);border-right:1px solid var(--line);
  overflow-y:auto;z-index:30;padding:16px 0}
 .side b{display:block;padding:0 16px 12px;font-size:14px;font-weight:600;
  border-bottom:1px solid var(--line);margin-bottom:8px}
 .side a{display:block;padding:0 16px;min-height:44px;display:flex;
  align-items:center;font-size:14px;color:var(--ink-2);text-decoration:none;
  border-left:2px solid transparent}
 .side a:hover{color:var(--ink);background:var(--line-soft)}
 .side a.cur{color:var(--ink);border-left-color:var(--accent)}
 .side hr{border:0;border-top:1px solid var(--line);margin:8px 16px}
}
#msg,.empty{padding:24px 14px;font-size:12.5px;color:var(--ink-2);
 line-height:1.7}
.empty b{color:var(--ink);font-weight:600}
footer{padding:20px 14px 32px;border-top:1px solid var(--line);
 font-size:11px;line-height:1.7;color:var(--ink-3)}
footer p+p{margin-top:8px}
@media(min-width:761px){
 .wrap,#sheet .in{border-left:1px solid var(--line);
  border-right:1px solid var(--line)}
}"""

DISCLAIMER = [
    "PineX displays historical market behaviour and market-structure "
    "observations. It does not provide investment advice, recommendations, "
    "or trade instructions.",
    "Always independently verify all data at nseindia.com before making "
    "any financial decision. PineX is not a SEBI-registered Investment "
    "Adviser.",
]


# One script block. Vanilla, no libraries, no build step. ~95 lines of
# logic, inside the 150-line budget.
#
# Filtering is a single .filter()-style pass over 2,122 objects and ONE
# innerHTML write. No virtual scroller, no pagination — the whole render
# is well under a frame at this size.
# NOTE: this template is applied with Python's % operator, so every
# literal percent sign inside it must be doubled. There is exactly one,
# in pct().
JS = """(function(){
var $=function(i){return document.getElementById(i)};
var list=$('list'),msg=$('msg'),bar=$('n'),chain=$('chain'),
    clr=$('clear'),filters=$('filters');
var DATA=[],ST={},LBL=%(labels)s,MASK=%(masks)s;
var SNAME=['Basing','Advancing','Topping','Declining'];

function fmt(n){
  if(n==null)return '\\u2014';
  var a=[[1e9,'B'],[1e6,'M'],[1e3,'K']],i;
  for(i=0;i<a.length;i++)if(n>=a[i][0])return (n/a[i][0]).toFixed(1)+a[i][1];
  return String(n);
}
function pct(d){
  if(d==null)return '\\u2014';
  return d>=-0.05?'at high':d.toFixed(1)+'%% from high';
}
function scls(s){return s<0?'sU':'s'+s}
function stxt(s){return s<0?'\\u2014':SNAME[s]}
function sname(s){return s<0?'Unclassified':SNAME[s]}

// Ticks under one heading are OR. Different headings are AND.
function match(r){
  if(ST.stage.length && ST.stage.indexOf(r.s)<0) return false;
  for(var g in MASK){
    var sel=ST[g];
    if(!sel.length) continue;
    var ok=false;
    for(var i=0;i<sel.length;i++){ if(r.f & MASK[g][sel[i]]){ok=true;break} }
    if(!ok) return false;
  }
  return true;
}

function render(){
  var names=[],i2,g;
  for(i2=0;i2<ST.stage.length;i2++) names.push(sname(ST.stage[i2]));
  for(g in MASK) for(i2=0;i2<ST[g].length;i2++) names.push(LBL[ST[g][i2]]);
  chain.textContent=names.join(' \u00b7 ');
  clr.hidden=!names.length;

  // NO TICKERS UNTIL A FILTER IS SET. The bar still reports the size of
  // the universe and the sheet still carries a live count against every
  // condition, so the page is not silent about what it holds — it
  // just does not list names unasked.
  if(!names.length){
    list.innerHTML='<p class="empty">Pick a condition above to list'
      +' stocks.<br>Each number is how many stocks meet that condition'
      +' on its own.</p>';
    bar.textContent=DATA.length.toLocaleString('en-IN')+' stocks';
    return;
  }

  var out=[],n=0,i,r;
  for(i=0;i<DATA.length;i++){
    r=DATA[i];
    if(!match(r)) continue;
    n++;
    out.push('<a href="/stock/'+encodeURIComponent(r.t)+'">'
      +'<span class="r1"><b>'+r.t+'</b>'
      +'<span class="'+scls(r.s)+'">'+stxt(r.s)+'</span></span>'
      +'<span class="r2"><i>'+pct(r.d)+'</i><u>'+fmt(r.v)+'</u></span></a>');
  }
  list.innerHTML=out.join('');
  bar.textContent=n.toLocaleString('en-IN')+' stock'+(n===1?'':'s');
}

function readFilters(){
  ST={stage:[]};
  for(var g in MASK) ST[g]=[];
  var boxes=filters.querySelectorAll('input[type=checkbox]'),i,b;
  for(i=0;i<boxes.length;i++){
    b=boxes[i];
    if(!b.checked) continue;
    if(b.getAttribute('data-g')==='stage')
      ST.stage.push(parseInt(b.getAttribute('data-v'),10));
    else ST[b.getAttribute('data-g')].push(b.id);
  }
  render();
}

clr.onclick=function(){
  var boxes=filters.querySelectorAll('input[type=checkbox]'),i;
  for(i=0;i<boxes.length;i++) boxes[i].checked=false;
  readFilters();
};
filters.addEventListener('change',readFilters);

fetch('/screener.json').then(function(r){
  if(!r.ok) throw new Error(r.status);
  return r.json();
}).then(function(d){
  DATA=d; msg.hidden=true;
  ST={stage:[]}; for(var g in MASK) ST[g]=[];
  render();
}).catch(function(){
  msg.hidden=false;
  msg.textContent='The stock list could not be loaded. Reload the page,'
    +' or check back shortly.';
  bar.textContent='\\u2014';
});
})();"""


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;"))


def build_html(as_of, c):
    def box(fid, label, group, value, count):
        return (f'<label class="chip"><input type="checkbox" id="{fid}" '
                f'data-g="{group}" data-v="{value}">'
                f"<span>{esc(label)}</span><em>{count:,}</em></label>")

    stage_boxes = "".join(
        box(f"st{code}", name, "stage", code, c[f"st{code}"])
        for code, name in STAGES
    ) + box("stU", "Unclassified", "stage", -1, c["stU"])
    price_boxes = "".join(
        box(fid, lbl, "price", "", c[fid]) for fid, lbl, _b in PRICE_FILTERS)
    vol_boxes = "".join(
        box(fid, lbl, "vol", "", c[fid]) for fid, lbl, _b in VOLUME_FILTERS)

    script = JS % {
        "labels": json.dumps(
            {fid: lbl for fid, lbl, _b in PRICE_FILTERS + VOLUME_FILTERS},
            separators=(",", ":")),
        "masks": json.dumps({
            "price": {fid: bit for fid, _l, bit in PRICE_FILTERS},
            "vol": {fid: bit for fid, _l, bit in VOLUME_FILTERS},
        }, separators=(",", ":")),
    }

    date_txt = ""
    if as_of:
        y, m, d = as_of[:10].split("-")
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        date_txt = f"{int(d)} {months[int(m) - 1]} {y}"

    disclaimer = "".join(f"<p>{esc(p)}</p>" for p in DISCLAIMER)

    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<link rel="canonical" href="https://pinex.in/quickscanner">\n'
        "<title>PineX Screener</title>\n"
        f"<style>{CSS}</style>\n</head>\n<body>\n"
        '<div class="wrap">\n'
        f"<header><b>PineX Screener</b><time>{esc(date_txt)}</time></header>\n"
        # ONE bar, ONE button. Chain, live count and Clear on the first
        # line; the button below it so a long chain cannot squeeze it.
        '<div class="bar">'
        '<span class="chain" id="chain"></span>'
        '<span class="n" id="n">—</span>'
        '<button class="clear" id="clear" type="button" hidden>Clear</button>'
        "</div>\n"
        # Filters inline and always on screen. No button, no sheet: the
        # sheet hid the live count while you were ticking, so you had to
        # close it to find out what you had done.
        '<div class="filters" id="filters">'
        f'<h2>Stage</h2><div class="chips">{stage_boxes}</div>'
        f'<h2>Price</h2><div class="chips">{price_boxes}</div>'
        f'<h2>Volume</h2><div class="chips">{vol_boxes}</div>'
        '<p class="note">Ticks under one heading are combined with OR. '
        "Different headings are combined with AND.</p>"
        "</div>\n"
        # Never a spinner or a skeleton — real rows or a sentence.
        '<p id="msg">Loading the stock list…</p>\n'
        '<div id="list"></div>\n'
        f"<footer>{disclaimer}</footer>\n"
        "</div>\n"
        # Nav — mirrors BottomNav.jsx and DesktopSidebar.jsx. This page is
        # served outside React, so it renders its own copy; the two have to
        # be kept in step by hand and nothing enforces it.
        '<nav class="side" aria-label="Sections">'
        "<b>PineX</b>"
        '<a href="/pulse">Health</a><a href="/home">Today</a><hr>'
        '<a href="/home?tab=sectors">Sectors</a>'
        '<a class="cur" aria-current="page" href="/quickscanner">Screener</a>'
        '<a href="/heatmap">Heatmap</a><hr>'
        '<a href="/dashboard">Watchlist</a><a href="/journal">Journal</a>'
        '<a href="/learn">Learn</a><a href="/profile">Profile</a>'
        "</nav>\n"
        '<nav class="tabs" aria-label="Sections">'
        '<a href="/home">Today</a><a href="/pulse">Health</a>'
        '<a class="cur" aria-current="page" href="/quickscanner">Screener</a>'
        '<a href="/journal">Journal</a><a href="/profile">Profile</a>'
        "</nav>\n"
        f"<script>{script}</script>\n</body>\n</html>\n"
    )


def main():
    print("=" * 62)
    print("PINEX SCREENER — data + page")
    print("=" * 62)
    symbols = fetch_symbols()
    latest, as_of = fetch_latest()
    rows = build_rows(symbols, latest)
    c = counts(rows)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
    JSON_FILE.write_text(payload, encoding="utf-8")
    html = build_html(as_of, c)
    HTML_FILE.write_text(html, encoding="utf-8")

    print(f"\n  universe {len(rows):,} rows   as of {as_of}")
    print("  stage: " + ", ".join(
        f"{name} {c[f'st{code}']:,}" for code, name in STAGES)
        + f", Unclassified {c['stU']:,}")
    for fid, lbl, _b in PRICE_FILTERS + VOLUME_FILTERS:
        print(f"    {lbl:<24}{c[fid]:>7,}")
    jb, hb = len(payload.encode()), len(html.encode())
    print(f"\n  screener.json      {jb:>8,} B  ({jb / 1024:.1f} KB)")
    print(f"  quickscanner.html  {hb:>8,} B  ({hb / 1024:.1f} KB)")
    print(f"  total              {jb + hb:>8,} B  ({(jb + hb) / 1024:.1f} KB)")
    if jb > 200 * 1024:
        print("  !! screener.json is over the 200 KB budget")
    return 0


if __name__ == "__main__":
    sys.exit(main())
