# ARCHITECTURE — Repacking & Landed-Cost Prototype

> **Living document.** This is the single source of truth for how the app is built.
> Update it in the SAME commit as any change that alters the data model, a screen's
> behaviour, the cost model, conventions, or deployment. Add a line to the
> [Iteration Log](#iteration-log) every time. If code and this doc disagree, the doc is wrong — fix it.

Last updated: **2026-06-19**

> **Restructure in progress** (branch `restructure/multi-parent-blends`): re-basing the model on
> **inputs-as-a-list (`job_parents`) + a declared output product (`parent_child_map`)**, with an
> On-Hold lifecycle, snapshot-based dashboard, and accounts (5 phases — see Iteration Log).
> New schema columns/tables are added **alongside** legacy ones so screens migrate phase-by-phase.
> **Phases 1–4 done:** data model + Parent-Child Master + editable Receipt (P1); multi-parent/blend
> job flow with On-Hold active-time tracking, master-driven child SKUs, cost snapshots (P2);
> Records split into Child SKUs + Parent Adjustments (P3); snapshot-based Dashboard with date filter
> and drill-through (P4). Pending: scale hardening + auth/roles (P5).

---

## 1. Overview
The app treats a bulk **parent batch** (e.g. a 20 kg cashew bag) as a parent and runs a
controlled **repacking job** into child packs (50 g / 100 g / 250 g). It captures every cost and
loss input, **auto-calculates the actual landed cost per child pack**, and generates child-SKU
inventory lines exported to Excel/CSV for ERP import.

- **Live app:** https://jeswin-habibi.github.io/Prototype/
- **Repo:** https://github.com/jeswin-habibi/Prototype
- **Auth:** none (open prototype). Supabase RLS is permissive (anon read/write). _Demo only — no sensitive data._

---

## 2. Tech Stack
| Concern | Choice |
|---|---|
| UI | React 18 + TypeScript |
| Build | Vite 5 (`base: '/Prototype/'`) |
| Styling | Tailwind CSS 3 (component classes in `src/index.css`) |
| Routing | `react-router-dom` v6, **HashRouter** (GitHub Pages = static; avoids deep-link 404s) |
| Data | Supabase (Postgres) via `@supabase/supabase-js` |
| Excel | `xlsx` (SheetJS) — import + export |
| Charts | `recharts` |
| PWA | `vite-plugin-pwa` (autoUpdate) — installable on mobile |
| Tests | `vitest` (cost math) |
| Hosting | GitHub Pages via GitHub Actions |

Env vars (build-time, `VITE_` prefix): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. The anon key
is public by design; access is governed by RLS (open here).

---

## 3. Repo Structure
```
.github/workflows/deploy.yml   CI: build + deploy to GitHub Pages
scripts/generate-icons.mjs     Generates PWA PNG icons (no native deps)
supabase/schema.sql            Tables + seed masters + RLS (run once in Supabase)
sample-data/parent-items.csv   Demo upload file
public/                        favicon.svg, icon-192.png, icon-512.png
src/
  main.tsx                     Entry: HashRouter + App
  App.tsx                      Layout, nav, routes, Supabase-config banner
  types.ts                     DB row types (mirror schema.sql)
  index.css                    Tailwind + .btn/.card/.input/.th/.td component classes
  components/ui.tsx            PageHeader, Section, Stat, StatusBadge, Empty, Spinner, Banner
  components/DataGrid.tsx      Reusable inline-edit grid: CRUD + Import/Template/Export (+deriveRow; opt-in rich toolbar via `icon`)
  lib/
    supabase.ts                Client + isSupabaseConfigured flag
    useData.ts                 useData(loader, deps) → {data, loading, error, refresh}
    cost.ts                    PURE cost engine (calculateCost, hoursBetween)
    cost.test.ts               Unit tests (consistency: Σ per-pack = total batch cost)
    time.ts                    activeSeconds()/formatDuration() — active processing time from events
    time.test.ts               Unit tests (On-Hold gaps excluded)
    childMap.ts                resolveChild()/childExpiry() — child identity from Parent-Child Master
    excel.ts                   parseParentWorkbook/parseParentChildMap, downloadTemplate, exportRows, exportChildRecords
    parent.ts                  parentRow()/parentTotalWeightG() — receipt derive + legacy mirror
    units.ts                   toGrams(), formatWeight()
    codes.ts                   childItemCode/childBatchId/childDescription (fallback; map lookup preferred)
    format.ts                  money/pct/num/dateTime/dateOnly/shiftFromIso
  pages/
    Dashboard.tsx              KPIs + charts + variance tables (pure computeMetrics())
    Receipt.tsx                Parent Excel upload → preview → save
    Jobs.tsx                   Jobs list + Create Job
    JobDetail.tsx              Full job flow (see §6)
    Records.tsx                Child SKUs + Excel/CSV export
    Config.tsx                 Admin masters + costing rates (generic MasterEditor)
```

---

## 4. Data Model (Supabase)
Defined in `supabase/schema.sql`. All ids are `uuid default gen_random_uuid()`.

**Masters (admin-editable):**
- `employees` — `code`, `name`, `active`
- `machines` — `code`, `name`, `cost_per_hour_override?`, `active`
- `pack_sizes` — `grams` (unique), `label`, `active` _(seeded: 20, 50, 100, 250)_
- `wastage_reasons` — `name` (unique), `active`
- `costing_config` — singleton: `machine_cost_per_hour`, `labor_cost_per_hour`
- `packaging_costs` — `pack_size_g` (unique), `cost_per_unit`
- **`parent_child_map`** _(NEW — the Parent-Child Master)_ — `parent_code, parent_description, category, pack_size_g, child_code, child_description, child_barcode, active`; unique `(parent_code, pack_size_g)`. **Blends are rows under the blend's own `parent_code`.** Drives child-SKU identity (replaces generated codes).

**Transactional:**
- `parent_items` — receipt. NEW: `category, qty (unit count), weight_per_unit, weight_unit('kg'|'g'), total_cost`, generated `total_weight_g`. **Legacy mirror kept** (`unit, quantity, unit_cost, total_value`) — `parent.ts::parentRow()` keeps them consistent (quantity = total grams, total_value = total_cost) so un-migrated screens still read correct weights/costs.
- `repack_jobs` — NEW: `process_type('Machine'|'Manual')`, `output_product_code`, `active_seconds`; `machine_code` + `parent_item_id` now **nullable**; status adds **`'On Hold'`**.
- **`job_parents`** _(NEW junction — inputs)_ — `job_id, parent_item_id, required_weight_g, material_cost`. Job input weight = Σ`required_weight_g`; material cost = Σ`material_cost`. "Parent Adjustments" = balance view over this.
- **`job_time_events`** _(NEW)_ — `job_id, event_type('start'|'hold'|'resume'|'stop'), at` → active processing time.
- `job_pack_sizes` — `actual_packs`/`actual_output_g` kept; `expected_*` retired (planned-output flow removed in Phase 2).
- `job_wastage` — `job_id, reason, grams`.
- `child_skus` — NEW: `category, child_barcode, output_product_code`; `parent_item_id` nullable. Identity from `parent_child_map` (Phase 2).
- **`job_cost_snapshot`** _(NEW — scale)_ — frozen per-job result at "Generate Child SKUs"; the dashboard reads these instead of recomputing history.

**Relationships:** `repack_jobs 1—N {job_parents, job_time_events, job_pack_sizes, job_wastage, child_skus, job_cost_snapshot(1—1)}`.
All child FKs `on delete cascade`. Indexes on status/dates/FKs for scale.

**RLS:** every table has a single `open_all` policy (`using(true) with check(true)`) for anon+authenticated.

---

## 5. Cost Model (`src/lib/cost.ts`)
**Allocation rule (approved):** packaging is a **direct per-size** cost; parent material + machine +
labor are spread across **good output by weight**.

```
input_weight_g        = toGrams(parent.quantity, parent.unit)
total_actual_output_g = Σ pack_size_g * actual_packs
total_wastage_g       = Σ job_wastage.grams
process_variance_g    = input_weight_g - total_actual_output_g - total_wastage_g   (unaccounted)

yield_pct       = total_actual_output_g / input_weight_g * 100
wastage_pct     = total_wastage_g / input_weight_g * 100
lost_yield_pct  = (input_weight_g - total_actual_output_g) / input_weight_g * 100

machine_hours   = (complete_at - start_at) in hours        // hoursBetween()
machine_cost    = machine_hours * (machine.override ?? config.machine_cost_per_hour)
labor_cost      = machine_hours * config.labor_cost_per_hour
packaging_cost  = Σ actual_packs * packaging_per_unit[size]

total_batch_cost   = parent.total_value + packaging_cost + machine_cost + labor_cost
spread_per_gram    = (parent.total_value + machine_cost + labor_cost) / total_actual_output_g
cost_per_pack[s]   = spread_per_gram * s + packaging_per_unit[s]
blended_cost/gram  = total_batch_cost / total_actual_output_g   // reporting metric only
```
**Invariant (tested):** `Σ cost_per_pack[s] * actual_packs[s] === total_batch_cost`.

`calculateCost()` is pure (no I/O) so it is unit-tested and reused identically by `JobDetail` and any
future report. `Dashboard.computeMetrics()` is likewise pure.

---

## 6. Screen Flow & State
Data access pattern: pages call `useData(loader, deps)` for reads; mutations call `supabase.from(...)`
directly then `refresh()`. No global store — each page owns its data. Masters drive every dropdown.

**Job creation** (`Jobs.tsx`): pick **Machine|Manual** (Manual hides the machine field, machine_code null); operator (+machine) default to the first active master, editable. **Multi-parent picker**: parents listed earliest-expiry-first, searchable, each checkbox takes a **weight to draw** capped at the parent's **remaining** weight (`total_weight_g − Σ job_parents`); writes `job_parents` rows. **Output product** defaults to the single input's `item_code`; if inputs span products it's a **blend** and the user picks the output product (any `parent_child_map` code). Legacy `parent_item_id` is set to the primary input for back-compat.

**Job lifecycle** (`JobDetail.tsx`), gated by `repack_jobs.status` (planned-output step removed):
1. **Created** — shows inputs (job_parents) + output product. → **Start Processing** logs a `start` event, sets `start_at`, `shift`, status `Processing`.
2. **Processing** — **Hold** (`hold` event, status `On Hold`) / **Resume** (`resume` event) / **Stop** (`stop` event, `complete_at`, status `Completed`). **Active time** = `activeSeconds(job_time_events)` (On-Hold excluded), ticking live while Processing.
3. **Completed** — enter **Actual Produced Items** (add pack-size lines + packs), **Wastage** (auto-seeds one `QC Rejects` row = remaining grams; editable; "+ QC Rejects (remaining)" shortcut), Output Summary (input/output/yield/lost-yield/wastage-kg/time/packs) + Costing (machine cost **0 if Manual**), then **Generate Child SKUs**.

**Cost inputs now**: `inputWeightG = Σ job_parents.required_weight_g`, `parentMaterialCost = Σ job_parents.material_cost`, `machineHours = activeSeconds/3600`, `machineCostPerHour = 0` when Manual. Engine (`cost.ts`) unchanged.

**Child identity** (`childMap.ts::resolveChild`): looked up in `parent_child_map` by **(output_product_code, pack_size_g)** → `child_code/description/barcode/category` (falls back to generated `codes.ts`). `batch_id = childBatchId(single-input batch | output code, idx)`; expiry = single input's, or the **latest** across inputs (`childExpiry`); warehouse from primary input. **Generate** is idempotent (deletes job's `child_skus` first) and writes a **`job_cost_snapshot`** (upsert on `job_id`) + caches `active_seconds`.

