# PineX

Stage Analysis for the Indian stock market — 2,125 NSE stocks, daily delivery + breadth signals, multilingual learning.

[**Live: pinex.in**](https://pinex.in) · React 19 · Vite · Supabase · Netlify · Python 3.11 · GitHub Actions

---

## What is PineX?

PineX is a private-beta screener built on Stan Weinstein's Stage Analysis method, adapted to the NSE. It tracks every Stage 2 advance, surfaces high-conviction setups via SwingX, layers Indian-specific signals like delivery percentage on top, and teaches the method in a 4-language Academy (English, Hindi, Malayalam, Tamil). It exists because Western screeners ignore delivery data, and Indian apps ignore Weinstein. PineX is the only tool that uses both.

---

## Architecture at a glance

```
   ┌──────────────────────────────────────────────────┐
   │  Browser — React + Vite (deployed on Netlify)    │
   └───────────┬──────────────────────────────────────┘
               ↓ reads
   ┌──────────────────────────────────────────────────┐
   │  Supabase — Postgres + Storage + Auth (Mumbai)    │
   └───────────↑──────────────────────────────────────┘
               │ writes
   ┌──────────────────────────────────────────────────┐
   │  Python scripts (GitHub Actions, Mon–Fri 12 UTC)  │
   └───────────↑──────────────────────────────────────┘
               │ pulls
   ┌──────────────────────────────────────────────────┐
   │  NSE bhav copy + BSE + IndianAPI + Yahoo VIX      │
   └──────────────────────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 19 + Vite 8 | Fast HMR, small bundles, Suspense for route-level code splitting |
| Hosting | Netlify | SPA redirects + serverless functions + edge functions in one config |
| Database | Supabase (Postgres) | SQL for complex Weinstein stage queries, materialized views, RLS |
| Auth | Supabase Auth | Built-in invite flow via `inviteUserByEmail`, JWT sessions |
| Storage | Supabase Storage | Academy lesson images, certificate assets |
| Scripts | Python 3.11 | pandas/numpy ergonomics for OHLCV + indicators |
| CI/CD | GitHub Actions | Free for public/scheduled jobs, 90-min job budget covers the full pipeline |
| Email | Resend | Transactional sends for waitlist invites — plugged into Supabase Auth as the custom SMTP provider, so `inviteUserByEmail` calls relay through Resend |
| Charts | TradingView Lightweight Charts + Recharts | Lightweight Charts for stock detail, Recharts for Academy |
| Translation | Gemini 2.5 Flash | Strong Indic-script support (hi/ml/ta), cheap at scale, style prompts work |
| Icons | Tabler Icons (webfont) | One subset font, consistent line weight |

---

## Repository structure

```
pinex/
├── src/
│   ├── pages/                       # React pages (one per route)
│   │   ├── Home.jsx                 # Main screener homepage
│   │   ├── StockDetail.jsx          # Individual stock page
│   │   ├── Academy.jsx              # PineX Academy LMS (replaces /learn)
│   │   ├── ModuleLesson.jsx         # Lesson reader + quiz
│   │   ├── Certificate.jsx          # Shareable completion cert
│   │   ├── Landing.jsx              # Public landing + waitlist
│   │   ├── Welcome.jsx              # Post-invite first-run
│   │   ├── InviteAccept.jsx         # /invite/:code redemption
│   │   ├── Dashboard.jsx            # User profile + settings
│   │   ├── Heatmap.jsx              # Sector treemap (D3)
│   │   ├── Screener.jsx             # Saved filters (work-in-progress)
│   │   ├── SectorDetail.jsx         # Per-sector breakdown
│   │   ├── TosAcceptance.jsx        # First-login ToS gate
│   │   └── admin/                   # Admin-only pages
│   ├── components/                  # Reusable UI components
│   │   ├── academy/                 # StageChart + academy-specific UI
│   │   ├── AcademyGate.jsx          # Route wrapper blocking /screener
│   │   ├── BottomNav.jsx            # Mobile tab bar
│   │   ├── DesktopSidebar.jsx       # Desktop nav
│   │   ├── StockChart.jsx           # Lightweight Charts integration
│   │   ├── StagePill.jsx            # Stage 1/2/3/4 badge
│   │   └── ui/                      # Toast, Modal, Skeleton primitives
│   ├── lib/                         # supabase client + appNav helpers
│   ├── hooks/                       # useAcademy + custom hooks
│   ├── context/                     # AuthProvider + useAuth
│   └── styles/                      # Theme tokens (CSS vars)
├── scripts/                         # Python data pipeline
│   ├── fetch_bhav_daily.py          # ★ Core: NSE EOD bhav copy → price_data
│   ├── calc_delivery_signals.py     # ★ Core: SwingX criteria + delivery
│   ├── calc_market_internals.py     # Breadth, VIX, stage counts
│   ├── fetch_nifty_sectors.py       # Sector index performance
│   ├── fetch_indianapi.py           # News + financials (tier 1 Nifty 50)
│   ├── fetch_bse_announcements.py   # BSE result calendar
│   ├── substage.py                  # Stage 2 A+/A-/B+/B- substages
│   ├── update_sectors.py            # Roll up companies → sectors
│   ├── sheets_signal_tracker.py     # SwingX → Google Sheets archive
│   ├── telegram_broadcast.py        # Daily channel message
│   ├── db.py                        # Supabase pagination helpers
│   └── academy/                     # Academy content tooling
│       ├── generate_academy_module.py   # ★ Translate + upload + insert
│       ├── content/                 # Module JSON files (English source)
│       └── images/                  # Lesson chart images (PNG/JPG)
├── netlify/
│   ├── functions/                   # Serverless functions
│   │   ├── invite-user.js           # Admin → user invite (Supabase Auth)
│   │   ├── accept-invite.js         # User-to-user invite redemption
│   │   ├── admin-*.js               # Admin panel write paths
│   │   └── generate-pdf.js          # PDF rendering for reports
│   └── edge-functions/
│       └── stock-meta.js            # Per-stock OG tags at the edge
└── .github/
    └── workflows/
        └── daily.yml                # Mon–Fri 12 UTC pipeline
```

---

## Database (Supabase)

### Key tables

| Table | Purpose | Updated by |
|---|---|---|
| `companies` | 2,125 NSE stocks master list | Manual / bhav |
| `price_data` | EOD OHLCV + indicators (MA30W, RSI, OBV, RS, 52W high/low) | `fetch_bhav_daily.py` |
| `delivery_data` | Daily delivery % (NSE/BSE) | `fetch_bhav_daily.py` |
| `delivery_signals` | SwingX, accumulation, distribution, breakout flags | `calc_delivery_signals.py` |
| `swingx_entries` | Active SwingX stocks (entry/exit/warning state) | `calc_delivery_signals.py` |
| `market_internals` | Breadth %, VIX, stage distribution per day | `calc_market_internals.py` |
| `nifty_sectors` | 18 Nifty sector indices history | `fetch_nifty_sectors.py` |
| `profiles` | User accounts, role, plan, academy state | Supabase Auth |
| `waitlist` | Public access requests | Landing page form |
| `invites` | User-to-user invite credits + codes | `accept-invite.js` |
| `academy_modules` | Learning modules (multi-language titles) | `generate_academy_module.py` |
| `academy_lessons` | Lesson content (en/hi/ml/ta + images) | `generate_academy_module.py` |
| `academy_questions` | Quiz questions (en/hi/ml/ta) | `generate_academy_module.py` |
| `user_module_progress` | Per-user quiz attempts + best score | Frontend |

### Materialized view

**`mv_home_stocks`** — pre-joined view combining `price_data` + `companies` for the homepage. Refreshed at the end of every daily pipeline run.

> Reduces homepage load from ~1,800 ms to ~16 ms.

```sql
-- Manual refresh
SELECT refresh_home_stocks();
```

> **⚠ When adding/removing columns:** rebuilding a materialized view requires
> `DROP MATERIALIZED VIEW mv_home_stocks CASCADE` + `CREATE MATERIALIZED VIEW`,
> and CREATE does NOT inherit the old grants. The screener will silently go
> empty for anon/authenticated. `refresh_home_stocks()` re-asserts the grants
> on every call (see `scripts/sql/harden_mv_home_stocks_grants.sql`), so just
> call it once after the rebuild — or run the GRANT explicitly:
> `GRANT SELECT ON mv_home_stocks TO anon, authenticated, service_role;`

---

## Daily pipeline

Runs Mon–Fri at **12:00 UTC (5:30 PM IST)** via GitHub Actions ([.github/workflows/daily.yml](.github/workflows/daily.yml)).

| Step | Script | What it does | Time |
|---|---|---|---|
| 1 | `fetch_bhav_daily.py` | Downloads NSE bhav copy ZIP, parses OHLCV, calculates MA/RSI/OBV/RS/52W high–low, upserts to `price_data` | ~8 min |
| 2 | `fetch_bse_announcements.py` | BSE result calendar + corporate actions | ~1 min |
| 3 | `fetch_indianapi.py --tier=1 --news-only` | Nifty 50 news (50 API calls) | ~2 min |
| 4 | `calc_delivery_signals.py --full` | SwingX criteria, delivery signals, view refresh | ~5 min |
| 5 | `substage.py` | Stage 2 A+/A-/B+/B- substage classification | ~3 min |
| 6 | `calc_market_internals.py` | Breadth %, VIX, stage distribution | ~3 min |
| 7 | `fetch_nifty_sectors.py` + `update_sectors.py` | 18 Nifty sector indices via NSE API | ~2 min |
| 8 | `sheets_signal_tracker.py` | SwingX export to Google Sheets archive | ~1 min |
| 9 | `telegram_broadcast.py daily` | Daily market summary message | ~30 s |

Total: **~25–35 minutes**. Each step uses `continue-on-error: true` so a single flaky step doesn't poison the rest of the run.

---

## SwingX — how it works

SwingX surfaces stocks where **all** Weinstein Stage 2 criteria align with Indian-specific delivery confirmation.

A stock enters SwingX when **ALL** of:

```
✓ Stage 2                 (price above rising 30W MA)
✓ RS vs Nifty positive    (outperforming the index)
✓ Volume ratio ≥ 1.3×     (or 7-day average)
✓ Price within 0–20%      (above the 30W MA)
✓ Sector ≥ 60% Stage 2    (sector strength filter)
✓ Industry ≥ 40% Stage 2  (industry strength filter)
```

States:

| State | Meaning |
|---|---|
| `ACTIVE` | All criteria met — appears in SwingX list |
| `WARNING` | Price dropped below 50D MA — flagged amber |
| `EXITED` | Price dropped below 30W MA — removed from list |

Key tables: `swingx_entries` tracks entry/exit/warning over time. `delivery_signals.high_conviction` is **derived** from `swingx_entries.is_active` (not recomputed daily) so the SwingX list stays stable across small volume fluctuations.

---

## PineX Academy

Multilingual learning management system. **8 modules** covering Weinstein Stage Analysis. Languages: **English, Hindi, Malayalam, Tamil.**

### Adding or editing module content

1. **Edit or create a JSON file** in `scripts/academy/content/` (see `module1_core_foundation.json` for the schema).
2. **Add chart images** to `scripts/academy/images/`. Filenames must match `visual_image_filename` in the JSON.
3. **Run the generator:**

   ```bash
   cd scripts/academy
   python generate_academy_module.py --module module1_core_foundation
   # or rebuild all modules
   python generate_academy_module.py --all
   ```

   The script:
   - Translates content via **Gemini 2.5 Flash** (per-language style prompts)
   - Uploads images to Supabase Storage bucket `academy`
   - Inserts lessons + quiz questions in all 4 languages
   - Idempotent — re-runs upsert cleanly

4. **Fine-tune translations** in the admin panel at `pinex.in/admin/academy`.

### Module content JSON format

See `scripts/academy/content/module1_core_foundation.json` for a complete annotated example covering lessons (with `visual_type`, `visual_chart_type`, `visual_image_filename`, `visual_caption`) and quiz questions (with `options[]`, `correct`, `explanation`).

---

## Access system

PineX is **private beta — members only**.

**New users — Option A: waitlist**
- Apply at [pinex.in](https://pinex.in)
- Admin approves at `/admin/waitlist`
- Invite email sent via Supabase Auth (`inviteUserByEmail`)

**New users — Option B: invited by existing member**
- Every user gets **3 invite credits**
- Share `pinex.in/invite/YOUR_CODE`
- Friend joins instantly — no waitlist

**On first login:**
1. Terms of Service acceptance screen
2. Academy prompt (unless grandfathered)
3. Pass Module 1 quiz to unlock the screener

The existing 71 users are **grandfathered** — full access plus a soft prompt encouraging Academy completion.

---

## Environment variables

### Netlify (build + functions)

| Variable | Used by | Where to get it |
|---|---|---|
| `SUPABASE_URL` | Frontend + functions | Supabase → Settings → API |
| `VITE_SUPABASE_URL` | Frontend build | Same |
| `VITE_SUPABASE_ANON_KEY` | Frontend build | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | Netlify functions only | Supabase → Settings → API (service_role) |
| `SITE_URL` | Invite redirect URL | `https://pinex.in` |

### GitHub Actions (scripts)

| Variable | Used by | Where to get it |
|---|---|---|
| `SUPABASE_URL` | All scripts | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | All scripts | Supabase → Settings → API |
| `INDIANAPI_KEY` | `fetch_indianapi.py` | stock.indianapi.in dashboard |
| `TELEGRAM_BOT_TOKEN` | `telegram_broadcast.py` | @BotFather on Telegram |
| `TELEGRAM_CHANNEL_ID` | `telegram_broadcast.py` | Your Telegram channel |
| `GEMINI_API_KEY` | `generate_academy_module.py` | Google AI Studio |
| `SHEETS_SPREADSHEET_ID` | `sheets_signal_tracker.py` | Google Sheets URL |
| `SHEETS_SERVICE_ACCOUNT_JSON` | `sheets_signal_tracker.py` | Google Cloud Console (base64) |

---

## Local development

```bash
# 1. Clone and install
git clone https://github.com/robin22y/pinex
cd pinex
npm install

# 2. Create .env.local — copy the URL + anon key
#    from Supabase → Project Settings → API
cat > .env.local <<'EOF'
VITE_SUPABASE_URL=<your-project-url>
VITE_SUPABASE_ANON_KEY=<your-anon-key>
EOF

# 3. Run frontend
npm run dev
# → http://localhost:5173

# 4. Dev bypass (skip auth for testing)
# In .env.local add:
#   VITE_DEV_BYPASS=true
# Restart `npm run dev`. AuthContext substitutes a DEV_USER.
```

For Netlify functions locally:

```bash
npm install -g netlify-cli
netlify dev
# → http://localhost:8888
```

For Python scripts:

```bash
cd scripts
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt

# Copy .env.example to .env, fill in your keys
python fetch_bhav_daily.py
```

---

## Key decisions and why

| Decision | Why |
|---|---|
| Weekly chart + 30W SMA | Weinstein methodology — filters noise, reveals the major trend |
| Supabase over Firebase | Postgres SQL for complex stage queries, row-level security, built-in auth |
| Netlify over Vercel | Edge functions + standard functions + SPA redirects in a single `netlify.toml` |
| NSE bhav copy (not Yahoo) | Official source, free, reliable. Yahoo Finance is used **only** for VIX |
| Materialized view for homepage | 2,125 stocks × joins = slow. `mv_home_stocks` pre-computes everything |
| Delivery % tracking | Indian-market specific — delivery vs intraday split is a signal Western markets don't expose |
| `high_conviction` derived from `swingx_entries` | Keeps the SwingX list stable; only changes when stage criteria change, not on daily volume noise |
| Gemini for translations | 2.5 Flash handles Indic scripts (hi/ml/ta) well, cheap at scale, style prompts work |
| Lightweight Charts for stock detail | 35 kB, native-feeling pan/zoom, TradingView consistency |
| Recharts for Academy | React-first, declarative reference areas/dots — ideal for teaching diagrams |

---

## Deployment

- **Frontend:** push to `main` → Netlify auto-deploys (vite build, ~6s)
- **Scripts:** push to `main` → GitHub Actions next scheduled run at 12:00 UTC

Manual triggers:
- GitHub → Actions → **Daily Market Data Update** → **Run workflow**
- Or run individual scripts locally from `scripts/`

---

## Supabase project

- **Project URL + ID:** see `SUPABASE_URL` in Netlify env vars or the Supabase dashboard
- **Plan:** Small ($25 / month)
- **Region:** `ap-south-1` (Mumbai)
- **Admin:** robin22y@gmail.com

---

## SEBI compliance notes

PineX is an **educational platform**, not a SEBI-registered investment advisor.

All user-facing text must:
- ✓ Say "educational purposes only"
- ✗ **Never** use: *buy, sell, recommend, target price, upside potential*
- ✓ Use: *criteria met, technical filter, educational metric only*
- ✓ Show the disclaimer on every page

**SwingX sub-label:** "Technical criteria filter" — NOT "Buy signals" or "Top picks"

**RS tooltip:** "Educational metric only. Not investment advice."

---

## Pending tasks (as of May 2026)

- [ ] `calc_delivery_signals.py --backfill --days=90`
- [ ] `calc_signal_outcomes.py` after backfill
- [ ] Pro features + Razorpay (₹499 / month)
- [ ] Stage change email alerts
- [ ] Screener page (`/screener`) with saved filters
- [ ] Academy modules 2–8 chart images upload
- [ ] "Most Watched" widget on homepage

---

## Adding complex code — helper comments

When writing complex logic, follow this pattern so any human reading the code later can understand it immediately.

**Python example:**

```python
# ─────────────────────────────────────────
# WHY: Supabase has a 1000-row limit per
# query. We paginate in batches of 1000
# to fetch all 2125 stocks.
# ─────────────────────────────────────────
def fetch_all_companies():
    all_rows = []
    page = 0
    while True:
        batch = (
            supabase.table('companies')
            .select('*')
            .range(page * 1000, page * 1000 + 999)
            .execute()
        )
        all_rows.extend(batch.data)
        if len(batch.data) < 1000:
            break
        page += 1
    return all_rows
```

**React example:**

```jsx
// WHY: SearchBar is defined OUTSIDE Home
// to prevent React re-mounting it on every
// keystroke (which loses focus). If defined
// inside Home, it gets recreated on every
// state change.
function SearchBar({ allStocks }) { /* ... */ }
```

**SQL example:**

```sql
-- WHY: We use a materialized view instead
-- of a regular view because joining
-- price_data + companies for 2125 stocks
-- on every page load took 1800ms. The
-- materialized view pre-computes this and
-- refreshes at the end of each daily run.
-- Refresh: SELECT refresh_home_stocks();
CREATE MATERIALIZED VIEW mv_home_stocks AS ...
```

**General rule:** every function/query that is not obviously self-explanatory gets a WHY comment above it.

Format:

```
# WHY: [one sentence explaining the
#       non-obvious reason]
```
