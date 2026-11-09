# PineX Company Studies — Phase 1 Audit

Date: 2026-11-08 · Scope: read-only inspection of `C:\Users\robin\Desktop\stockiq` (repo `robin22y/pinex`).
No code, migrations or config were changed. The only file written is this report.

> **How the database was inspected.** The project rule is that production Supabase is never queried by Claude.
> The table inventory below comes from the SQL files in `scripts/sql/` and `scripts/migrations/` plus every
> `.from('…')` / `.table("…")` call in the code. Before Phase 2, run this in the Supabase SQL editor
> and paste back the output to confirm it:
>
> ```sql
> select table_name, string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
> from information_schema.columns where table_schema = 'public' group by table_name order by table_name;
>
> select tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename;
> ```

---

## 1. CURRENT ARCHITECTURE

### Frontend
| Area | Location | Notes |
|---|---|---|
| Build | `package.json` | `vite build && node scripts/prerender_pulse.mjs`. React 19, react-router-dom 7 (`createBrowserRouter`), Tailwind 4, Vite 8 (rolldown) with terser. |
| Vite config | `vite.config.js` | Manual chunks (`vendor-react`, `vendor-supabase`, `vendor-charts`, `vendor-motion`, `vendor-i18n`, `vendor-fuse`). VitePWA `generateSW` with `navigateFallbackDenylist: [/^\/quickscanner/]` and `globIgnores` for quickscanner. A dev middleware maps `/quickscanner` to `/quickscanner.html`. |
| Netlify | `netlify.toml` | Publishes `dist`. Functions in `netlify/functions`, one edge function `stock-meta` on `/stock/*` (injects OG meta). `/quickscanner` → `/quickscanner.html` rewrite placed **above** the SPA catch-all `/* → /index.html`. `*.html` served `no-cache, no-store`. |
| Netlify functions | `netlify/functions/*.js` (22) | `admin-*` functions (add company, fetch financials/results/price, send email/telegram, trigger EOD…), `generate-pdf.js` (stock PDF, `@react-pdf/renderer`, Helvetica), `claude.js`, invite/email helpers. |
| Supabase edge functions | `supabase/functions/` | `fetch-stock-info`, `iqjet-brief`, `iqjet-telegram`, `iqjet-telegram-send`, `pattern-match`. |
| Router / layout | `src/App.jsx` | One `RootLayout` (AuthProvider, DesktopSidebar, BottomNav, Footer, DisclaimerStrip, FeedbackWidget, CookieBanner, TelegramSubscribePrompt). `/pulse`, `/iqjet`, `/search` suppress the shell. Every page is lazy except Pulse, AuthCallback and NotFound. |
| Gates | `src/components/AdminRoute.jsx`, `ProtectedRoute.jsx`, `PublicGate.jsx`, `AcademyGate.jsx` | See §1 Auth. |
| Shared UI | `src/components/ui/` | `Badge`, `Card`, `Modal`, `SectionLabel`, `Skeleton`, `Tooltip`, `Trend`, `Icon`, `ExplainButton`, `ProGateModal`. `src/components/states/` has `NoData`, `NotFound`, `DataWarning`. `src/components/layout/Footer.jsx`. `DefaultSeo.jsx` + `react-helmet-async`. |
| Design tokens | `src/theme.css` (340 lines), `src/index.css`, `src/App.css`, `src/styles/tokens.js`, `tailwind.config.js` | Dark default (`--bg-primary #0B0E11`, `--accent #00C805`), alternative `[data-theme="sepia"]` paper theme. `tokens.js` maps `C.*` to the CSS variables. Fonts: DM Sans (UI), **Newsreader** serif (already loaded in `index.html`), Noto Sans Malayalam loaded on demand. |
| Prerender precedent | `scripts/prerender_pulse.mjs` | Runs **inside the Netlify build** after `vite build`. Reads Supabase with the anon key, injects `window.__PULSE_BOOTSTRAP__` into `dist/index.html`. Designed to never fail the build (exits 0 on every error). |

