-- Repacking & Landed-Cost Prototype — Supabase schema
-- Run this in the Supabase SQL editor (one-time). Open prototype: permissive RLS.

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

-- ─────────────────────────── Transactional ───────────────────────────
create table if not exists parent_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null,
  description text not null default '',
  unit text not null default 'g',            -- 'kg' | 'g'
  batch_id text not null,
  quantity numeric not null default 0,
  expiry_date date,
  unit_cost numeric not null default 0,
  total_value numeric not null default 0,
  warehouse_name text not null default '',
  received_at timestamptz not null default now()
);

create table if not exists repack_jobs (
  id uuid primary key default gen_random_uuid(),
  parent_item_id uuid not null references parent_items(id) on delete cascade,
  machine_code text not null,
  operator_code text not null,
  status text not null default 'Created',     -- Created | Processing | Completed
  shift text,
  created_at timestamptz not null default now(),
  start_at timestamptz,
  complete_at timestamptz
);

create table if not exists job_pack_sizes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references repack_jobs(id) on delete cascade,
  pack_size_g numeric not null,
  expected_packs numeric not null default 0,
  expected_output_g numeric not null default 0,
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
  parent_item_id uuid not null references parent_items(id) on delete cascade,
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

-- ───────────────────────────── Seed masters ─────────────────────────────
insert into employees (code, name) values
  ('EMP001', 'Mohammed'), ('EMP002', 'Kiran'), ('EMP003', 'Jobi')
on conflict (code) do nothing;

insert into machines (code, name) values
  ('Machine 1', 'Machine 1'), ('Machine 2', 'Machine 2'),
  ('Machine 3', 'Machine 3'), ('Machine 4', 'Machine 4')
on conflict (code) do nothing;

insert into pack_sizes (grams, label) values
  (50, '50g'), (100, '100g'), (250, '250g')
on conflict (grams) do nothing;

insert into wastage_reasons (name) values
  ('QC Rejects'), ('Shrinkage'), ('Human Error Loss'), ('Machine Loss')
on conflict (name) do nothing;

insert into packaging_costs (pack_size_g, cost_per_unit) values
  (50, 0.50), (100, 0.80), (250, 1.50)
on conflict (pack_size_g) do nothing;

insert into costing_config (machine_cost_per_hour, labor_cost_per_hour)
select 50, 30
where not exists (select 1 from costing_config);

-- ───────────────────────────── RLS (open prototype) ─────────────────────────────
-- WARNING: anon full access. Demo only — do not store sensitive data.
do $$
declare t text;
begin
  foreach t in array array[
    'employees','machines','pack_sizes','wastage_reasons','costing_config','packaging_costs',
    'parent_items','repack_jobs','job_pack_sizes','job_wastage','child_skus'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists open_all on %I', t);
    execute format(
      'create policy open_all on %I for all to anon, authenticated using (true) with check (true)', t
    );
  end loop;
end $$;
