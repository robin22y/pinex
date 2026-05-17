# PineX — Indian Equity Intelligence Platform

> **For developers reviewing this codebase:**
> PineX is a dark-theme Indian stock screener built on Stan Weinstein's Stage Analysis method.
> It tracks 2,100+ NSE stocks with delivery data, market breadth signals, and AI-generated insights.
> This README covers architecture, database schema, data pipelines, and every major design decision.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [Design System](#4-design-system)
5. [Database Schema](#5-database-schema)
6. [Data Pipeline](#6-data-pipeline)
7. [Frontend Pages](#7-frontend-pages)
8. [GitHub Actions Workflows](#8-github-actions-workflows)
9. [AI Layer](#9-ai-layer)
10. [Admin Panel](#10-admin-panel)
11. [Environment Variables](#11-environment-variables)
12. [Local Development](#12-local-development)
13. [Key Business Logic](#13-key-business-logic)
14. [Known Issues & Technical Debt](#14-known-issues--technical-debt)
15. [Deployment](#15-deployment)
16. [Cost Structure](#16-cost-structure)

---

## 1. Project Overview

**PineX** (formerly StockIQ) is a professional Indian equity intelligence platform for retail investors.

### What it does
- Tracks 2,100+ NSE-listed stocks with daily End-of-Day (EOD) data
- Classifies each stock into Weinstein Stage 1/2/3/4 using the 30-week Moving Average
- Calculates delivery percentage signals (institutional conviction indicator)
- Shows market breadth (% of stocks above 30W MA) as a market health indicator
- Provides AI-generated plain-language stock descriptions
- Sends weekly Telegram broadcasts to a community channel (`@pinexin`)
- Admin panel for managing descriptions, stage overrides, data quality, and Telegram broadcasts

### Target Users
- Active Indian retail investors
- Telegram trading communities
- Nifty 500 focused investors

### Live URL
`pinex.in` / `pinex26.netlify.app`

### Supabase Project
`xiozupvhtdqvpkgnftph.supabase.co`

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + Vite | SPA, React Router v6 |
| Styling | Inline styles + Tailwind utilities | Terminal dark aesthetic |
| Database | Supabase (PostgreSQL) | Free tier, 500MB limit |
| Auth | Supabase Auth | Google OAuth + email |
| Icons | Tabler Icons (ti-*) + Lucide React | Both loaded |
| Charts | Recharts | Bar/line charts |
| Hosting | Netlify | Auto-deploy from GitHub |
| Functions | Netlify Functions (Node.js) | API proxies, Telegram, AI |
| Scripts | Python 3.11 | Run via GitHub Actions |
| AI (descriptions) | Claude Haiku (`claude-haiku-4-5-20251001`) | Stock descriptions |
| AI (broadcasts) | Claude Haiku + Gemini 2.5 Flash | Admin Telegram panel |
| Data | NSE/BSE Bhav Copies | Free, no rate limits |
| Supplemental | IndianAPI (₹899/month) | Financials, shareholding, news |

---

## 3. Repository Structure

```
stockiq/                          ← project root
├── src/
│   ├── pages/
│   │   ├── Home.jsx              ← main screener dashboard
│   │   ├── StockDetail.jsx       ← individual stock page
│   │   ├── Dashboard.jsx         ← user watchlist/dashboard
│   │   ├── HeatMap.jsx           ← sector heatmap (D3)
│   │   ├── LandingPage.jsx       ← public landing page
│   │   ├── Account.jsx           ← user profile, Telegram join link
│   │   ├── Learn.jsx             ← /learn — education modules
│   │   ├── About.jsx             ← about us
│   │   ├── Privacy.jsx           ← privacy policy
│   │   ├── Terms.jsx             ← terms & conditions
│   │   └── admin/
│   │       ├── AdminLayout.jsx
│   │       ├── AdminDashboard.jsx
│   │       ├── AdminStocks.jsx
│   │       ├── AdminStockEdit.jsx
│   │       ├── AdminDescriptions.jsx  ← AI description generator
│   │       ├── AdminUsers.jsx         ← user list (via Netlify function)
│   │       ├── AdminResults.jsx       ← result calendar paste UI
│   │       └── AdminTelegram.jsx      ← ⭐ Telegram broadcast panel (4 tabs)
│   ├── components/
│   │   ├── Navbar.jsx
│   │   ├── DesktopSidebar.jsx    ← desktop sidebar navigation
│   │   ├── DeliveryPanel.jsx
│   │   ├── RevenueChart.jsx
│   │   ├── ShareholdingChart.jsx
│   │   ├── SignalPanel.jsx
│   │   ├── StockShareCard.jsx    ← shareable stock card image
│   │   └── SectorShareCard.jsx   ← shareable sector card image
│   ├── lib/
│   │   ├── supabaseClient.js     ← Supabase client init
│   │   ├── adminLog.js           ← admin action logger
│   │   ├── appNav.js             ← app navigation helpers
│   │   ├── watchlistTable.js     ← watchlist table utilities
│   │   └── isAdmin.js            ← admin guard (robin22y@gmail.com)
│   └── App.jsx                   ← routes
│
├── scripts/                      ← Python data pipeline
│   ├── .env                      ← secrets (not committed)
│   ├── db.py                     ← Supabase client + helpers
│   ├── symbols.py                ← auto-generated symbol list
│   ├── build_symbols.py          ← regenerates symbols.py
│   │
│   ├── fetch_bhav_daily.py       ← ⭐ main daily EOD script
│   ├── fetch_bhav_history.py     ← one-time 210-day backfill
│   ├── calc_delivery_signals.py  ← delivery signal calculation
│   ├── calc_market_internals.py  ← breadth + market health
│   ├── fetch_vix.py              ← India VIX from NSE
│   │
│   ├── fetch_indianapi.py        ← ⭐ financials/shareholding/news
│   ├── fetch_result_calendar.py  ← upcoming result dates
│   ├── fetch_bse_announcements.py
│   │
│   ├── classify_sectors_gemini.py ← AI sector classification
│   ├── generate_descriptions_gemini.py
│   ├── generate_telegram_broadcast.py ← weekly Telegram post
│   │
│   ├── fix_rs.py                 ← one-time RS backfill
│   ├── seed_companies.py         ← initial company seeding
│   ├── update_nifty_lists.py     ← tier 1/2 assignment
│   ├── backfill_bse_codes.py
│   └── data/
│       ├── EQUITY_L.csv          ← NSE equity list
│       └── nifty500.csv          ← Nifty 500 symbols
│
├── netlify/
│   └── functions/
│       ├── claude.js                      ← Claude API proxy
│       ├── admin-fetch-price.js           ← price data for admin
│       ├── admin-fetch-financials.js      ← financials for admin
│       ├── admin-generate-ai-description.js
│       ├── admin-generate-broadcast.js    ← ⭐ AI broadcast generator (Claude + Gemini)
│       ├── admin-send-telegram.js         ← ⭐ sends to Telegram channel/subscribers
│       └── admin-list-users.js            ← lists Supabase auth users for AdminUsers
│
├── .github/
│   └── workflows/
│       ├── daily.yml             ← 4:30 PM IST Mon-Fri
│       ├── weekly.yml            ← Saturday 10 AM
│       ├── quarterly.yml         ← quarterly data refresh
│       └── fetch-results.yml     ← manual trigger
│
├── netlify.toml                  ← build config + local dev proxy
├── .cursorrules                  ← Cursor AI context file
└── README.md                     ← this file
```

---

## 4. Design System

All UI uses inline styles (not Tailwind) for the terminal aesthetic. Tailwind only for layout utilities.

### Colors
```javascript
const C = {
  bg:       '#0B0E11',   // page background
  surface:  '#0F1217',   // cards, sidebar
  surface2: '#0D1525',   // elevated surfaces
  border:   '#1E2530',   // all borders
  borderHover: '#2D3748',

  text:     '#E2E8F0',   // primary text
  textMuted:'#64748B',   // secondary text
  textHint: '#475569',   // hints, placeholders

  green:    '#00C805',   // uptrend, positive, success
  red:      '#FF3B30',   // downtrend, negative, danger
  blue:     '#60A5FA',   // info, Stage 1
  amber:    '#FBBF24',   // warning, Stage 3
  orange:   '#F97316',   // elevated warning
}
```

### Stage Badge Colors
```
Stage 2 (Uptrend):   bg rgba(0,200,5,.12)    color #00C805
Stage 1 (Base):      bg rgba(96,165,250,.12)  color #60A5FA
Stage 3 (Topping):   bg rgba(251,191,36,.12)  color #FBBF24
Stage 4 (Downtrend): bg rgba(255,59,48,.12)   color #FF3B30
```

### Typography
- Font: DM Sans (loaded via Google Fonts)
- Mono: DM Mono (for prices and numbers)
- Base size: 13px
- Minimum: 10px

### SEBI-Safe Language Rules
The platform avoids language that implies investment advice:

| ❌ Avoid | ✅ Use Instead |
|---------|--------------|
| Bullish | Uptrend |
| Bearish | Downtrend |
| Buy signal | Technical alignment |
| Breakout | Above key level |
| Breakdown | Below key level |
| Accumulation | Institutional base |
| High conviction | Multi-factor setup |
| Warning | Watch |

Every stock page has a disclaimer footer:
> "Data is for informational and educational purposes only. Not investment advice."

---

## 5. Database Schema

### Critical Note on Column Names
**Always use these exact names — wrong names cause 400/404 errors.**

#### `companies`
```sql
id                    uuid PRIMARY KEY
symbol                text UNIQUE         -- NSE symbol e.g. "SYRMA"
name                  text
sector                text                -- from SECTOR_LIST
industry              text
exchange              text default 'NSE'
bse_code              text
tier                  integer             -- 1=Nifty50, 2=Nifty500, 3=rest
isin                  text
market_cap            numeric
is_suspended          boolean default false
description           text                -- plain language description
description_approved  boolean default false
stage_override        text                -- manual stage override
stage_override_expires_at timestamptz
stage_override_reason text
analyst_strong_buy    integer
analyst_buy           integer
analyst_hold          integer
analyst_sell          integer
nifty50               boolean default false
nifty500              boolean default false
```

#### `price_data`
```sql
id                  uuid PRIMARY KEY
company_id          uuid REFERENCES companies(id)   -- ⚠️ FK is company_id, NO symbol column
date                date                        -- ⚠️ NOT trading_date
close               numeric
open                numeric
high                numeric
low                 numeric
volume              numeric
prev_close          numeric
ma20                numeric                     -- 20-day MA
ma50                numeric                     -- 50-day MA
ma150               numeric                     -- 150-day MA
ma30w               numeric                     -- 30-WEEK MA (key indicator)
ma30w_slope         numeric                     -- weekly slope %
rsi                 numeric                     -- 14-period RSI
obv                 numeric                     -- On Balance Volume
obv_slope           text                        -- ⚠️ stored as TEXT, use parseFloat()
stage               text                        -- Stage 1/2/3/4/Unclassified
weinstein_substage  text                        -- e.g. "2A", "2B", "2C"
high_52w            numeric
low_52w             numeric
rs_vs_nifty         numeric                     -- 1-year return vs Nifty (%)
rs_positive         boolean
breakout_52w        boolean
is_latest           boolean                     -- ⚠️ only ONE row per company should be true
data_source         text default 'bhav'
UNIQUE(company_id, date)
```

#### `delivery_data`
```sql
company_id      uuid                            -- ⚠️ FK, no symbol column
date            date                            -- ⚠️ NOT trading_date
delivery_pct    numeric                         -- % of volume that was delivery
delivery_volume numeric
total_volume    numeric
avg_30d         numeric
vs_30d_avg      numeric
is_unusual      boolean
UNIQUE(company_id, date)
```

#### `delivery_signals`
```sql
company_id              uuid                    -- ⚠️ FK, no symbol column
date                    date
avg_delivery_7d         numeric
avg_delivery_30d        numeric
avg_delivery_60d        numeric
avg_volume_30d          numeric
vol_ratio               numeric                 -- today's vol / 30d avg
delivery_trend_30d      text                    -- 'rising'/'falling'/'flat'
price_change_7d         numeric
is_accumulation         boolean
is_distribution         boolean
breakout_30wma          boolean
breakdown_30wma         boolean
breakout_50dma          boolean
breakdown_50dma         boolean
weak_delivery           boolean
high_conviction         boolean                 -- ⭐ SwingX flag (multi-factor setup)
pct_from_30w            numeric                 -- distance from 30W MA (%)
fii_change              numeric                 -- FII % change QoQ
dii_change              numeric                 -- DII % change QoQ
promoter_increasing     boolean
revenue_growing_3q      boolean
pct_from_52w_high       numeric
UNIQUE(company_id, date)
```

#### `financials`
```sql
company_id          uuid
quarter             text        -- ⚠️ NOT quarter_name. Format: "Jun 2024" or "FY2025"
period_type         text        -- 'quarterly' or 'annual'
is_annual           boolean default false
revenue             numeric     -- in Crores
operating_profit    numeric
net_profit          numeric     -- ⚠️ column is net_profit, NOT pat
eps                 numeric
margin              numeric     -- operating margin %
revenue_growth_qoq  numeric
revenue_growth_yoy  numeric
pat_growth_qoq      numeric
pat_growth_yoy      numeric
data_source         text default 'indianapi'
UNIQUE(company_id, quarter)
```

#### `shareholding`
```sql
company_id          uuid
quarter             text        -- ⚠️ NOT quarter_name
promoter_pct        numeric
fii_pct             numeric
dii_pct             numeric
public_pct          numeric
total_pct           numeric
promoter_pledge_pct numeric      -- 0 = clean promoter
named_investors     jsonb
data_source         text
UNIQUE(company_id, quarter)
```

#### `market_internals`
```sql
date                    date PRIMARY KEY
nifty_close             numeric
nifty_ath               numeric             -- all-time high (26277.35)
nifty_pct_from_ath      numeric
nifty_near_ath          boolean
nifty_change_1d         numeric
nifty_consecutive_up    integer
nifty_consecutive_down  integer
above_ma150_pct         numeric             -- % stocks above 30W MA (breadth)
stage2_pct              numeric
stage2_count            integer
stage4_pct              numeric
new_52w_highs           integer
new_52w_lows            integer
advance_decline_ratio   numeric
india_vix               numeric
market_trend            text
market_health_score     integer
market_phase            text
breadth_divergence      boolean             -- Nifty up but breadth falling
lows_expanding          boolean
```

#### `nifty_sectors`
```sql
date            date
index_name      text    -- internal name e.g. "NIFTY AUTO"
display_name    text    -- human name e.g. "Auto"
change_1d       numeric -- 1-day % change
change_1w       numeric -- 1-week % change
change_1m       numeric -- 1-month % change
change_3m       numeric -- 3-month % change
UNIQUE(date, index_name)
```
Used by HeatMap and the Admin Sector Spotlight panel. Always use latest date row for each sector.

#### `watchlists`
```sql
id              uuid PRIMARY KEY
user_id         uuid REFERENCES auth.users(id)
company_id      uuid REFERENCES companies(id)
symbol          text
added_at        timestamptz
price_at_add    numeric
reference_price numeric                     -- editable entry price
reference_date  date
group_name      text default 'My Watchlist'
notes           text
```

#### `result_calendar`
```sql
id              uuid PRIMARY KEY
symbol          text
company_id      uuid
result_date     date
purpose         text
event_type      text
indianapi_fetched boolean default false
UNIQUE(symbol, result_date)
```

#### `telegram_subscribers`
```sql
chat_id         text PRIMARY KEY    -- Telegram user chat ID
subscribed_at   timestamptz
```
Used by `admin-send-telegram.js` when `target='all'` — broadcasts to individual subscribers.

### Supabase RPC Functions
```sql
get_home_stocks()   -- joins companies + price_data + delivery_signals + shareholding
                    -- returns all columns needed for home page in one call
                    -- ⚠️ obv_slope is TEXT in this function, use parseFloat()
                    -- ⚠️ returns max 1,000 rows (PostgREST default)
                    -- includes: high_conviction, stage, weinstein_substage,
                    --           rs_vs_nifty, breakdown_50dma, weak_delivery
                    -- accessible to: anon role (public read)
```

### Row Level Security
```sql
-- Key RLS policies:
-- companies: public read, authenticated update
-- price_data: public read
-- watchlists: users can only see their own rows (auth.uid() = user_id)
-- admin_log: admin read only (robin22y@gmail.com)
-- shareholding: public read
-- financials: public read
-- nifty_sectors: public read
-- telegram_subscribers: admin/service role only
```

---

## 6. Data Pipeline

### Daily Flow (4:30 PM IST, Mon-Fri)

```
NSE/BSE Bhav Copies (free)
         ↓
fetch_bhav_daily.py
  - Downloads sec_bhavdata_full_DDMMYYYY.csv (NSE, ~2,442 EQ stocks)
  - Downloads BhavCopy_BSE_CM_*.CSV (BSE, ~2,503 stocks)
  - Calculates: MA20, MA50, MA150, MA30W, MA30W slope
  - Calculates: RSI (14-period), OBV, OBV slope
  - Classifies: Stage 1/2/3/4 (Weinstein method)
  - Calculates: RS vs Nifty (210-day comparison)
  - Upserts: price_data, updates is_latest flag
         ↓
calc_delivery_signals.py
  - Reads delivery from price_data (sec_bhavdata includes delivery)
  - Calculates 7/30/60-day delivery averages
  - Detects: accumulation, distribution, breakouts
  - Calculates: high_conviction (SwingX multi-factor setup)
  - Upserts: delivery_signals
         ↓
calc_market_internals.py
  - Counts Stage 2/4 stocks
  - Calculates breadth (% above MA)
  - Counts new 52W highs/lows
  - Calculates advance/decline ratio
  - Detects breadth divergence
  - Upserts: market_internals
         ↓
fetch_indianapi.py --tier=1 --news-only
  - Fetches news for Nifty 50 stocks only (daily)
  - 50 API calls/day
         ↓
fetch_result_calendar.py
  - Checks upcoming result announcements
  - Fetches financials for companies announcing results
         ↓
fetch_bse_announcements.py
  - Fetches BSE corporate announcements
  - Requires Referer: https://www.bseindia.com/corporates/ann.html
```

### Weekly Flow (Saturday 10 AM)

```
fetch_indianapi.py --nifty500 --news-only
  - News for all Nifty 500 stocks
  - ~500 API calls/week

generate_ai_content.py --new-only
  - Generates descriptions for stocks missing them
  - Uses Claude Haiku API

generate_telegram_broadcast.py
  - Reads top multi-factor stocks
  - Calls Claude to write plain-language summary
  - Posts to Telegram channel @pinexin
```

### Quarterly Flow (1st Saturday of Jan/Apr/Jul/Oct)

```
fetch_indianapi.py --all-tiers --financials-only
  - Fetches quarterly financials for all 2,100+ stocks
  - ~2,100 API calls

fetch_indianapi.py --all-tiers --shareholding-only
  - Fetches shareholding patterns for all stocks
  - ~2,100 API calls
```

### Data Sources

| Source | Data | Cost | Rate Limit |
|--------|------|------|-----------|
| NSE Bhav Copy | Price, OHLCV, delivery | Free | None |
| BSE Bhav Copy | Price, OHLCV | Free | None |
| IndianAPI | Financials, shareholding, news | ₹899/month | 10,000 calls/month |
| NSE VIX | India VIX daily | Free | None |
| Claude API | Descriptions, broadcasts | ~₹150/month | Per token |
| Gemini API | Sector classification, broadcasts | Free tier | 15 calls/min |

### Supabase Pagination (Critical)
**Supabase silently returns max 1,000 rows without error.**

Python scripts:
```python
_COMPANIES_PAGE = 1000
start = 0
while True:
    res = supabase.table('companies')\
        .select('id, symbol')\
        .range(start, start + _COMPANIES_PAGE - 1)\
        .execute()
    page = res.data or []
    if len(page) < _COMPANIES_PAGE:
        break
    start += _COMPANIES_PAGE
```

Frontend (React/Supabase JS):
```javascript
let all = [], from = 0
while (true) {
  const { data } = await supabase
    .from('companies')
    .select('id, symbol, name, sector')
    .order('symbol', { ascending: true })
    .range(from, from + 999)
  if (!data?.length) break
  all = all.concat(data)
  if (data.length < 1000) break
  from += 1000
}
```

The `get_home_stocks()` RPC also caps at 1,000 rows. The frontend handles this gracefully but be aware the home page may not show all stocks if total exceeds 1,000.

---

## 7. Frontend Pages

### Home.jsx (`/`)
Main screener dashboard. Dual layout: mobile (`md:hidden`) and desktop (`hidden md:block`).

**Key state:**
```javascript
allStocks       // 2,100+ stocks merged from 4 tables
filteredStocks  // after filter + search + sector click
marketHistory   // last 7 days market_internals
marketSignals   // computed signals array
sectorFilter    // null or sector name string
activeFilter    // 'stage2'|'accumulation'|'highconviction' etc
```

**Filter cards (8 total):**
- Uptrend Stocks (Stage 2)
- Institutional Base (accumulation)
- Volume Decline (distribution)
- Above 30W MA (breakout)
- Below 30W MA (breakdown)
- Above 50D MA
- Low Delivery
- Low Pledge (clean promoters)
- Multi-Factor Setup (high_conviction / SwingX)
- Pullback Watch (extended from MA)

**Market Intelligence Banner:**
Signals computed from last 7 days of market_internals.
Shows: breadth divergence, new lows expanding, VIX alerts, seasonal notes.

**Sector click → filter stocks:**
Clicking a sector in the performance panel filters the stock table. Uses a sector name map to translate "Nifty Auto" → "Auto" etc.

### StockDetail.jsx (`/stock/:symbol`)
Individual stock page with 4 tabs: Overview, Financials, Ownership, Technicals.

**Critical bugs fixed:**
- Use `.maybeSingle()` NOT `.single()` for price_data query (prevents 406 error)
- `obv_slope` is stored as TEXT — use `parseFloat(priceData?.obv_slope)`
- `quarterly_changes` table uses `quarter` column, not `quarter_name`
- Watchlist table is `watchlists` (plural)

**Tabs:**
- Overview: description, analyst consensus, what changed, delivery chart, news
- Financials: revenue chart, key metrics grid (12 cells), shareholding snapshot, financials table
- Ownership: promoter/FII/DII breakdown, pledge warning
- Technicals: RS vs Nifty, OBV trend, RSI, all MAs, stage

### Dashboard.jsx (`/dashboard`)
User watchlist with gain tracking.

**Watchlist columns:**
Stock | Added date | Ref price (editable) | CMP | Gain % | Gain ₹ | % from 30W MA | Stage | Remove

**Gain colors:**
- ≥ +10%: `#00C805`
- ≥ 0%: `#86EFAC`
- ≥ -5%: `#FCA5A5`
- < -5%: `#FF3B30`

### Account.jsx (`/account`)
User profile page. Shows avatar, name (editable), email, plan badge (FREE/PRO), usage bars.

**Telegram section:** Promotes `@pinexin` (PineX announcement channel for daily & weekly market updates).
Link: `https://t.me/pinexin`

### Learn.jsx (`/learn`)
Education modules on Weinstein Stage Analysis, delivery signals, and how to use PineX.

### About.jsx (`/about`)
About PineX — mission, team, methodology.

### Privacy.jsx (`/privacy`)
Privacy policy page.

### Terms.jsx (`/terms`)
Terms & conditions page.

### Admin Pages (`/admin/*`)
Guarded by `user?.email === 'robin22y@gmail.com'`.
On local dev, also protected by `VITE_ADMIN_LOCAL_PASSWORD` env variable (prompted on first visit).

**AdminDescriptions.jsx** — AI description generator:
- Left panel: filtered stock list (missing/pending/approved)
- Right panel: stock editor with AI generate button
- Bulk generate with progress bar
- Uses Claude Haiku via direct browser API call
- `VITE_CLAUDE_API_KEY` required in `.env`

**AdminTelegram.jsx** — Telegram broadcast panel (4 tabs):
- See [Admin Panel](#10-admin-panel) section for full details

---

## 8. GitHub Actions Workflows

### `daily.yml`
```yaml
schedule: '0 11 * * 1-5'  # 4:30 PM IST (UTC+5:30)
steps:
  - fetch_bhav_daily.py
  - calc_delivery_signals.py
  - calc_market_internals.py
  - update_sectors.py
  - fetch_indianapi.py --tier=1 --news-only
  - fetch_result_calendar.py
  - fetch_bse_announcements.py
  - fetch_vix.py
```

### `weekly.yml`
```yaml
schedule: '30 4 * * 6'  # Saturday 10 AM IST
steps:
  - fetch_indianapi.py --nifty500 --news-only
  - generate_ai_content.py --new-only
  - generate_telegram_broadcast.py
```

### `quarterly.yml`
```yaml
schedule: '0 5 1 1,4,7,10 *'  # 1st of Jan/Apr/Jul/Oct
steps:
  - fetch_indianapi.py --all-tiers --financials-only
  - fetch_indianapi.py --all-tiers --shareholding-only
```

### Required GitHub Secrets
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
INDIANAPI_KEY
CLAUDE_API_KEY
GEMINI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
```

---

## 9. AI Layer

### Claude API (Anthropic)
- **Model:** `claude-haiku-4-5-20251001` (cheapest, fast)
- **Used for:** Stock descriptions, Telegram broadcasts (via admin panel)
- **Cost:** ~₹150/month
- **Endpoint:** Via Netlify function `admin-generate-broadcast.js`

**Admin broadcast generation** (via Netlify function):
```javascript
// POST /.netlify/functions/admin-generate-broadcast
// Body: { prompt: "...", model: "claude" }
// Response: { text: "..." }
```

**Description prompt rules:**
- Max 60 words
- No buy/sell/bullish/bearish/target
- Factual only — what the company does
- Mention one notable metric if available

### Gemini 2.5 Flash (Google)
- **Model:** `gemini-2.5-flash`
- **Used for:** Sector classification, AI Telegram broadcasts (admin panel)
- **Cost:** Free tier
- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={API_KEY}`
- **Response path:** `candidates[0].content.parts[0].text`

**Admin broadcast generation (Gemini):**
```javascript
// POST /.netlify/functions/admin-generate-broadcast
// Body: { prompt: "...", model: "gemini" }
```

### Model Selection in Admin
The `admin-generate-broadcast.js` Netlify function accepts a `model` field:
- `model: "claude"` → routes to Claude Haiku API (needs `CLAUDE_API_KEY` env var)
- `model: "gemini"` → routes to Gemini 2.5 Flash API (needs `GEMINI_API_KEY` env var)

Admin UI shows a `[Claude | Gemini]` toggle pill to switch between models.

### Telegram Bot
- **Channel:** `@pinexin`
- Weekly broadcast every Saturday 8 AM (via GitHub Actions)
- Admin can also send manually via AdminTelegram panel
- Bot token stored in `TELEGRAM_BOT_TOKEN` env var
- Channel ID in `TELEGRAM_CHANNEL_ID` (accepts `@handle` or numeric ID)
- **`parse_mode: 'Markdown'`** — required for `*bold*` formatting; set in `admin-send-telegram.js`

---

## 10. Admin Panel

**Access:** `robin22y@gmail.com` only (hardcoded check in `isAdmin.js`)
**Local dev password:** `VITE_ADMIN_LOCAL_PASSWORD` in `.env.local` (prompted on first local visit)

### Admin Routes
```
/admin                  → AdminDashboard (stats, system health)
/admin/stocks           → AdminStocks (all 2,100+ stocks)
/admin/stocks/:symbol   → AdminStockEdit (override stage, edit description)
/admin/descriptions     → AdminDescriptions (AI generator)
/admin/users            → AdminUsers (user list via admin-list-users function)
/admin/results          → AdminResults (paste NSE CSV for result calendar)
/admin/telegram         → AdminTelegram (Telegram broadcast panel — 4 tabs)
```

### AdminTelegram Panel (`/admin/telegram`)

Four tabs:

#### Tab 1: Stock Spotlight
- Search all ~2,100+ stocks by symbol/name (paginated fetch from `companies` table, no 1000 cap)
- Type to search — no dropdown, inline results
- Select a stock → fetches latest price data + delivery in parallel (`Promise.all`)
- Shows metrics: Stage, Weinstein Substage, Close, RS vs Nifty, % from 30W MA, RSI, Avg Delivery 7D/30D, Vol Ratio
- `⚡ SwingX` badge shown if `high_conviction = true`
- `[Claude | Gemini]` model toggle pill
- **AI Write-up button** → calls `admin-generate-broadcast` with stock spotlight prompt
- Draft panel (editable) → **Send to Channel** button

#### Tab 2: Sector Spotlight
- Loads `nifty_sectors` table, filtered to latest date, sorted by 1W change
- Search by display name or index name
- Selected sector shows 1D/1W/1M/3M change metrics strip
- `[Claude | Gemini]` model toggle pill
- **AI Write-up button** → calls `admin-generate-broadcast` with sector spotlight prompt
- Draft panel (editable) → **Send to Channel** button

#### Tab 3: AI Broadcast
- Free-form topic input
- `[Claude | Gemini]` model toggle pill
- **Generate button** → calls `admin-generate-broadcast`
- Draft panel (editable) → **Send to Channel** button

#### Tab 4: Custom Message
- Plain text / Markdown textarea
- Character count
- **Send to Channel** button

All tabs use `admin-send-telegram.js` to send with `target: 'channel'`.

### Netlify Functions Used by Admin
```
POST /.netlify/functions/admin-generate-broadcast
  Body: { prompt, model: 'claude'|'gemini', symbol?, sector? }
  Response: { text: string }
  Env: CLAUDE_API_KEY, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

POST /.netlify/functions/admin-send-telegram
  Body: { message, target: 'channel'|'all'|'test', testChatId? }
  Response: { ok, sent, failed, total, errors }
  Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY

GET /.netlify/functions/admin-list-users
  Response: { users: [...] }
  Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
```

### netlifyFetch Helper
All fetch calls in AdminTelegram use a `netlifyFetch` helper instead of raw `fetch(...).json()`:
```javascript
async function netlifyFetch(path, options = {}) {
  const res = await fetch(path, options)
  const text = await res.text()
  if (!text) {
    if (res.status === 404) throw new Error(
      'Function not found — run `netlify dev` locally (not `npm run dev`)')
    throw new Error(`Server returned ${res.status} with no body`)
  }
  try { return JSON.parse(text) }
  catch {
    if (res.status === 404) throw new Error(
      'Function not found — run `netlify dev` locally (not `npm run dev`)')
    throw new Error(`Server returned ${res.status}: ${text.slice(0, 120)}`)
  }
}
```
This gives actionable error messages instead of cryptic JSON parse failures.

### Stage Override System
Admin can override a stock's calculated stage for 3/7/30 days.
`fetch_bhav_daily.py` checks for active overrides and respects them.

```sql
-- Active overrides
SELECT symbol, stage_override, 
       stage_override_expires_at,
       stage_override_reason
FROM companies
WHERE stage_override IS NOT NULL
  AND stage_override_expires_at > NOW();
```

### Result Calendar
Admin pastes NSE Board Meeting CSV from NSE website.
Format: `SYMBOL, COMPANY, PURPOSE, DETAILS, DATE`
Script matches by NSE symbol directly.

---

## 11. Environment Variables

### `scripts/.env` (Python scripts)
```bash
SUPABASE_URL=https://xiozupvhtdqvpkgnftph.supabase.co
SUPABASE_SERVICE_KEY=eyJ...           # service role key
INDIANAPI_KEY=your_key_here
CLAUDE_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
TELEGRAM_BOT_TOKEN=bot...
TELEGRAM_CHANNEL_ID=@pinexin
```

### `.env.local` (React frontend + Netlify dev)
```bash
VITE_SUPABASE_URL=https://xiozupvhtdqvpkgnftph.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...         # anon/public key
VITE_CLAUDE_API_KEY=sk-ant-...        # for admin description generator (browser-side)
VITE_ADMIN_LOCAL_PASSWORD=yourpass    # gates admin routes on localhost

# Server-side (read by Netlify functions — no VITE_ prefix)
CLAUDE_API_KEY=sk-ant-...             # for admin-generate-broadcast function
GEMINI_API_KEY=AIza...                # for admin-generate-broadcast function
TELEGRAM_BOT_TOKEN=bot...             # for admin-send-telegram function
TELEGRAM_CHANNEL_ID=@pinexin          # or numeric channel ID
SUPABASE_SERVICE_KEY=eyJ...           # service role key for admin functions
```

### Netlify Environment Variables (Dashboard)
Set in Netlify → Site Settings → Environment Variables (scope: Functions + Builds):
```
SUPABASE_URL
SUPABASE_SERVICE_KEY
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
CLAUDE_API_KEY
GEMINI_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHANNEL_ID
```

---

## 12. Local Development

### ⚠️ Use `netlify dev`, NOT `npm run dev`

Netlify Functions are **only** served by `netlify dev`. Running `npm run dev` (Vite only, port 5173) will return 404 for all `/.netlify/functions/*` requests.

```bash
# Install Netlify CLI once
npm install -g netlify-cli

# Start local dev with functions support
netlify dev
# Runs on http://localhost:8888
# Vite dev server proxied at port 5173 internally
```

The `netlify.toml` configures this:
```toml
[dev]
  command = "npm run dev"
  targetPort = 5173
  port = 8888
  framework = "#custom"
```

### Required env for local admin/Telegram testing
All of the following must be in `.env.local`:
- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather
- `TELEGRAM_CHANNEL_ID` — `@pinexin` or numeric ID
- `CLAUDE_API_KEY` — Anthropic key (server-side, no VITE_ prefix)
- `GEMINI_API_KEY` — Google AI key (server-side, no VITE_ prefix)
- `SUPABASE_SERVICE_KEY` — service role key for admin functions
- `VITE_ADMIN_LOCAL_PASSWORD` — any password string

---

## 13. Key Business Logic

### Weinstein Stage Classification

```python
def classify_stage(close, ma30w, ma30w_slope, 
                   obv_trend, high_52w, low_52w):
    
    above_ma = close > ma30w
    pct_from_ma = (close - ma30w) / ma30w * 100
    ma_rising = ma30w_slope > 0.5
    ma_falling = ma30w_slope < -0.5
    
    # Position in 52W range (context awareness)
    pct_position = (close - low_52w) / (high_52w - low_52w) * 100

    # STAGE 2: Price above rising MA
    if above_ma and pct_from_ma > 5 and ma_rising:
        return 'Stage 2'

    # STAGE 4: Price below falling MA  
    if not above_ma and pct_from_ma < -5 and ma_falling:
        return 'Stage 4'

    # STAGE 3: Topping (at highs, MA turning down)
    if pct_position > 60 and not ma_rising:
        return 'Stage 3'

    # STAGE 1: Base building (at lows, MA flattening)
    if pct_position < 50 and not ma_falling:
        return 'Stage 1'

    return 'Unclassified'
```

### RS vs Nifty Calculation

```python
# 210-day comparison (we keep 210 days max in DB)
stock_return = (close_today - close_210d_ago) / close_210d_ago * 100
nifty_return = (nifty_today - nifty_210d_ago) / nifty_210d_ago * 100
rs_vs_nifty = round(stock_return - nifty_return, 2)

# Positive = outperforming Nifty
# Negative = underperforming Nifty
```

### SwingX / High Conviction (Multi-Factor Setup)

`high_conviction` in `delivery_signals` is the **SwingX** flag. A stock qualifies when ALL conditions are met:
```python
high_conviction = (
    stage == 'Stage 2'           # in uptrend
    and close > ma30w            # above 30W MA
    and close > ma50             # above 50D MA
    and avg_delivery_30d > 40    # institutional delivery
    and vol_ratio > 1.0          # above-average volume
    and price_change_7d > 0      # positive momentum
    and pct_from_30w < 15        # not too extended (entry zone)
)
```

In the frontend, SwingX stocks show an `⚡ SwingX` badge. Filter: `activeFilter === 'highconviction'`.

### Nifty Stage Display

```javascript
const getNiftyStage = (market) => {
  const pctFromAth = market.nifty_pct_from_ath
  const breadth = market.above_ma150_pct || 0

  if (pctFromAth < -8 && breadth < 40) return 'Stage 4'
  if (pctFromAth < -5 && breadth < 55) return 'Stage 3'
  if (breadth > 55 && stage2pct > 35)  return 'Stage 2'
  return 'Stage 1'
}
// Nifty ATH = 26,277.35 (Sep 2024)
```

### Stock Scoring (1-10)

Plain language score shown on stock cards:
```
+1  Stage 2 (trending up 30+ weeks)
+1  Above long-term MA
+1  High delivery (> 45%)
+1  RS vs Nifty > +10%
+1  Promoter > 40% + zero pledge
+1  FII stake increasing (QoQ)
+1  DII stake increasing (QoQ)
+1  Near entry zone (< 8% from MA)
+1  Sector performing well
+1  Revenue growing 3+ quarters
```

### Financial Data Format Detection

```javascript
// Some stocks have annual data (FY2025) 
// others have quarterly (Jun 2024)
const isAnnual = financials?.every(f => 
  f.quarter?.startsWith('FY'))

// Show "Annual Results" or "Quarterly Results" accordingly
// Hide QoQ columns for annual data
```

---

## 14. Known Issues & Technical Debt

### Data Issues
```
⚠️  obv_slope stored as TEXT in price_data
    → Always use parseFloat() in frontend
    → Should be numeric but migration risky

⚠️  Some stocks have duplicate is_latest=true rows
    → Run: UPDATE price_data SET is_latest=false 
           WHERE is_latest=true AND id NOT IN (
             SELECT DISTINCT ON (company_id) id 
             FROM price_data 
             WHERE is_latest=true 
             ORDER BY company_id, date DESC)

⚠️  RS calculation uses 210 days not 252
    → Standard is 1 year (252 trading days)
    → Changed to fit 210-day DB retention limit

⚠️  market_internals only has ~2 weeks of data
    → Needs 30+ days for meaningful multi-day signals
    → Backfill: python calc_market_internals.py --backfill --days=60

⚠️  India VIX missing for most historical dates
    → NSE VIX API is unreliable
    → Run: python fetch_vix.py --days=30
```

### Frontend Issues
```
⚠️  StockDetail uses .maybeSingle() for price_data
    → If accidentally changed to .single(), get 406 error

⚠️  quarterly_changes table may not exist
    → Some code references it
    → Should query financials table instead

⚠️  Admin description page uses VITE_CLAUDE_API_KEY
    → This exposes key in browser bundle
    → Acceptable since admin-only, but not ideal
    → Future: proxy through Netlify function

⚠️  get_home_stocks() RPC caps at 1,000 rows
    → With 2,100+ stocks, home page may miss some
    → Workaround: increase PostgREST row limit in Supabase config
    → Or rewrite RPC to accept pagination params
```

### Architecture Debt
```
⚠️  Supabase free tier: 500MB limit
    → Retain only 210 days of price_data
    → Retain only 90 days of delivery_signals
    → Cleanup runs every Monday in fetch_bhav_daily.py

⚠️  get_home_stocks() RPC function
    → Needs to be recreated if columns added
    → Current version: includes high_conviction, 
      breakdown_50dma, weak_delivery, weinstein_substage

⚠️  .claude/ directory was accidentally committed
    → Added to .gitignore
    → Use git rm --cached to remove if reappears

⚠️  GitHub Actions Node.js 20 deprecation warning
    → Actions will force Node.js 24 from June 2026
    → Update actions/checkout and actions/setup-python
```

---

## 15. Deployment

### Frontend (Netlify)
```bash
# Auto-deploys on git push to main
git add .
git commit -m "your message"
git push

# Build command: npm run build
# Publish directory: dist
# Functions directory: netlify/functions
# Node version: 20.19.0 (set in netlify.toml)
```

### Python Scripts (GitHub Actions)
Scripts run automatically via `.github/workflows/`.
To run manually:
```bash
cd C:\Users\robin\Desktop\stockiq\scripts
venv\Scripts\activate
python fetch_bhav_daily.py
```

### Database Migrations
Run in Supabase SQL editor. Always run `notify pgrst, 'reload schema';` after adding columns.

### Common Deployment Issues

**Netlify build fails with git submodule error:**
```bash
git rm --cached ".claude/worktrees/zealous-nash-53027b"
git add -A
git commit -m "Remove stale submodule"
git push
```

**Supabase 406 error:**
```
Change .single() to .maybeSingle() in the query
```

**Supabase column not found (PGRST204):**
```
Run ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
Then: notify pgrst, 'reload schema';
```

**Netlify function 404 locally:**
```
Run netlify dev (port 8888) instead of npm run dev (port 5173)
Vite dev server alone doesn't serve /.netlify/functions/*
```

**Telegram bold/formatting not rendering:**
```
Ensure parse_mode: 'Markdown' is in the sendMessage payload
Set in admin-send-telegram.js → sendTelegram() function
```

---

## 16. Cost Structure

### Monthly
| Item | Cost |
|------|------|
| IndianAPI | ₹899 |
| Claude API | ~₹150 |
| Gemini API | ₹0 (free tier) |
| Domain | ₹67 |
| Supabase | ₹0 (free tier) |
| Netlify | ₹0 (free tier) |
| GitHub Actions | ₹0 (free tier) |
| **Total** | **~₹1,116/month** |

### IndianAPI Budget (10,000 calls/month)
```
Daily Tier 1 news (50 stocks):     1,500/month
Weekly Tier 2 news (500 stocks):   2,000/month  
Quarterly financials (2,100):        175/month (amortized)
Quarterly shareholding (2,100):      175/month (amortized)
Result calendar fetches:             300/month
Buffer:                            ~5,850/month ✅
```

---

## Quick Reference

### Most Common Tasks

**Add a new stock manually:**
```sql
INSERT INTO companies (symbol, name, sector, tier, exchange)
VALUES ('NEWSYM', 'Company Name', 'IT Services', 3, 'NSE');
```

**Force recalculate RS for all stocks:**
```bash
python fix_rs.py
```

**Backfill market internals:**
```bash
python calc_market_internals.py --backfill --days=60
```

**Check database size:**
```sql
SELECT tablename,
       pg_size_pretty(pg_total_relation_size(
         'public.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(
  'public.'||tablename) DESC;
```

**Clean up old data (if approaching 500MB):**
```sql
DELETE FROM price_data 
WHERE date < current_date - interval '210 days';

DELETE FROM delivery_data 
WHERE date < current_date - interval '210 days';

VACUUM FULL price_data;
VACUUM FULL delivery_data;
```

**Check stocks missing descriptions:**
```sql
SELECT tier, count(*) as missing
FROM companies
WHERE description IS NULL OR description = ''
GROUP BY tier ORDER BY tier;
```

**Find all SwingX (high conviction) stocks:**
```sql
SELECT c.symbol, c.name, p.stage, p.rs_vs_nifty, d.avg_delivery_30d
FROM delivery_signals d
JOIN companies c ON c.id = d.company_id
JOIN price_data p ON p.company_id = d.company_id AND p.is_latest = true
WHERE d.high_conviction = true
  AND d.date = (SELECT MAX(date) FROM delivery_signals)
ORDER BY d.avg_delivery_30d DESC;
```

---

*Last updated: May 2026*
*Built by Robin | PineX v1.0*
