-- Repacking & Landed-Cost Prototype — Supabase schema
-- Run this in the Supabase SQL editor. Idempotent: safe to re-run (create-if-not-exists /
-- add-column-if-not-exists). Open prototype: permissive RLS (auth/roles arrive in Phase 5).
--
-- Restructure (multi-parent blends): the model is being re-based on
--   inputs-as-a-list (job_parents) + a declared output product (parent_child_map).
-- New columns are added ALONGSIDE legacy ones so screens migrate phase-by-phase without breaking.

-- ───────────────────────────── Masters ─────────────────────────────
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);

create table if not exists machines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  cost_per_hour_override numeric,
  active boolean not null default true
);

create table if not exists pack_sizes (
  id uuid primary key default gen_random_uuid(),
  grams numeric not null unique,
  label text not null,
  active boolean not null default true
);

create table if not exists wastage_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table if not exists costing_config (
  id uuid primary key default gen_random_uuid(),
  machine_cost_per_hour numeric not null default 0,
  labor_cost_per_hour numeric not null default 0
);

create table if not exists packaging_costs (
  id uuid primary key default gen_random_uuid(),
  pack_size_g numeric not null unique,
  cost_per_unit numeric not null default 0
);

-- Parent-Child Master: maps a product (parent_code) at a pack size to its child SKU.
-- Blends are simply rows whose parent_code is the blend's own product code.
create table if not exists parent_child_map (
  id uuid primary key default gen_random_uuid(),
  parent_code text not null,
  parent_description text not null default '',
  category text not null default '',
  pack_size_g numeric not null,
  child_code text not null default '',
  child_description text not null default '',
  child_barcode text not null default '',
  active boolean not null default true,
  unique (parent_code, pack_size_g)
);

-- ─────────────────────────── Transactional ───────────────────────────
create table if not exists parent_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null,
  description text not null default '',
  unit text not null default 'g',            -- [legacy] 'kg' | 'g'
  batch_id text not null,
  quantity numeric not null default 0,       -- [legacy] mirror = total weight in grams
  expiry_date date,
  unit_cost numeric not null default 0,      -- [legacy] mirror = cost per gram
  total_value numeric not null default 0,    -- [legacy] mirror = total_cost
  warehouse_name text not null default '',
  received_at timestamptz not null default now()
);
-- New receipt fields (additive). qty = unit count; weight_per_unit + weight_unit define per-unit weight.
alter table parent_items add column if not exists category text not null default '';
alter table parent_items add column if not exists qty numeric not null default 0;
alter table parent_items add column if not exists weight_per_unit numeric not null default 0;
alter table parent_items add column if not exists weight_unit text not null default 'kg';
alter table parent_items add column if not exists total_cost numeric not null default 0;
-- Server-side derived total weight in grams (single source of truth for balances).
alter table parent_items add column if not exists total_weight_g numeric
  generated always as (qty * (case when weight_unit = 'kg' then weight_per_unit * 1000 else weight_per_unit end)) stored;

create table if not exists repack_jobs (
  id uuid primary key default gen_random_uuid(),
  parent_item_id uuid references parent_items(id) on delete cascade,  -- [legacy] single-parent link
  machine_code text,
  operator_code text not null,
  status text not null default 'Created',     -- Created | Processing | On Hold | Completed
  shift text,
  created_at timestamptz not null default now(),
  start_at timestamptz,
  complete_at timestamptz
);
alter table repack_jobs alter column parent_item_id drop not null;
alter table repack_jobs alter column machine_code drop not null;
alter table repack_jobs add column if not exists process_type text not null default 'Machine';  -- Machine | Manual
alter table repack_jobs add column if not exists output_product_code text;
alter table repack_jobs add column if not exists active_seconds numeric;  -- cached active duration at completion

-- Inputs-as-a-list: one row per parent batch consumed by a job.
create table if not exists job_parents (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  parent_item_id uuid not null references parent_items(id) on delete cascade,
  required_weight_g numeric not null default 0,
  material_cost numeric not null default 0
);

-- Start / Hold / Resume / Stop audit trail → active processing time.
create table if not exists job_time_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  event_type text not null,                  -- start | hold | resume | stop
  at timestamptz not null default now()
);

create table if not exists job_pack_sizes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  pack_size_g numeric not null,
  expected_packs numeric not null default 0,    -- [legacy] planned output (being retired)
  expected_output_g numeric not null default 0, -- [legacy]
  actual_packs numeric,
  actual_output_g numeric
);