### Pipeline
| Item | Location | Notes |
|---|---|---|
| Daily | `.github/workflows/daily.yml` | Step 11 runs `scripts/generate_screener.py` → `static_build/quickscanner.html` + `screener.json`. Step 12 checks the size, copies into `public/`, **commits and pushes to main** (`chore(screener): daily rebuild …`). That push is what triggers the Netlify deploy; no build hook is used. |
| Old generator | `scripts/generate_static_quickscanner.py` | The CSS-only screener, replaced by `generate_screener.py` but still in the repo. |
| Other workflows | `quarterly.yml`, `weekly.yml`, `fetch-results.yml`, `results_monitor.yml`, `biannual-descriptions.yml`, `backfill_patterns.yml` | `quarterly.yml` (cron `0 6 1 2,5,8,11 *`) runs `fetch_indianapi.py --shareholding-only` / `--financials-only`, which write to `shareholding` / `financials` (see Risks). |
| DB helper | `scripts/db.py` | Service-role Supabase client for Python. |

### Auth / admin
- **Frontend admin gate:** `AdminRoute` → `isAdmin(user)` in `src/lib/isAdmin.js` is a **hard-coded email allowlist** (`robin22y@gmail.com`). In dev it also accepts a `VITE_ADMIN_LOCAL_PASSWORD` gate.
- **Parallel role model already exists:** `profiles.role` ∈ {`admin`,`superadmin`}. `useAuth()` exposes `isAdmin` from the role (`src/context/useAuth.js:45`). `DesktopSidebar`, `WYWAEmailAdmin` and `AdvancedGate` use the role.
- **DB side:** `public.is_admin()` is `SECURITY DEFINER STABLE` and checks `profiles.role` (`scripts/sql/fix_is_admin_recursion.sql`). `role` and `plan` are protected from self-escalation (`REVOKE UPDATE (plan, role) ON profiles FROM authenticated` plus a check policy in `security_protect_user_fields.sql`). `setup_admin_role_and_telegram_subscribers.sql` already moved some policies from email to role.
- **Still email-based:** the `company_studies` RLS (`auth.email() = 'robin22y@gmail.com'`), IQjet / IQjetDesk / IQjetAccessManager / Account, `appNav.js` (`admin_email` items), `admin-invite-waitlist.js` and `invite-user.js` (env `ADMIN_EMAIL` with an email fallback).
- **Verdict:** don't reuse the IQjet email pattern for Studies. Use `public.is_admin()` in RLS and `useAuth().isAdmin` (role) in the UI. Studies can wrap their routes in the existing `AdminRoute` (email check) **plus** the role check, so nothing else has to change. Moving `AdminRoute` itself over to the role is a separate cleanup.

### Bundle (production build, `vite build` to the scratchpad; the Pulse prerender was not run)
| Chunk | Raw | Gzip | Loaded |
|---|---|---|---|
| `index` (entry) | 211.8 KB | 62.8 KB | every page |
| `vendor-react` | 275.5 KB | 88.3 KB | every page |
| `vendor-supabase` | 202.1 KB | 50.6 KB | every page (modulepreload) |
| `vendor-charts` (recharts) | 423.7 KB | 118.6 KB | **modulepreloaded on every page** (for Pulse) |
| `vendor-motion` | 127.5 KB | 41.1 KB | modulepreload |
| `vendor-i18n` | 43.6 KB | 13.9 KB | modulepreload |
| `jspdf.es.min` | 403.5 KB | 129.2 KB | lazy (Company Study PDF) |
| `html2canvas` | 198.7 KB | 46.1 KB | lazy (PDF, share cards) |
| `pdf` (pdfjs) / `xlsx` | 408 / 418 KB | 122 / 140 KB | lazy |
| `CompanyStudy` / `CompanyStudies` | 14.9 KB | 5.5 KB | lazy |
| `AdminCompanyStudies` | 13.4 KB | 4.6 KB | lazy |
| CSS `index` | 21.3 KB | — | every page |

All assets: 4.7 MB. PWA precache: 123 entries, 4.05 MB. First paint of any SPA page needs about **375 KB gzip** of JS. Static study pages should ship **zero SPA JS**.

---

## 2. EXISTING COMPANY STUDIES

