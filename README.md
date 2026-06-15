# Repacking & Landed-Cost Prototype

Treats a bulk **parent batch** (e.g. a 20 kg cashew bag) as a parent and runs a controlled
**repacking job** into child packs (50 g / 100 g / 250 g). It captures every cost & loss input,
**auto-calculates the actual landed cost per child pack**, and generates child-SKU inventory lines
that can be exported to Excel/CSV for ERP import.

Built with **React + Vite + TypeScript + Tailwind**, installable as a **PWA**, backed by **Supabase**,
deployed to **GitHub Pages**.

> ⚠️ Open prototype: no login, Supabase RLS is permissive (anon read/write). Demo only — do not store sensitive data.

## Live app
`https://jeswin-habibi.github.io/Prototype/` (after the first successful Pages deploy).

## Architecture
See [ARCHITECTURE.md](ARCHITECTURE.md) — the living design doc (data model, cost model, screen
flow, conventions, iteration log). **Keep it updated in the same commit as any structural change.**

## Workflow
1. **Parent Receipt** — upload the GRN Excel/CSV (item code, description, unit, batchID, quantity,
   expiry, unit cost, total value, warehouse).
2. **Repacking Jobs** — create a job for a parent batch (machine + operator dropdowns; date/time and
   `Created` status captured automatically).
3. **Job screen** — plan the output mix → **Start Processing** (captures start time) → enter actual
   packs → **Complete Processing** (captures end time) → record wastage → view Output Summary &
   Costing → **Generate Child SKUs**.
4. **Records** — child SKU lines; export `.xlsx` / `.csv` for ERP import.
5. **Dashboard** — yield %, wastage %, cost per pack, QC trend, variance by machine/shift/operator,
   month-on-month efficiency.
6. **Config** — admin masters (employees, machines, pack sizes, wastage reasons) + costing rates.

## Cost model
Packaging is charged **direct per pack size**; parent material + machine + labor are spread across
good output **by weight**:

```
spread_per_gram     = (parent_material + machine_cost + labor_cost) / total_good_output_g
cost_per_pack[size] = spread_per_gram * pack_size_g + packaging_per_unit[size]
```

Per-pack costs sum back exactly to total batch cost (asserted in `src/lib/cost.test.ts`).

## Local setup
```bash
npm install
cp .env.example .env        # fill VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

### Supabase
1. Create a project at supabase.com.
2. SQL editor → run `supabase/schema.sql` (creates tables, seeds masters, sets open RLS).
3. Settings → API → copy Project URL + anon key into `.env`.

### Deploy (GitHub Pages)
- In repo **Settings → Pages**, set Source = **GitHub Actions**.
- In **Settings → Secrets and variables → Actions**, add `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`.
- Push to `main` → the `Deploy to GitHub Pages` workflow builds and publishes.

### Install on mobile
Open the live URL in Chrome → menu → **Add to Home screen**.

## Scripts
- `npm run dev` — local dev server
- `npm run build` — type-check + production build (also generates PWA icons)
- `npm run test` — unit tests (cost math)