**Shift** is derived (not captured): Morning 06–14 / Afternoon 14–22 / Night 22–06 from `start_at`.

**Navigation lock:** once a job has `start_at` set and no child SKUs yet (`childCount === 0`), the
job screen is "locked" — `useBlockNavigation` (`src/lib/navGuard.tsx`) blocks sidebar links and warns
on browser refresh/close. The user must **Generate Child SKUs** (commit) or **Cancel Process** (revert
to `Created`, clear actuals + wastage, keep the planned mix) to leave.

**Records** (`Records.tsx`): two tabs. **Child SKUs** — generated rows with master-derived identity;
`expiry_date` is inline-editable; Excel export (`exportChildRecords`). **Parent Adjustments** — a view
over `job_parents` (parent id, description, output product, drawn weight, material cost) with a live
**balance weight** = `parent.total_weight_g − Σ draws` against that parent; Excel export.

**Dashboard scope** (`Dashboard.tsx`): reads the **`job_cost_snapshot`** rows (frozen at generation)
plus `child_skus` (size/child drill-through) and `job_wastage` (joined to jobs for process_type /
output product / category), all **filtered by date** at the DB. KPIs (input/output/yield/waste/packs/
value + status pipeline), output-by-size and cost-per-pack-by-size **bar drill-through to child items**,
wastage by reason / process / parent / category, a day/month/year **production trend**, avg time by
parent/category, and a Manual-vs-Machine table. Aggregation is client-side over the compact snapshot
set; moving it into a Postgres RPC / materialized view is the Phase 5 scale step.