**Files**
- `src/pages/CompanyStudies.jsx`: index at `/learn/companies`. Reads `company_studies`, `companies`, and `price_data` (stage badge per card).
- `src/pages/CompanyStudy.jsx`: `/learn/company/:symbol`. Five fixed narrative sections, EN/ML/HI/TA tabs, YouTube "Listen" button, a **"Where they stand today" live card from `price_data`** (stage, RS vs Nifty, days in stage, volume ratio), and a Pro-only PDF download.
- `src/components/admin/CompanyStudiesAdmin.jsx` (639 lines), mounted at `/admin/company-studies` via `src/pages/admin/AdminCompanyStudies.jsx`. Lists, creates, edits and deletes studies, with a "Generate with Gemini" translation per language (BYOK key from `/account`, `askGemini` in `src/lib/researchAssistant.js`).
- SQL: `scripts/sql/create_company_studies.sql`, `scripts/sql/update_company_studies.sql`.

**Table `company_studies`** (one row per symbol, `symbol UNIQUE`)
`id uuid`, `symbol`, `what_they_do`, `how_they_make_money`, `who_built_it`, `similar_companies`, `what_to_watch`, `youtube_url`, `podcast_duration_seconds`, `published_at`, `updated_at`, `is_published bool`, plus `title_{ml,hi,ta}` and `<section>_{ml,hi,ta}` for all five sections (18 extra columns). Index `(is_published, published_at desc)`.
RLS: public `SELECT` where `is_published = true`; admin `ALL` via `auth.email()`.

**How the PDF actually works.** The brief describes it as "Noto fonts". That is only partly true:
- The PDF is **client-side**: `html2canvas` screenshots a hidden off-screen light-theme `div#company-study-printable`, and `jspdf` slices the image into A4 pages. The text is an **image**: it isn't selectable or searchable, and files are large.
- Indic text looks right only because the browser renders it. Noto Sans Malayalam is loaded from Google Fonts on demand (`index.html`). Hindi and Tamil rely on whatever system fonts the visitor has. No Noto font files are embedded anywhere.
- `netlify/functions/generate-pdf.js` (`@react-pdf/renderer`, Helvetica) is a **different** feature: the per-stock PDF. It reads `financials`/`shareholding` and is not used by Studies.

**Conflicts with the fixed decisions**
| Existing | Decision | Action |
|---|---|---|
| "Where they stand today" card + PDF block from `price_data` (stage, RS, vol ratio); index-page stage badge | #4 no price data, #8 don't touch `price_data` | Remove from study surfaces. (We stop reading it; the table itself is untouched.) |
| RLS admin policy via `auth.email()` | Proper role check | Replace with `public.is_admin()`. |
| Header comments say "Robin's Company Study series" | #6 byline "PineX Research" | Public UI shows no name today. Add the "PineX Research" byline and fix the comments. |
| Five fixed narrative columns × 4 languages | Structured study (products, TAM, risks, sources…) | Keep as the narrative layer and add child tables (§4). |
| Routes `/learn/company/:symbol`, `/learn/companies` | New `/company/:slug` | 301 the old URLs to the new ones. |

