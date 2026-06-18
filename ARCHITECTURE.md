# ARCHITECTURE — Repacking & Landed-Cost Prototype

> **Living document.** This is the single source of truth for how the app is built.
> Update it in the SAME commit as any change that alters the data model, a screen's
> behaviour, the cost model, conventions, or deployment. Add a line to the
> [Iteration Log](#iteration-log) every time. If code and this doc disagree, the doc is wrong — fix it.

Last updated: **2026-06-15**

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
  lib/
    supabase.ts                Client + isSupabaseConfigured flag
    useData.ts                 useData(loader, deps) → {data, loading, error, refresh}
    cost.ts                    PURE cost engine (calculateCost, hoursBetween)
    cost.test.ts               Unit tests (consistency: Σ per-pack = total batch cost)
    excel.ts                   parseParentWorkbook(), exportChildRecords()
    units.ts                   toGrams(), formatWeight()
    codes.ts                   childItemCode/childBatchId/childDescription
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

**Transactional:**
- `parent_items` — Excel receipt: `item_code, description, unit('kg'|'g'), batch_id, quantity, expiry_date, unit_cost, total_value, warehouse_name, received_at`
- `repack_jobs` — `parent_item_id→parent_items`, `machine_code`, `operator_code`, `status('Created'|'Processing'|'Completed')`, `shift`, `created_at`, `start_at`, `complete_at`
- `job_pack_sizes` — `job_id→repack_jobs`, `pack_size_g`, `expected_packs`, `expected_output_g`, `actual_packs`, `actual_output_g`
- `job_wastage` — `job_id→repack_jobs`, `reason`, `grams`
- `child_skus` — generated: `job_id, parent_item_id, child_item_code, description, unit('pack'), batch_id, pack_size_g, quantity, expiry_date, unit_cost, total_value, warehouse_name, created_at`

**Relationships:** `parent_items 1—N repack_jobs 1—N {job_pack_sizes, job_wastage, child_skus}`.
All child FKs `on delete cascade`.

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

**Job lifecycle** (`JobDetail.tsx`), gated by `repack_jobs.status`:
1. **Created** — plan output mix: add `job_pack_sizes` rows, edit `expected_packs` (auto `expected_output_g`). Shows total parent weight. → **Start Processing** sets `start_at`, `shift = shiftFromIso(now)`, status `Processing`.
2. **Processing** — enter `actual_packs` per line (auto `actual_output_g`). → **Complete Processing** sets `complete_at`, status `Completed`.
3. **Completed** — wastage entry, Output Summary, Costing sheet, and **Generate Child SKUs** (idempotent: deletes existing `child_skus` for the job then inserts fresh).

**Code generation** (`codes.ts`): `child_item_code = {parent.item_code}-{size}G`; `batch_id = {parent.batch_id}CH0n` (n = pack-line index+1); `unit = 'pack'`; expiry + warehouse inherited from parent.

**Shift** is derived (not captured): Morning 06–14 / Afternoon 14–22 / Night 22–06 from `start_at`.

**Navigation lock:** once a job has `start_at` set and no child SKUs yet (`childCount === 0`), the
job screen is "locked" — `useBlockNavigation` (`src/lib/navGuard.tsx`) blocks sidebar links and warns
on browser refresh/close. The user must **Generate Child SKUs** (commit) or **Cancel Process** (revert
to `Created`, clear actuals + wastage, keep the planned mix) to leave.

**Dashboard scope:** `computeMetrics()` reflects every job with `status === 'Completed'` and computes
all figures **live** via the same `calculateCost()` engine the job screen uses (loads `costing_config`,
`packaging_costs`, `machines` for overrides). Dashboard and job-screen numbers therefore always agree.
`child_skus` are NOT read by the dashboard — they remain the deliberate ERP snapshot for the Records
page. Cost-per-pack by size is a packs-weighted average across completed jobs; `totalValue` = Σ job
`totalBatchCost`.

---

## 7. Deployment
- `npm run build` → `scripts/generate-icons.mjs` then `tsc --noEmit` then `vite build` (+ PWA SW).
- `.github/workflows/deploy.yml` runs on push to `main`: `npm ci` → `gen:icons` → `build` (injects Supabase secrets) → upload artifact → `deploy-pages`.
- **GitHub Pages** source = GitHub Actions (`build_type: workflow`).
- **Required repo secrets:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Without them the app builds but shows the "Supabase not configured" banner.

---

## 8. Conventions
- **Design system:** Inter font; brand teal scale (`brand-50..900`) + `shadow-soft/card/lift` in `tailwind.config.js`; soft radial-gradient body background. Tailwind component classes live in `src/index.css` (`.btn-primary` gradient, `.card`, `.input`, `.label`, `.icon-chip`, `.th`, `.td`, `.badge`). Prefer these over ad-hoc utility soup. `Stat` takes an optional `icon` (tinted chip) + `tone`.
- Keep calculation logic **pure** in `src/lib` and unit-tested; pages stay thin (fetch + render).
- `types.ts` mirrors `schema.sql` exactly — change both together.
- Money formatted via `format.ts` (no currency symbol — locale-agnostic).
- New master/dropdown ⇒ add table + seed + RLS in `schema.sql`, a type in `types.ts`, and a `MasterEditor` block in `Config.tsx`.

---

## 9. Known Limitations / Backlog
- Whole parent batch assumed as input (no partial-batch repacking yet).
- Single global machine/labor rate (per-machine override field exists, used if set).
- No auth/roles (open prototype).
- JS bundle is large (~1.2 MB: xlsx + recharts) — not code-split yet.
- Zoho integration is out of scope (Excel/CSV export only).

---

## 10. Iteration Log
Append one line per change set. Newest first.

- **2026-06-15** — Visual redesign: Inter font, brand teal scale + soft shadows, gradient body background, gradient buttons/brand marks, icon-chip stat cards, accent section headers, dotted status badges, polished nav active states.
- **2026-06-15** — Mobile UX: app-style **bottom tab bar** + mobile top app bar (desktop keeps the sidebar); browse screens (Jobs, Records, Receipt) render as **cards on mobile**, tables on `md+`. `Stat` gained `valueClassName`.
- **2026-06-15** — Dashboard now computes **live** via `calculateCost()` (not the `child_skus` snapshot) and reflects all `status='Completed'` jobs (dropped the child-SKU gate). Job-screen and dashboard numbers always agree now.
- **2026-06-15** — Jobs list: per-row **Delete** (cascades to plan, wastage, child SKUs; confirm warns).
- **2026-06-15** — Job screen **navigation lock** + **Cancel Process** button (`src/lib/navGuard.tsx`, `NavGuardProvider` in App): can't leave a started-but-ungenerated job without generating child SKUs or cancelling. Dashboard now counts only jobs with generated child SKUs.
- **2026-06-15** — Added **20g** to the seeded `pack_sizes` and `packaging_costs` (0.30) in `schema.sql`. Existing DBs: add via Config page or re-run `schema.sql` (idempotent).
- **2026-06-15** — Receipt page: added per-row **Delete** on received parent items (`ParentTable` gains optional `onDelete`). Deletion cascades to that batch's jobs and child SKUs (FK `on delete cascade`); confirm dialog warns about this.
- **2026-06-15** — Initial build: full prototype (parent receipt, jobs, production capture with start/complete timestamps, wastage, output summary, costing, child SKU generation, records + export, dashboard, config masters). Deployed to GitHub Pages. Cost engine unit-tested. _(commit: initial prototype)_
- **2026-06-15** — Added this living ARCHITECTURE.md.