---

## 7. Deployment
- `npm run build` → `scripts/generate-icons.mjs` then `tsc --noEmit` then `vite build` (+ PWA SW).
- `.github/workflows/deploy.yml` runs on push to `main`: `npm ci` → `gen:icons` → `build` (injects Supabase secrets) → upload artifact → `deploy-pages`.
- **GitHub Pages** source = GitHub Actions (`build_type: workflow`).
- **Required repo secrets:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Without them the app builds but shows the "Supabase not configured" banner.

---

## 8. Conventions
- **Design system:** Inter font; **emerald `brand` scale** + **`ink` dark-navy chrome** (header/sidebar/floating bottom-nav/`SummaryBar`) in `tailwind.config.js`; `shadow-soft/card/lift`; subtle emerald radial body glow. **Dark mode** is class-based (`darkMode:'class'`, toggled via the header/sidebar switch, persisted in `localStorage`); core surfaces carry `dark:` variants (full dark polish pending a reference). Tailwind component classes live in `src/index.css` (`.btn-primary` gradient, `.card`, `.input`, `.label`, `.icon-chip`, `.th`, `.td`, `.badge`). Prefer these over ad-hoc utility soup. `Stat` takes an optional `icon` (tinted chip) + `tone`.
- Keep calculation logic **pure** in `src/lib` and unit-tested; pages stay thin (fetch + render).
- `types.ts` mirrors `schema.sql` exactly — change both together.
- Money formatted via `format.ts` (no currency symbol — locale-agnostic).
- New master/dropdown ⇒ add table + seed + RLS in `schema.sql`, a type in `types.ts`, and a `<DataGrid …/>` block in `Config.tsx`. `DataGrid` (replaces the old `MasterEditor`) is the reusable inline-edit grid; pass `onImport`/`templateHeaders`/`exportColumns` to enable Excel import/template/export, and `deriveRow` to keep computed/mirror columns consistent on save.