**Reusable**
- The `company_studies` table and its row identity (extend it, don't fork it). Decision #7.
- The admin page skeleton, language tabs, Gemini translation helper and EN-fallback logic (`getSectionText`).
- The localised section labels and footer disclaimers (`SECTION_LABELS`).
- The multilingual PDF *concept*. The html2canvas approach should become a print stylesheet on the static page (browser "Save as PDF" gives selectable text and embedded fonts at no bundle cost), or a server-side render with embedded Noto fonts in a later phase.

---

## 3. PROPOSED ARCHITECTURE

```
Admin (/admin/studies, SPA, is_admin)            Supabase
  edit study + child tables  ───────────────────► company_studies (+ study_* tables)
  "Preview" → client-side render (draft)           RLS: anon reads status='published' only
  "Publish" → POST /.netlify/functions/admin-publish-study
                │  verifies JWT + profiles.role via service key
                │  sets status='published', published_at, version++
                └► POST NETLIFY_BUILD_HOOK_URL  (env var, never in client)
                         │
Netlify build:  vite build  →  prerender_pulse.mjs  →  prerender_studies.mjs (NEW)
                                                        reads published studies (anon key)
                                                        writes dist/company/<slug>/index.html
                                                        writes dist/company/index.html (directory)
                                                        appends URLs to dist/sitemap.xml
```

Key points:
1. **Build inside Netlify, not via a git commit.** Follow the `prerender_pulse.mjs` pattern, not the quickscanner commit-to-`public/` pattern. Studies are content-driven, not schedule-driven, so a build hook fits. Nothing gets committed to the repo, and `daily.yml` is untouched. The daily screener commit triggers a deploy as a side effect, which simply re-renders the studies again (idempotent).
2. **Render with React on the server.** Use `react-dom/server` `renderToStaticMarkup` over shared presentational components in `src/components/study/` (Node ESM with an esbuild transform, or a small dedicated Vite SSR build). One component tree then serves both the admin draft preview and the static output, so they can't drift apart. Python string templates (as in `generate_screener.py`) would duplicate the markup.
3. **Serving.** Netlify serves real files before redirects. `dist/company/<slug>/index.html` is served at `/company/<slug>` without a rule, as long as nothing with `force = true` shadows it. Still add an explicit `/company/*` rule **above** the SPA catch-all that sends unknown slugs to a static 404, so they don't fall into the React shell.
4. **Service worker.** Add `/^\/company(\/|$)/` to `navigateFallbackDenylist` and `**/company/**` to `globIgnores`. Otherwise the PWA serves the SPA shell for study URLs: the same "works on hard refresh only" bug documented for quickscanner in `vite.config.js`.
5. **Static page contents:** inline critical CSS (editorial tokens, §6), system/Google font links, an optional ≤5 KB vanilla script (language toggle, table expand). No React, no supabase-js. JSON-LD `Article` with `author: {"@type":"Organization","name":"PineX Research"}`, canonical URL, OG tags, `dateModified` from `updated_at`.
6. **Failure mode:** `prerender_studies.mjs` must **not** exit 0 silently like the Pulse prerender. A publish whose page didn't render should fail visibly. Recommended: fail the build only if a study marked `published` renders to zero bytes, and otherwise warn. A failed Netlify build keeps the previous deploy live, which is safe.
7. **Debounce:** several publishes in a row each trigger a full build (~1–2 min plus build minutes). The function should skip the hook if one fired in the last N minutes, or offer a "publish without rebuild" option.
8. **Draft preview:** `/admin/studies/:id/preview` renders the same components client-side from draft rows. It is admin-only (RLS + route gate) and `noindex`.

---

## 4. DATABASE CHANGES

### Name clashes to avoid
| Name | Status | Why it matters |
|---|---|---|
| `financials`, `shareholding`, `quarterly_changes` | Dropped (per brief) but **still referenced** by 13 files: `ResearchAssistant.jsx`, `ResultsCalendar.jsx`, `Dashboard.jsx`, `Portfolio.jsx`, `SectorDetail.jsx`, `IQjetDesk.jsx`, `AdminStats.jsx`, `AdminStockEdit.jsx`, `detect_changes.py`, `fetch_indianapi.py`, `generate_ai_content.py`, `telegram_broadcast.py`, `update_sectors.py` | **Do not recreate tables with these names.** The old code would start reading and writing them with the old shape. |
| `quarterly_financials_yf`, `key_metrics`, `company_overview` | Exist (screener / stock page) | Don't reuse them for studies. Studies data is hand-verified and versioned. |
| `research_notes` | Exists (user AI notes) | Don't use "research" for study tables. |
| `products`, `sources`, `risks`, `developments` | Free, but generic | Prefix everything with `study_`. |
| `companies` | Core screener table (108 code refs, pipeline writes) | **Don't extend it.** Hang everything off `company_studies.company_id`. |

### Changes to `company_studies` (extend, don't duplicate)
```
+ company_id      bigint/uuid FK companies(id)        -- symbol stays for back-compat
+ slug            text UNIQUE NOT NULL                -- e.g. 'mahindra-and-mahindra' (M&M-safe)
+ status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','researching','reviewed','published','archived'))
+ headline, summary, title (EN)   text
+ byline          text NOT NULL DEFAULT 'PineX Research'  CHECK (byline = 'PineX Research')
+ reviewed_at, reviewed_by (uuid, never rendered publicly)
+ version         int NOT NULL DEFAULT 1
+ last_built_at   timestamptz
  is_published    kept; set by trigger from status = 'published' (keeps the old index page + RLS working during migration)
```
Narrative section columns and their `_ml/_hi/_ta` variants stay. New narrative fields start EN-only. For translating the new child tables, prefer one `study_translations(study_id, lang, entity, entity_id, field, text)` table over adding more suffixed columns.

### New tables (all `study_id uuid FK company_studies ON DELETE CASCADE`, `sort_order int`, `created_at`, `updated_at`)
| Table | Columns (core) | Notes |
|---|---|---|
| `study_financial_periods` | `company_id`, `period_end date`, `period_type ('Q','FY','H')`, `fiscal_label ('Q2 FY26')`, `basis ('standalone','consolidated')`, `revenue`, `ebitda`, `pat`, `eps`, `other_income`, `total_debt`, `cash`, `cfo`, `capex`, `currency`, `unit ('crore')`, `source_id`, `filed_at`, `revision int`, `superseded_by` | **Append-only (decision #3):** `UNIQUE (company_id, period_end, period_type, basis, revision)`. Restatements add a new revision and never update. Keyed by `company_id`, so studies share it. No price, market cap or multiples columns. |
| `study_shareholding_periods` | `company_id`, `period_end`, `promoter_pct`, `promoter_pledged_pct`, `fii_pct`, `dii_pct`, `mf_pct`, `public_pct`, `others_pct`, `source_id`, `filed_at`, `revision` | Same append-only rule. |
| `study_ownership_changes` | `study_id`, `company_id`, `period_from`, `period_to`, `holder_name`, `holder_type`, `pct_from`, `pct_to`, `change_pct` (generated), `direction ('increase','decrease','new','exit')` (generated), `source_id` | Section title "Ownership changes". The renderer shows increases **and** decreases. |
| `study_products` | `name`, `segment`, `description`, `revenue_share_pct`, `period_end`, `source_id` | |
| `study_tam_analysis` | `market`, `geography`, `size_value`, `size_unit`, `as_of_year`, `growth_note`, `method`, `source_id` | No "upside" framing. |
| `study_developments` | `event_date`, `title`, `body`, `category ('filing','order','management','capex','regulatory')`, `source_id` | |
| `study_risks` | `title`, `body`, `category`, `severity_note` | |
| `study_sources` | `kind ('annual_report','quarterly_result','shareholding_filing','exchange_announcement','concall','other')`, `title`, `url`, `published_on`, `accessed_on`, `archive_url` | Every figure references one of these. |
| `study_status_log` | `study_id`, `from_status`, `to_status`, `changed_by`, `changed_at`, `note` | Audit trail for the workflow. |

### RLS (all study tables)
- `SELECT` for `anon, authenticated` where the parent study has `status = 'published'` (an `EXISTS` subquery, or a `SECURITY DEFINER` helper `study_is_public(study_id)`).
- `ALL` for `public.is_admin()`.
- Period tables (keyed by `company_id`): public read only where a published study exists for that company.
- Content guard: optional `CHECK` constraints or a trigger that rejects text matching `/\b(buy|sell|target price|accumulate|outperform)\b/i` in public narrative fields. Cheap insurance for decision #4.

---

## 5. UI CHANGES

### Routes
| Route | Type | Notes |
|---|---|---|
| `/company/:slug` | **Static HTML** (prerendered) | Public study. Not a React route in production. |
| `/company` | Static HTML | Directory of published studies (the new lead product). |
| `/admin/studies` | SPA, `AdminRoute` + `is_admin` | List with status pipeline (Draft → Researching → Reviewed → Published → Archived). |
| `/admin/studies/new`, `/admin/studies/:id` | SPA | Tabbed editor: Overview/narrative · Financials · Shareholding · Ownership changes · Products · TAM · Developments · Risks · Sources · Translations. |
| `/admin/studies/:id/preview` | SPA, client-side only | Same components as the static build. |
| `/learn/company/:symbol`, `/learn/companies` | Redirect | 301 to `/company/<slug>` / `/company` once migrated. Keep the old pages until then. |
| `/admin/company-studies` | Redirect | Point to `/admin/studies` once the new editor replaces `CompanyStudiesAdmin`. |

### Components to build (`src/components/study/`, pure and props-only, SSR-safe: no hooks that touch `window`, no supabase)
`StudyLayout`, `StudyHeader` (name, sector, "PineX Research", dates), `StudyToc`, `NarrativeSection`, `FinancialsTable` (periods as columns, right-aligned tabular numbers), `FinancialTrendSpark` (inline SVG, **no recharts** in static output), `ShareholdingTable`, `OwnershipChanges` (two groups: increases / decreases), `ProductsList`, `TamBlock`, `DevelopmentsTimeline`, `RisksList`, `SourcesList` + `SourceRef` footnote marker, `StudyDisclaimer`, `LanguageSwitch` (static links `?lang=` or `/company/<slug>/ml/`).
Admin: `StudyEditor`, `PeriodGridEditor` (spreadsheet-style append), `SourcePicker`, `StatusControl`, `PublishButton`.

### Existing pieces to reuse
- `CompanyStudiesAdmin.jsx`: language tabs, Gemini translation, EN fallback, list/delete UI. Fold it into the new editor's Narrative tab.
- `CompanyStudy.jsx` `SECTION_LABELS` and disclaimers for localisation.
- `AdminRoute`, `AdminLayout` (add a "Studies" nav item), `useAuth().isAdmin`.
- `src/components/ui/Modal`, `Skeleton`, `Badge` (admin only, not static pages).
- `src/components/stock/ShareholdingTrend.jsx` as a visual reference only. It's recharts-based, so don't import it into static output.
- `DefaultSeo` / `siteMeta.js` conventions for meta tags.

---

## 6. DESIGN SYSTEM CONFLICT

The site is dark, square and dense (`--bg-primary #0B0E11`, 3–4px radius max, DM Sans, small type). Editorial pages want long-measure reading, serif body type and calmer contrast.

Static study pages **don't load the SPA stylesheet**, so they can't break the app's look or be broken by it. The conflict only shows in two places: (a) the visual jump when a user clicks from the app into a study, and (b) the admin draft preview, which renders inside the SPA.

Options:
| | Option | Pros | Cons |
|---|---|---|---|
| A | **Dark editorial.** Same tokens and square corners, but Newsreader serif body, 680px measure, 17–18px type, generous spacing. | Clearly the same product. Newsreader is already loaded. No theme logic. | Long reading on dark is tiring. Tables need care. |
| B | **Paper editorial.** Reuse the existing `[data-theme="sepia"]` token values as the study palette; keep the site's square corners and the dark top bar/wordmark as a bridge. | Best readability. Sepia tokens already exist and pass WCAG (see `theme.css` notes). The dark top bar ties it to the app. | A deliberate visual shift. Needs a clear "Studies" masthead so it reads as a section, not a bug. |
| C | **Follow the user's theme.** Study CSS ships both palettes and `prefers-color-scheme` (plus the stored PineX theme via a 3-line inline script) picks one. | Matches whatever the user chose in the app. | Twice the design QA. Default for logged-out visitors is ambiguous. |
| D | Rounded, magazine-style cards | — | Clashes with the site's identity. Not recommended. |

**Recommendation: B with A's rules.** Paper palette from the sepia tokens, the site's square corners and hairline borders, Newsreader for body, DM Sans for labels and tables, tabular numbers. Put the tokens in `src/styles/study.css`, scoped under `.study-surface`. That one file is (1) inlined into the static HTML and (2) imported by the admin preview inside a `.study-surface` wrapper, so the preview looks the same without leaking into the app. Keep the PineX dark top bar on study pages so the jump between the two looks intentional.

---

## 7. RISKS

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **PWA service worker answers `/company/*` with the SPA shell** (same class of bug as quickscanner) | Studies 404 except on hard refresh | Add to `navigateFallbackDenylist` + `globIgnores` in the same PR as the first static page. Test on a browser that already has the SW installed. |
| 2 | Recreating `financials` / `shareholding` with a new shape | 13 legacy files start reading or writing it. `quarterly.yml` (`fetch_indianapi.py`, next run 1 Feb) would write old-shape rows into it | Use `study_*` names only. Separately: `quarterly.yml` is probably failing today against the dropped `shareholding`/`financials` tables. Out of scope (don't touch pipelines), but worth checking the last run. |
| 3 | Adding columns or triggers to `companies` | The daily pipeline upserts `companies`. A NOT NULL or trigger could break `daily.yml` | Don't alter `companies`. All study data hangs off `company_studies.company_id`. |
| 4 | Netlify build failures from the new prerender step | Blocks **every** deploy, including the daily screener push | Wrap it like `prerender_pulse.mjs`: fail only on a published-but-empty render, warn on everything else. Add a feature flag env (`STUDIES_PRERENDER=0`) to skip it. |
| 5 | Build hook URL leaks | Anyone can trigger builds (cost / DoS) | Keep it only in the Netlify function env. The function checks the JWT and role with the service key. Rate-limit it. |
| 6 | Build-minute and deploy churn | Each publish is a full build (~50 s for Vite alone, plus prerenders) | Debounce. Batch publishes. |
| 7 | Changing `company_studies` RLS/columns while the old pages are live | Old `/learn/company` pages or the admin break | Additive migration only: keep `is_published` in sync via trigger, add the new `is_admin()` policy *before* dropping the email policy, keep the old pages until the redirect phase. |
| 8 | Two admin checks (email in `AdminRoute`, role in DB) | Someone passes the UI but RLS denies them, or the reverse | For Studies, require both for now. Unify `AdminRoute` on the role later (separate task; IQjet stays email-based by design). |
| 9 | Existing users' bookmarks / SEO for `/learn/company/*` | 404s, lost indexing | 301 redirects in `netlify.toml` (generated per slug, or one rule `/learn/company/:symbol → /company/:symbol` if slug = lowercased symbol). |
| 10 | Price data creeping back in (decision #4) | Compliance and positioning | Study components get no price props by type. Lint/grep check in CI for `price_data` imports under `src/components/study/`. Text guard (§4). |
| 11 | The modulepreloaded `vendor-charts` (118 KB gz) leaking into study pages | Slow static pages | Static output imports no recharts or supabase. Add a size assertion in `prerender_studies.mjs` (e.g. page < 150 KB). |
| 12 | SSR of components that touch `window`/`localStorage` | Build crash | Keep `src/components/study/` pure. Add a test that renders each component with `renderToStaticMarkup`. |
| 13 | Indic fonts in static pages / PDF | Broken glyphs for HI/TA | Load Noto Sans Devanagari / Tamil / Malayalam only for the matching `lang` page (`display=swap`). Print CSS for PDF. |

Nothing proposed touches `price_data`, `daily_closes`, `swing_conditions`, `daily.yml` or screener code.

---

## 8. BUILD ORDER

Each phase is sized as one self-contained Claude Code prompt and can ship on its own.

1. **DB foundation (SQL file only, user runs it).** Write `scripts/sql/studies_v2_schema.sql`: extend `company_studies` (company_id, slug, status, byline, version, triggers that sync `is_published` and log status), create the `study_*` tables, RLS using `is_admin()`, and replace the email policy additively. Include a backfill of `slug` and `company_id` for existing rows and a rollback section. No app code.
2. **Shared study components and tokens.** Create `src/components/study/*` (pure, SSR-safe) and `src/styles/study.css` (`.study-surface` paper/editorial tokens). Add a node test that renders every component with fixture data via `renderToStaticMarkup`. Not wired to any route yet.
3. **Admin editor.** `/admin/studies` list with status pipeline, `/admin/studies/:id` tabbed editor (narrative tab reuses `CompanyStudiesAdmin` logic, including Gemini translation), append-only period grids, sources picker, and `/admin/studies/:id/preview` using phase-2 components. Gated by `AdminRoute` plus `useAuth().isAdmin`. Add the nav item in `AdminLayout`.
4. **Static prerender.** `scripts/prerender_studies.mjs` (SSR the phase-2 components for every published study → `dist/company/<slug>/index.html` + `/company` index + sitemap entries + JSON-LD). Chain it into `npm run build`. Add the `netlify.toml` `/company/*` rule above the catch-all and the VitePWA denylist/globIgnores. Add the `STUDIES_PRERENDER` flag and size assertions.
5. **Publish flow.** `netlify/functions/admin-publish-study.js` (JWT + role check via service key, status transition, `published_at`/`version`, debounced call to `NETLIFY_BUILD_HOOK_URL`, writes `last_built_at`). Add the Publish / Unpublish / Archive buttons in the editor. Document the env var.
6. **Migration of the legacy surface.** Strip the `price_data` card and stage badges from `CompanyStudy.jsx`/`CompanyStudies.jsx` (or retire them), add 301s from `/learn/company/*` and `/learn/companies`, and redirect `/admin/company-studies` → `/admin/studies`. Update nav entries to point at `/company`.
7. **Multilingual and PDF.** `study_translations` editing UI, per-language static pages (`/company/<slug>/hi/`), Noto font loading per language, print stylesheet for "Save as PDF". Retire the html2canvas/jspdf path for studies.
8. **Hardening (optional).** Content guard trigger (buy/sell vocabulary), CI grep for `price_data` under `src/components/study/`, Lighthouse budget for a study page, and a follow-up to move `AdminRoute` from email to role.
