# PineX

Stage Analysis for the Indian stock market — 2,125 NSE stocks, daily delivery + breadth signals, BYO-Key Research Assistant, natural-language screener, multilingual learning.

[**Live: pinex.in**](https://pinex.in) · React 19 · Vite · Supabase · Netlify · Python 3.11 · GitHub Actions

_Last refresh: 2026-06-10_

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
| Research Assistant | Gemini 2.5 Flash (BYO-Key) | User pastes their own AI Studio key; calls go browser→Google directly. PineX never sees the key, question, or answer |
| Fundamentals | IndianAPI + yfinance | IndianAPI for the 15-field paid set, yfinance for 9 extra fields + quarterly history. yfinance runs last so it wins overlapping columns |
| Icons | Tabler Icons (webfont) + lucide-react | One subset font for marketing/Academy, lucide for the app shell |

---

## Repository structure

```
pinex/
├── src/
│   ├── pages/                       # React pages (one per route)
│   │   ├── Home.jsx                 # Main screener homepage (Search / Sectors / Screens / Watched tabs)
│   │   ├── Lab.jsx                  # User-run screener + "Talk to The Lab" NL input (BYO-Key)
│   │   ├── BreadthLab.jsx           # Market internals + breadth experiments
│   │   ├── StockDetail.jsx          # Individual stock page (Research Assistant + Phase Insight + Similar Stocks + Criteria chart)
│   │   ├── Academy.jsx              # PineX Academy LMS
│   │   ├── ModuleLesson.jsx         # Lesson reader + quiz
│   │   ├── Learn.jsx                # Static learning sections (legacy, kept beside Academy)
│   │   ├── Certificate.jsx          # Shareable completion cert
│   │   ├── Methodology.jsx          # Public methodology doc
│   │   ├── Landing.jsx              # Public landing + waitlist
│   │   ├── Welcome.jsx              # Post-invite first-run
│   │   ├── InviteAccept.jsx         # /invite/:code redemption
│   │   ├── Account.jsx              # User account settings + Gemini key paste flow
│   │   ├── Dashboard.jsx            # Watchlist + Phase Age + Watchlist Health
│   │   ├── Portfolio.jsx            # User holdings classification
│   │   ├── ResearchNotes.jsx        # Saved Research Assistant responses
│   │   ├── Rewards.jsx              # Points + streaks
│   │   ├── Heatmap.jsx              # Sector treemap
│   │   ├── SectorDetail.jsx         # Per-sector breakdown
│   │   ├── SectorRotation.jsx       # Sector cycle map
│   │   ├── RiskManagement.jsx       # Position-size + risk learning
│   │   ├── WhenToSell.jsx           # Exit-rules learning
│   │   ├── Pricing.jsx              # Pricing + Pro tier explainer
│   │   ├── TosAcceptance.jsx        # First-login ToS gate
│   │   ├── Privacy.jsx              # Privacy policy
│   │   ├── Terms.jsx                # Terms of service
│   │   ├── Login.jsx / Register.jsx / Join.jsx / ForgotPassword.jsx / ResetPassword.jsx
│   │   ├── Unsubscribe.jsx          # Email opt-out landing
│   │   ├── StockDetailLegacy.jsx    # Pre-2026 stock page (kept for direct deep-links)
│   │   └── admin/                   # Admin-only pages (users / engagement / telegram / academy / etc)
│   ├── components/                  # Reusable UI components
│   │   ├── academy/                 # StageChart + academy-specific UI
│   │   ├── home/                    # Engine table + delivery sections
│   │   ├── stock/                   # StockDetail column rails + chart column
│   │   ├── ResearchAssistant.jsx    # BYO-Key Gemini panel — 7 categories + streaming + translations
│   │   ├── CriteriaChart.jsx        # 60-day SwingX score line (Recharts, lazy)
│   │   ├── SimilarStocks.jsx        # Same-stage peers (sector-preferred, lazy)
│   │   ├── SwingConditions.jsx      # 5-criteria row with redesigned chips
│   │   ├── DailyChecklist.jsx       # Six self-checks on Home Screens tab
│   │   ├── WatchlistSummary.jsx     # Dashboard health card
│   │   ├── ProBadge.jsx             # PRO chip used across the app
│   │   ├── BottomNav.jsx            # Mobile tab bar (Home / Sectors / Lab / Learn / Profile)
│   │   ├── StagePill.jsx            # Stage 1/2/3/4 badge
│   │   ├── StockShareCard.jsx       # html2canvas-rendered share image
│   │   └── ui/                      # Toast, Modal, Skeleton, SectionLabel primitives
│   ├── lib/                         # supabase + appNav + researchAssistant (askGemini, key storage)
│   ├── hooks/                       # useAcademy, usePlan + custom hooks
│   ├── context/                     # AuthProvider + useAuth
│   └── styles/                      # Theme tokens (CSS vars)
├── scripts/                         # Python data pipeline
│   ├── fetch_bhav_daily.py          # ★ Core: NSE EOD bhav copy → price_data
│   ├── calc_delivery_signals.py     # ★ Core: SwingX criteria + delivery
│   ├── calc_swing_conditions.py     # 5-criteria SwingX boolean row per stock per day
│   ├── calc_market_internals.py     # Breadth, VIX, stage counts
│   ├── calc_streaks.py              # Daily login points + streak tracking
│   ├── compute_mansfield_rs.py      # Mansfield-style RS history pane
│   ├── fetch_nifty_sectors.py       # Sector index performance
│   ├── fetch_market_cap.py          # Market cap refresh from IndianAPI
│   ├── fetch_indianapi.py           # News + financials (Nifty 500)
│   ├── fetch_fundamentals.py        # ★ IndianAPI key_metrics (15 fields, paid)
│   ├── fetch_fundamentals_yf.py     # ★ yfinance fundamentals — wider 24-field set + quarterly_financials_yf table
│   ├── fetch_company_overview.py    # IndianAPI company profile → company_overview table
│   ├── fetch_bse_announcements.py   # BSE result calendar
│   ├── substage.py                  # Stage 2 A+/A-/B+/B- substages
│   ├── update_sectors.py            # Roll up companies → sectors
│   ├── classify_sectors_gemini.py   # LLM-assisted sector cleanup
│   ├── generate_ai_content.py       # Weekly per-stock narrative regeneration (Gemini)
│   ├── generate_descriptions_gemini.py / generate_telegram_broadcast.py / generate_morning_briefs.py
│   ├── sheets_signal_tracker.py     # SwingX → Google Sheets archive
│   ├── telegram_broadcast.py        # Channel message
│   ├── db.py                        # Supabase pagination + log_event helpers
│   ├── symbols.py                   # Static seed list (kept; fetchers paginate companies table)
│   ├── sql/                         # Idempotent migration files
│   ├── migrations/                  # Versioned schema bumps (extend_key_metrics_yf.sql, etc.)
│   └── academy/                     # Academy content tooling
│       ├── generate_academy_module.py   # ★ Translate + upload + insert
│       ├── content/                 # Module JSON files (English source)
│       └── images/                  # Lesson chart images (PNG/JPG)
├── netlify/
│   ├── functions/                   # Serverless functions
│   │   ├── invite-user.js           # Admin → user invite (Supabase Auth)
│   │   ├── accept-invite.js         # User-to-user invite redemption
│   │   ├── admin-send-email.js / send-bulk-email-background.js   # Resend admin sends (background fn for bulk)
│   │   ├── admin-*.js               # Admin panel write paths
│   │   └── generate-pdf.js / generate-description-*.js
│   └── edge-functions/
│       └── stock-meta.js            # Per-stock OG tags at the edge (bot-only fast path; real users pass through)
└── .github/
    └── workflows/
        ├── daily.yml                # Mon–Fri 12 UTC pipeline
        └── weekly.yml               # Sunday 06 UTC — AI narrative + fundamentals regen
```

---

## Database (Supabase)

### Key tables

| Table | Purpose | Updated by |
|---|---|---|
| `companies` | 2,125 NSE stocks master list | Manual / bhav |
| `price_data` | EOD OHLCV + indicators (MA30W, RSI, OBV, RS, 52W high/low, `rs_vs_nifty`) | `fetch_bhav_daily.py`, `compute_mansfield_rs.py` |
| `delivery_data` | Daily delivery % (NSE/BSE) | `fetch_bhav_daily.py` |
| `delivery_signals` | SwingX, accumulation, distribution, breakout flags | `calc_delivery_signals.py` |
| `swingx_entries` | Active SwingX stocks (entry/exit/warning state) | `calc_delivery_signals.py` |
| `swing_conditions` | 5-criteria boolean row per stock per day (drives the SwingX score 0–5) | `calc_swing_conditions.py` |
| `market_internals` | Breadth %, VIX, stage distribution per day | `calc_market_internals.py` |
| `nifty_sectors` | 18 Nifty sector indices history | `fetch_nifty_sectors.py` |
| `stock_descriptions` | Per-stock cycle narrative + Malayalam line + accordion copy (Gemini-authored, weekly) | `generate_ai_content.py` |
| `key_metrics` | Per-stock fundamentals (PE/PB/DE/ROE/margins/growth/52W/etc — 24 fields combined) | `fetch_fundamentals.py` (IndianAPI) + `fetch_fundamentals_yf.py` (yfinance, runs last to win overlaps) |
| `quarterly_financials_yf` | Last 4 quarters (Revenue/Net Income/Operating Income/EBITDA) per stock | `fetch_fundamentals_yf.py` |
| `company_overview` | Stored profile (about / business model / products / founding / HQ / employees) | `fetch_company_overview.py` |
| `criteria_changes` | One row per (symbol, trading_date) when a SwingX criterion flipped | `calc_swing_conditions.py` |
| `criteria_history` | 60-day swing_conditions history feed (drives the CriteriaChart) | `calc_swing_conditions.py` |
| `research_notes` | User-saved Research Assistant responses (RLS-scoped, opt-in) | Frontend Save button |
| `usage_events` | Audit log — Research Assistant calls, admin bulk emails, registration funnel events. **Never logs question / answer / API key text** | Frontend + Netlify functions |
| `user_points` / `user_streaks` / `points_log` | Reward system | `calc_streaks.py`, frontend |
| `mv_home_stocks` (matview) | Pre-joined homepage view — see below | `fetch_bhav_daily.py` refresh |
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

## Weekly pipeline

Runs Sunday at **06:00 UTC (11:30 AM IST)** via [.github/workflows/weekly.yml](.github/workflows/weekly.yml).

| Step | Script | What it does | Time |
|---|---|---|---|
| 1 | `fetch_market_cap.py` | Refresh market cap + cap_category via IndianAPI (~18 min) | ~18 min |
| 2 | `fetch_indianapi.py --tier=2 --news-only` | Tier-2 (Nifty 500) news refresh | ~12 min |
| 3 | `generate_ai_content.py --full` | Regenerate every stock's cycle narrative + Malayalam line via Gemini | ~25–40 min |
| 4 | `telegram_broadcast.py channel` | Weekly market broadcast to the public channel | < 1 min |
| 5 | `fetch_fundamentals.py` | IndianAPI key_metrics (15-field set, 0.2 s pacing) | ~10 min |
| 6 | `fetch_company_overview.py` | IndianAPI company_overview with 30-day freshness gate | ~10 min |
| 7 | `fetch_fundamentals_yf.py` | yfinance fundamentals (24 fields + quarterly_financials_yf). Yahoo-friendly 2 s pacing + 30 s cool-down every 50 symbols → ~3.7 h for ~2,100 symbols. Runs LAST so yf wins on overlapping key_metrics columns | ~3.7 h |

Job timeout: **6 h** (set on the workflow). The yfinance step has its own **4 h** timeout. yfinance is paced conservatively because Yahoo doesn't publish rate limits — getting flagged is a real risk.

---

## Research Assistant (BYO-Key Gemini)

The 7-tile menu on every stock detail page lets the user ask AI about that specific stock. **PineX never sees the question, never sees the answer, never sees the key.**

| Property | Value |
|---|---|
| Model | `gemini-2.5-flash` (configurable via `ai_config` table) |
| Auth | Bring-Your-Own-Key — user pastes their AI Studio key into Settings, it stays in `localStorage` only |
| Transport | Browser → `generativelanguage.googleapis.com` directly. PineX has no proxy |
| Streaming | `streamGenerateContent?alt=sse` — tokens render word-by-word |
| Thinking | Disabled by default (`thinkingBudget: 0`) — keeps the full output budget for visible prose, kills the silent MAX_TOKENS-mid-sentence bug |
| Logging | `usage_events` rows contain token counts + finish reason + latency. **Question text + answer text are NEVER logged.** Same applies to translations |
| Categories | Company Overview · Valuation · Growth & Momentum · Quarterly Results · Shareholding · Cycle Position Deep Dive · Trading Framework · Ask Anything · Compare With Another Stock |
| Languages | Translation pills below every answer — English (original), Malayalam, Hindi, Tamil (translation runs a fresh Gemini call) |
| Safety | Local block list refuses `buy / sell / should i / invest / recommend / target / stop loss / entry / exit` before the request fires; SAFETY-blocked responses surface a "try rephrasing" message; every answer ends with the SEBI line |

Data flow per category — Gemini is given facts UP FRONT (PineX fetches the relevant rows from Supabase, builds a data-rich prompt INCLUDING the values, then asks Gemini to EXPLAIN them in plain English). Gemini is never asked to fetch or recall.

---

## PineX Lab

User-run screener at `/lab` (bottom-nav center flask icon). Pure mathematical screening — PineX outputs the result of the user's own query against pre-calculated EOD data; it does NOT suggest stocks.

- **Templates**: Trend Convergence · Base Formation · Trend Deterioration · SwingX · RS Momentum · Stage 1 / 2 / 3 / 4 · Build Your Own (PRO)
- **Talk to The Lab**: BYO-Key natural-language input — describe what you want in plain English ("IT stocks in Advancing phase with 4+ criteria this week") → Gemini translates to a JSON filter spec → PineX picks the right template + crit-state and runs it client-side
- **Saved screens**: local-first (every device, every guest) with optional Supabase sync for logged-in users
- **Export**: Excel export of the current sorted/filtered view

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

## Pending tasks (as of June 2026)

- [ ] `calc_delivery_signals.py --backfill --days=90`
- [ ] `calc_signal_outcomes.py` after backfill
- [ ] Razorpay billing wiring (Pro tier is currently `OPEN_FREE=true` — everyone gets Pro)
- [ ] Stage change email alerts
- [ ] Academy modules 2–8 chart images upload
- [ ] "Most Watched" widget on homepage
- [ ] Follow-up streaming in Research Assistant (initial answer + compare + translate already stream)
- [ ] Lint sweep — repo has ~2.6 k mostly-stylistic ESLint v10 errors (`react-refresh/only-export-components`, `react-hooks/purity` Date.now-in-render warnings). Project-wide cleanup, not blocking
- [ ] Empty out the historical `debug_*.py` / `check_*.py` one-shot scripts (~30 files) once their findings are codified

### Recently shipped (May–June 2026)

- ✅ Research Assistant (BYO-Key Gemini) — 7 categories + streaming + translation pills + research_notes save
- ✅ Lab — user-run screener + "Talk to The Lab" NL input + saved screens
- ✅ Fundamentals pipeline — `fetch_fundamentals.py` (IndianAPI) + `fetch_fundamentals_yf.py` (yfinance) + `fetch_company_overview.py`
- ✅ Mansfield RS history pane (`compute_mansfield_rs.py`)
- ✅ Phase Duration Insight on StockDetail
- ✅ Similar Stocks engine
- ✅ Criteria Evolution Chart
- ✅ Daily login points + streak tracking (`calc_streaks.py`)
- ✅ Daily Checklist on Home Screens tab
- ✅ Watchlist Health summary
- ✅ Edge-function bot-only gate + Supabase preconnect + lazy-loaded CriteriaChart/SimilarStocks + index.html loading shell — cold-mobile first paint cut by ~30 %
- ✅ Bulk admin email via Netlify background functions (Resend 2 req/s respected)
- ✅ My Classification component + Supabase table

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