---

## 9. Known Limitations / Backlog
- ~~Whole parent batch assumed as input~~ → **resolved (P2):** jobs draw partial weights from multiple parents (`job_parents`).
- Parent-balance check (remaining weight) is computed client-side at create time; an atomic `consume_parent` RPC for concurrent operators is a Phase 5 hardening.
- Single global machine/labor rate (per-machine override field exists, used if set).
- No auth/roles (open prototype).
- JS bundle is large (~1.2 MB: xlsx + recharts) — not code-split yet.
- Zoho integration is out of scope (Excel/CSV export only).

---

## 10. Iteration Log
Append one line per change set. Newest first.

- **2026-06-21** — **Dashboard/Jobs UX + input fixes**: Dashboard date filter now constrains the range (**To can't precede From** via `min`/`max`); **Job Pipeline** tiles go **2-up on mobile** (4-up `sm+`) so labels fit one line and numbers align. Jobs page: **Create Job hides the list** (you see only the form until "← All Jobs"); selected parents render as a tidy row with a **small trash button** on the right (was wrap-chips with ✕). DataGrid: pressing **Enter / mobile "Go" commits the field** (blurs to save) instead of needing a tap-away.
- **2026-06-21** — **Rename → Repack Pro**: app renamed Double 5 Analytics → **Repack Pro** across header/sidebar, `index.html` title + iOS title, and PWA manifest `name`/`short_name` (both "Repack Pro"). Logo image/PWA icon art unchanged.
- **2026-06-21** — **Rebrand + mobile fixes**: app renamed **Re-Pack IQ → Double 5 Analytics** (header/sidebar, `index.html` title + iOS title, PWA manifest `name`; manifest `short_name` = "Double 5"). **DataGrid rich toolbar made responsive** — the button grid was overflowing off-screen on phones; it now **stacks below the heading on mobile** (2×2, full-width) and sits beside it (with the divider) only on `sm+`; the toolbar renders in its own card rather than `Section`'s fixed horizontal header. Dashboard **Job Pipeline tiles**: reserved a 2-line label height so long labels (Processing/Completed) no longer push their numbers out of alignment.
- **2026-06-21** — **DataGrid rich toolbar**: opt-in via a new `icon` prop on `<DataGrid>` (gated, so the 6 Config grids are unchanged). When set, the section header shows an **icon badge + two-tone heading** (first word brand-teal, rest white) and the Import/Template/Export/Add actions become a **2×2 button grid with icon chips** (`IconUpload`/`IconDownload`) and a left divider; **+ Add** stays the filled gradient primary. `Section.title` widened to `ReactNode`; Receipt passes `icon={<IconBox/>}`.
- **2026-06-19** — **Mobile polish + fixes**: On-Hold jobs no longer block navigation (only active Processing locks; Cancel still available while in progress). Dashboard: fixed Cost-tab horizontal overflow (`grid-cols-1` base on tab grids), **denser 4-up KPI tiles** with abbreviated values, **status pipeline corrected** (Created = total jobs; others = current status), wastage pie uses a **legend** (labels no longer overlap). JobDetail Output Summary + Cost sheet **compressed** (compact `Mini` tiles, tighter tables). Config **Parent-Child Master is now collapsed behind a button**. Seeder differentiates process: **machines run higher yield + throughput** so the Manual-vs-Machine view shows machine yield ↑ and cost/pack ↓ (verified: 95.4% vs 88.5%, 3.10 vs 3.69).
- **2026-06-19** — **Dark theme + icon system**: implemented the dark theme (darkened `ink` palette; dark-aware charts via `useIsDark` + `chartColors` — grid/axis/tooltip). Inline SVG icon set (`components/icons.tsx`) replaces all emoji (toggle, nav, KPI chips, record cards). Dashboard KPIs are icon-chip cards (colored accents); the **job pipeline** is a highlighted panel (per-status colors + icons). Currency shows **KWD** (no `$`); "value" uses a coins icon. Nav icons: home/receipt/clipboard/records/gear.
- **2026-06-19** — **Visual rebrand (light mode)**: emerald accent + **dark-navy chrome** (header/sidebar/floating bottom-nav). Theme toggle (sun/moon) replaces any header icon; **class-based dark mode** wired + persisted (`useTheme` in `App.tsx`), core surfaces carry `dark:` variants (full dark styling awaits a reference). New `SummaryBar` (dark totals strip) used on Records; record cards get a green left-accent + icon chip + icon-labelled fields. Logo uses `favicon.svg`.
- **2026-06-19** — **Dashboard redesign + UX/scale pass**: Dashboard rebuilt with **compact KPI tiles** (2-up mobile / 4-up desktop), a single status strip, and **tabbed charts** (Overview / Production / Cost / Wastage / Time) so a phone shows answers with minimal scrolling. Job picker now draws in **kg** (stored as g) with a **FEFO nudge** when an earlier-expiry batch has stock. JobDetail guards: **output > input** warning + **missing Parent-Child Master** warning before generate. Routes are **code-split** (`React.lazy`) so xlsx/recharts load on demand — initial chunk ~1.28 MB → ~389 KB. Added an atomic **`consume_parent(job, parent, g)`** RPC (schema.sql); job creation calls it and falls back to a plain insert if not yet deployed. Demo IDs are now numeric (Parent `1000123`, Child `1000123-C1`). Auth/roles still deferred.
- **2026-06-19** — **Mobile-first pass + richer demo**: `DataGrid` renders **labelled cards on mobile** (table on `md+`) so Receipt/Config/Master are usable on phones; `Records` Child SKUs + Parent Adjustments get mobile cards; Dashboard KPIs/status go **2-up on mobile** with a compact date filter; JobDetail stat grids are 2-up on mobile. **Parent Adjustments** now also shows original **Qty (bags)** + **Original Weight**. Seeder reworked: alphanumeric SKU-style **Parent/Child IDs**, parent descriptions carry the **bag weight** (e.g. "Cashew Nuts W320 25kg bag"), qty = bags, and **~48 completed jobs spread across ~6 months** for meaningful daily/monthly/yearly trends (11/11 scenario tests pass).
- **2026-06-19** — **Fix + demo seed**: `child_skus.parent_item_id` was still `NOT NULL` on existing DBs, so blend child-SKU generation (which set it null) failed. Now `JobDetail` always writes the **primary input** as the legacy link (authoritative inputs remain in `job_parents`); `schema.sql` also drops the not-null for future DBs. Added `scripts/seed-demo.ts` — wipes + seeds realistic demo data and runs 10 end-to-end scenario assertions (no over-draw, cost invariant, manual=0, On-Hold time, blend latest-expiry, child identity from master, yield math, status pipeline) against the live DB via the real libs.
- **2026-06-19** — **Restructure Phase 4**: Dashboard rebuilt on **`job_cost_snapshot`** with a **date filter** and **drill-through** (output-by-size and cost-per-pack-by-size bars drill to child items; hover tooltips). Adds wastage by reason/process/parent/category, day/month/year production trend, avg production time by parent/category, and a Manual-vs-Machine comparison. Reads compact snapshots (not raw recompute); client-side aggregation (server RPC deferred to P5).
- **2026-06-19** — **Restructure Phase 3**: `Records.tsx` split into **Child SKUs** (master-derived identity, inline-editable expiry, Excel export) and **Parent Adjustments** (view over `job_parents` with live balance weight per parent, Excel export).
- **2026-06-19** — **Restructure Phase 2**: multi-parent/blend job flow. `Jobs.tsx` create form rebuilt (Machine/Manual, searchable expiry-sorted multi-parent picker with per-parent weight draw capped at remaining, output-product/blend selection → `job_parents`). `JobDetail.tsx` rewritten: planned-output removed; **Start/Hold/Resume/Stop** logged to `job_time_events` with **active-time** costing (`time.ts`, On-Hold excluded); post-stop actual pack lines; auto **QC Rejects** wastage = remaining; Manual ⇒ machine cost 0; child SKUs resolved from `parent_child_map` (`childMap.ts`, latest expiry for blends) + **`job_cost_snapshot`** written. New `time.ts`/`time.test.ts`, `childMap.ts`. (NB: the legacy `Dashboard.tsx` still reads single-parent fields — accurate for single-parent jobs, approximate for blends — until the Phase 4 snapshot-based rebuild.)
- **2026-06-19** — **Restructure Phase 1** (branch `restructure/multi-parent-blends`): new data model added alongside legacy (tables `parent_child_map`, `job_parents`, `job_time_events`, `job_cost_snapshot`; new columns on `parent_items`/`repack_jobs`/`child_skus`; `'On Hold'` status; indexes). New reusable **`DataGrid`** (CRUD + Import/Template/Export, supersedes `MasterEditor`). **Config** gains the **Parent-Child Master**. **Receipt** rebuilt as an inline-editable grid (import/template/export) with `parent.ts::parentRow()` deriving the legacy mirror. `excel.ts` generalized (`parseParentChildMap`, `downloadTemplate`, `exportRows`). Phases 2–5 (multi-parent job flow + On-Hold, Records split, new Dashboard, scale+auth) pending.
- **2026-06-15** — Visual redesign: Inter font, brand teal scale + soft shadows, gradient body background, gradient buttons/brand marks, icon-chip stat cards, accent section headers, dotted status badges, polished nav active states.
- **2026-06-15** — Mobile UX: app-style **bottom tab bar** + mobile top app bar (desktop keeps the sidebar); browse screens (Jobs, Records, Receipt) render as **cards on mobile**, tables on `md+`. `Stat` gained `valueClassName`.
- **2026-06-15** — Dashboard now computes **live** via `calculateCost()` (not the `child_skus` snapshot) and reflects all `status='Completed'` jobs (dropped the child-SKU gate). Job-screen and dashboard numbers always agree now.
- **2026-06-15** — Jobs list: per-row **Delete** (cascades to plan, wastage, child SKUs; confirm warns).
- **2026-06-15** — Job screen **navigation lock** + **Cancel Process** button (`src/lib/navGuard.tsx`, `NavGuardProvider` in App): can't leave a started-but-ungenerated job without generating child SKUs or cancelling. Dashboard now counts only jobs with generated child SKUs.
- **2026-06-15** — Added **20g** to the seeded `pack_sizes` and `packaging_costs` (0.30) in `schema.sql`. Existing DBs: add via Config page or re-run `schema.sql` (idempotent).
- **2026-06-15** — Receipt page: added per-row **Delete** on received parent items (`ParentTable` gains optional `onDelete`). Deletion cascades to that batch's jobs and child SKUs (FK `on delete cascade`); confirm dialog warns about this.
- **2026-06-15** — Initial build: full prototype (parent receipt, jobs, production capture with start/complete timestamps, wastage, output summary, costing, child SKU generation, records + export, dashboard, config masters). Deployed to GitHub Pages. Cost engine unit-tested. _(commit: initial prototype)_
- **2026-06-15** — Added this living ARCHITECTURE.md.