create table if not exists job_wastage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  reason text not null,
  grams numeric not null default 0
);

create table if not exists child_skus (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  parent_item_id uuid references parent_items(id) on delete cascade,  -- [legacy] nullable for blends
  child_item_code text not null,
  description text not null default '',
  unit text not null default 'pack',
  batch_id text not null,
  pack_size_g numeric not null,
  quantity numeric not null default 0,
  expiry_date date,
  unit_cost numeric not null default 0,
  total_value numeric not null default 0,
  warehouse_name text not null default '',
  created_at timestamptz not null default now()
);
alter table child_skus add column if not exists category text not null default '';
alter table child_skus add column if not exists child_barcode text not null default '';
alter table child_skus add column if not exists output_product_code text;
alter table child_skus alter column parent_item_id drop not null;  -- legacy link; primary input is set, but allow null

-- Frozen per-job cost result (written at "Generate Child SKUs"); the dashboard reads these
-- instead of recomputing history over every row.
create table if not exists job_cost_snapshot (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references repack_jobs(id) on delete cascade,
  process_type text not null default 'Machine',
  output_product_code text,
  completed_on date,
  shift text,
  input_weight_g numeric not null default 0,
  output_weight_g numeric not null default 0,
  yield_pct numeric not null default 0,
  lost_yield_pct numeric not null default 0,
  wastage_g numeric not null default 0,
  packs_produced numeric not null default 0,
  active_seconds numeric not null default 0,
  total_material_cost numeric not null default 0,
  machine_cost numeric not null default 0,
  labor_cost numeric not null default 0,
  packaging_cost numeric not null default 0,
  total_batch_cost numeric not null default 0,
  created_at timestamptz not null default now()
);

-- ───────────────────────────── Indexes (scale) ─────────────────────────────
create index if not exists idx_repack_jobs_status_complete on repack_jobs (status, complete_at);
create index if not exists idx_job_parents_parent on job_parents (parent_item_id);
create index if not exists idx_job_parents_job on job_parents (job_id);
create index if not exists idx_job_time_events_job on job_time_events (job_id);
create index if not exists idx_child_skus_created on child_skus (created_at);
create index if not exists idx_child_skus_output on child_skus (output_product_code);
create index if not exists idx_parent_items_code on parent_items (item_code);
create index if not exists idx_parent_items_expiry on parent_items (expiry_date);
create index if not exists idx_cost_snapshot_completed on job_cost_snapshot (completed_on);

-- ───────────────────────────── Seed masters ─────────────────────────────
insert into employees (code, name) values
  ('EMP001', 'Mohammed'), ('EMP002', 'Kiran'), ('EMP003', 'Jobi')
on conflict (code) do nothing;

insert into machines (code, name) values
  ('Machine 1', 'Machine 1'), ('Machine 2', 'Machine 2'),
  ('Machine 3', 'Machine 3'), ('Machine 4', 'Machine 4')
on conflict (code) do nothing;

insert into pack_sizes (grams, label) values
  (20, '20g'), (50, '50g'), (100, '100g'), (250, '250g')
on conflict (grams) do nothing;

insert into wastage_reasons (name) values
  ('QC Rejects'), ('Shrinkage'), ('Human Error Loss'), ('Machine Loss')
on conflict (name) do nothing;

insert into packaging_costs (pack_size_g, cost_per_unit) values
  (20, 0.30), (50, 0.50), (100, 0.80), (250, 1.50)
on conflict (pack_size_g) do nothing;

insert into costing_config (machine_cost_per_hour, labor_cost_per_hour)
select 50, 30
where not exists (select 1 from costing_config);

-- ───────────────────────────── RLS (open prototype) ─────────────────────────────
-- WARNING: anon full access. Demo only — do not store sensitive data. Locked down in Phase 5.
do $$
declare t text;
begin
  foreach t in array array[
    'employees','machines','pack_sizes','wastage_reasons','costing_config','packaging_costs',
    'parent_child_map','parent_items','repack_jobs','job_parents','job_time_events',
    'job_pack_sizes','job_wastage','child_skus','job_cost_snapshot'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists open_all on %I', t);
    execute format(
      'create policy open_all on %I for all to anon, authenticated using (true) with check (true)', t
    );
  end loop;
end $$;
