import { useMemo, type ReactElement } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { toGrams } from '../lib/units'
import { calculateCost, hoursBetween } from '../lib/cost'
import { money, num, pct } from '../lib/format'
import type { CostingConfig, JobPackSize, JobWastage, Machine, PackagingCost, ParentItem, RepackJob } from '../types'
import { Empty, PageHeader, Section, Spinner, Stat } from '../components/ui'

interface Bundle {
  parents: ParentItem[]
  jobs: (RepackJob & { parent: ParentItem })[]
  packLines: JobPackSize[]
  wastage: JobWastage[]
  config: CostingConfig
  packagingCosts: PackagingCost[]
  machines: Machine[]
}

const COLORS = ['#0f766e', '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899']

export default function Dashboard() {
  const { data, loading } = useData<Bundle>(async () => {
    const [parents, jobs, packLines, wastage, cfg, pc, machines] = await Promise.all([
      supabase.from('parent_items').select('*'),
      supabase.from('repack_jobs').select('*, parent:parent_items(*)'),
      supabase.from('job_pack_sizes').select('*'),
      supabase.from('job_wastage').select('*'),
      supabase.from('costing_config').select('*').limit(1).maybeSingle(),
      supabase.from('packaging_costs').select('*'),
      supabase.from('machines').select('*'),
    ])
    return {
      parents: parents.data ?? [],
      jobs: (jobs.data ?? []) as Bundle['jobs'],
      packLines: packLines.data ?? [],
      wastage: wastage.data ?? [],
      config: (cfg.data as CostingConfig) ?? { id: '', machine_cost_per_hour: 0, labor_cost_per_hour: 0 },
      packagingCosts: pc.data ?? [],
      machines: machines.data ?? [],
    }
  }, [])

  const m = useMemo(() => (data ? computeMetrics(data) : null), [data])

  if (loading) return <Spinner />
  if (!m) return <Empty>No data.</Empty>

  return (
    <div>
      <PageHeader title="Owner Dashboard" subtitle="Repacking efficiency, cost and margin-leak at a glance." />

      {/* KPI strip */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat icon="📦" valueClassName="text-xl" label="Parents received" value={num(m.parentCount)} sub={`${num(Math.round(m.parentWeightG / 1000))} kg`} />
        <Stat icon="✅" valueClassName="text-xl" label="Jobs completed" value={num(m.completedCount)} sub={`${num(m.jobsTotal)} total jobs`} />
        <Stat icon="📈" valueClassName="text-xl" label="Avg yield" value={pct(m.avgYield)} tone={m.avgYield >= 90 ? 'good' : m.avgYield >= 75 ? 'warn' : 'bad'} />
        <Stat icon="🗑️" valueClassName="text-xl" label="Avg wastage" value={pct(m.avgWastage)} tone={m.avgWastage <= 5 ? 'good' : 'warn'} />
        <Stat icon="🧱" valueClassName="text-xl" label="Packs produced" value={num(m.totalPacks)} />
        <Stat icon="💰" valueClassName="text-xl" label="Output value" value={money(m.totalValue)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Output by Pack Size (packs)">
          <Chart empty={m.outputBySize.length === 0}>
            <BarChart data={m.outputBySize}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="size" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip />
              <Bar dataKey="packs" fill="#0f766e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </Chart>
        </Section>

        <Section title="Cost per Pack by Size">
          <Chart empty={m.costBySize.length === 0}>
            <BarChart data={m.costBySize}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="size" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => money(Number(v), 4)} />
              <Bar dataKey="cost" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </Chart>
        </Section>

        <Section title="Wastage Breakdown (g)">
          <Chart empty={m.wastageByReason.length === 0}>
            <PieChart>
              <Pie data={m.wastageByReason} dataKey="grams" nameKey="reason" outerRadius={90} label>
                {m.wastageByReason.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `${num(Number(v))} g`} />
              <Legend />
            </PieChart>
          </Chart>
        </Section>

        <Section title="Daily Yield & QC Rejects">
          <Chart empty={m.daily.length === 0}>
            <LineChart data={m.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} fontSize={12} />
              <YAxis yAxisId="left" fontSize={12} />
              <YAxis yAxisId="right" orientation="right" fontSize={12} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="yield" name="Yield %" stroke="#0f766e" strokeWidth={2} />
              <Line yAxisId="right" type="monotone" dataKey="qc" name="QC rejects (g)" stroke="#ef4444" strokeWidth={2} />
            </LineChart>
          </Chart>
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <VarianceTable title="Variance by Machine" rows={m.byMachine} />
        <VarianceTable title="Variance by Operator" rows={m.byOperator} />
        <VarianceTable title="Variance by Shift" rows={m.byShift} />
      </div>
    </div>
  )
}

function Chart({ children, empty }: { children: ReactElement; empty: boolean }) {
  if (empty) return <Empty>Not enough data yet.</Empty>
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>{children}</ResponsiveContainer>
    </div>
  )
}

function VarianceTable({ title, rows }: { title: string; rows: { key: string; yield: number; jobs: number }[] }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <Empty>No completed jobs.</Empty>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="th">Group</th>
              <th className="th">Jobs</th>
              <th className="th">Avg yield</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-100">
                <td className="td font-medium">{r.key}</td>
                <td className="td">{r.jobs}</td>
                <td className="td">
                  <span className={r.yield >= 90 ? 'text-emerald-600' : r.yield >= 75 ? 'text-amber-600' : 'text-rose-600'}>
                    {pct(r.yield)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ── pure aggregation ────────────────────────────────────────────────────────
// Computed LIVE from source data via the same calculateCost() engine the job
// screen uses, so dashboard and job figures always agree. Reflects every job
// whose status is 'Completed' (independent of child-SKU generation).
function computeMetrics(d: Bundle) {
  const linesByJob = new Map<string, JobPackSize[]>()
  for (const l of d.packLines) {
    const arr = linesByJob.get(l.job_id) ?? []
    arr.push(l)
    linesByJob.set(l.job_id, arr)
  }
  const wasteByJob = new Map<string, JobWastage[]>()
  for (const w of d.wastage) {
    const arr = wasteByJob.get(w.job_id) ?? []
    arr.push(w)
    wasteByJob.set(w.job_id, arr)
  }
  const packCost = (g: number) => Number(d.packagingCosts.find((p) => Number(p.pack_size_g) === Number(g))?.cost_per_unit ?? 0)
  const machineByCode = new Map(d.machines.map((m) => [m.code, m]))

  const completed = d.jobs.filter((j) => j.status === 'Completed' && j.parent)
  const perJob = completed.map((j) => {
    const lines = linesByJob.get(j.id) ?? []
    const ws = wasteByJob.get(j.id) ?? []
    const res = calculateCost({
      parentMaterialCost: Number(j.parent.total_value),
      inputWeightG: toGrams(j.parent.quantity, j.parent.unit),
      machineHours: hoursBetween(j.start_at, j.complete_at),
      machineCostPerHour: machineByCode.get(j.machine_code)?.cost_per_hour_override ?? d.config.machine_cost_per_hour,
      laborCostPerHour: d.config.labor_cost_per_hour,
      packLines: lines.map((l) => ({
        packSizeG: Number(l.pack_size_g),
        actualPacks: Number(l.actual_packs ?? 0),
        packagingPerUnit: packCost(l.pack_size_g),
      })),
      wastage: ws.map((w) => ({ reason: w.reason, grams: Number(w.grams) })),
    })
    return {
      res,
      machine: j.machine_code,
      operator: j.operator_code,
      shift: j.shift ?? '—',
      day: (j.complete_at ?? j.created_at).slice(0, 10),
      qc: ws.filter((w) => /qc/i.test(w.reason)).reduce((s, w) => s + Number(w.grams), 0),
    }
  })

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const groupYield = (keyFn: (p: (typeof perJob)[number]) => string) => {
    const g = new Map<string, number[]>()
    for (const p of perJob) {
      const k = keyFn(p)
      g.set(k, [...(g.get(k) ?? []), p.res.yieldPct])
    }
    return [...g.entries()].map(([key, ys]) => ({ key, yield: avg(ys), jobs: ys.length })).sort((a, b) => a.key.localeCompare(b.key))
  }

  // output (packs) & cost-per-pack by size — live, weighted by packs across completed jobs
  const sizeAgg = new Map<number, { packs: number; costSum: number }>()
  for (const p of perJob) {
    for (const l of p.res.lines) {
      const s = sizeAgg.get(l.packSizeG) ?? { packs: 0, costSum: 0 }
      s.packs += l.actualPacks
      s.costSum += l.lineTotalCost
      sizeAgg.set(l.packSizeG, s)
    }
  }
  const outputBySize = [...sizeAgg.entries()].sort((a, b) => a[0] - b[0]).map(([size, v]) => ({ size: `${size}g`, packs: v.packs }))
  const costBySize = [...sizeAgg.entries()].sort((a, b) => a[0] - b[0]).map(([size, v]) => ({ size: `${size}g`, cost: v.packs ? v.costSum / v.packs : 0 }))

  // wastage breakdown — only completed jobs
  const wasteReasonAgg = new Map<string, number>()
  for (const j of completed) for (const w of wasteByJob.get(j.id) ?? []) wasteReasonAgg.set(w.reason, (wasteReasonAgg.get(w.reason) ?? 0) + Number(w.grams))
  const wastageByReason = [...wasteReasonAgg.entries()].map(([reason, grams]) => ({ reason, grams }))

  // daily yield + QC
  const dayAgg = new Map<string, { ys: number[]; qc: number }>()
  for (const p of perJob) {
    const cur = dayAgg.get(p.day) ?? { ys: [], qc: 0 }
    cur.ys.push(p.res.yieldPct)
    cur.qc += p.qc
    dayAgg.set(p.day, cur)
  }
  const daily = [...dayAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({
    day,
    yield: Number(avg(v.ys).toFixed(1)),
    qc: v.qc,
  }))

  return {
    parentCount: d.parents.length,
    parentWeightG: d.parents.reduce((s, p) => s + toGrams(p.quantity, p.unit), 0),
    jobsTotal: d.jobs.length,
    completedCount: completed.length,
    avgYield: avg(perJob.map((p) => p.res.yieldPct)),
    avgWastage: avg(perJob.map((p) => p.res.wastagePct)),
    totalPacks: perJob.reduce((s, p) => s + p.res.lines.reduce((a, l) => a + l.actualPacks, 0), 0),
    totalValue: perJob.reduce((s, p) => s + p.res.totalBatchCost, 0),
    outputBySize,
    costBySize,
    wastageByReason,
    daily,
    byMachine: groupYield((p) => p.machine),
    byOperator: groupYield((p) => p.operator),
    byShift: groupYield((p) => p.shift),
  }
}
