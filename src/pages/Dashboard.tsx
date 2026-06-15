import { useMemo, type ReactElement } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { toGrams } from '../lib/units'
import { money, num, pct } from '../lib/format'
import type { ChildSku, JobPackSize, JobWastage, ParentItem, RepackJob } from '../types'
import { Empty, PageHeader, Section, Spinner, Stat } from '../components/ui'

interface Bundle {
  parents: ParentItem[]
  jobs: (RepackJob & { parent: ParentItem })[]
  packLines: JobPackSize[]
  wastage: JobWastage[]
  children: ChildSku[]
}

const COLORS = ['#0f766e', '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899']

export default function Dashboard() {
  const { data, loading } = useData<Bundle>(async () => {
    const [parents, jobs, packLines, wastage, children] = await Promise.all([
      supabase.from('parent_items').select('*'),
      supabase.from('repack_jobs').select('*, parent:parent_items(*)'),
      supabase.from('job_pack_sizes').select('*'),
      supabase.from('job_wastage').select('*'),
      supabase.from('child_skus').select('*'),
    ])
    return {
      parents: parents.data ?? [],
      jobs: (jobs.data ?? []) as Bundle['jobs'],
      packLines: packLines.data ?? [],
      wastage: wastage.data ?? [],
      children: children.data ?? [],
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
        <Stat label="Parents received" value={num(m.parentCount)} sub={`${num(Math.round(m.parentWeightG / 1000))} kg`} />
        <Stat label="Jobs finalized" value={num(m.completedCount)} sub={`${num(m.jobsTotal)} total jobs`} />
        <Stat label="Avg yield" value={pct(m.avgYield)} tone={m.avgYield >= 90 ? 'good' : m.avgYield >= 75 ? 'warn' : 'bad'} />
        <Stat label="Avg wastage" value={pct(m.avgWastage)} tone={m.avgWastage <= 5 ? 'good' : 'warn'} />
        <Stat label="Packs produced" value={num(m.totalPacks)} />
        <Stat label="Output value" value={money(m.totalValue)} />
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

        <Section title="Month-on-Month Yield & QC Rejects">
          <Chart empty={m.monthly.length === 0}>
            <LineChart data={m.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" fontSize={12} />
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
function computeMetrics(d: Bundle) {
  const linesByJob = new Map<string, JobPackSize[]>()
  for (const l of d.packLines) {
    const arr = linesByJob.get(l.job_id) ?? []
    arr.push(l)
    linesByJob.set(l.job_id, arr)
  }
  const wasteByJob = new Map<string, number>()
  const qcByJob = new Map<string, number>()
  for (const w of d.wastage) {
    wasteByJob.set(w.job_id, (wasteByJob.get(w.job_id) ?? 0) + Number(w.grams))
    if (/qc/i.test(w.reason)) qcByJob.set(w.job_id, (qcByJob.get(w.job_id) ?? 0) + Number(w.grams))
  }

  // Only reflect jobs whose child SKU records have been generated.
  const jobsWithChildren = new Set(d.children.map((c) => c.job_id))
  const completed = d.jobs.filter((j) => j.status === 'Completed' && j.parent && jobsWithChildren.has(j.id))
  const perJob = completed.map((j) => {
    const inputG = toGrams(j.parent.quantity, j.parent.unit)
    const outputG = (linesByJob.get(j.id) ?? []).reduce((s, l) => s + Number(l.actual_output_g ?? 0), 0)
    return {
      id: j.id,
      machine: j.machine_code,
      operator: j.operator_code,
      shift: j.shift ?? '—',
      month: (j.complete_at ?? j.created_at).slice(0, 7),
      yield: inputG ? (outputG / inputG) * 100 : 0,
      wastagePct: inputG ? ((wasteByJob.get(j.id) ?? 0) / inputG) * 100 : 0,
      qc: qcByJob.get(j.id) ?? 0,
    }
  })

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const groupYield = (keyFn: (p: (typeof perJob)[number]) => string) => {
    const g = new Map<string, number[]>()
    for (const p of perJob) {
      const k = keyFn(p)
      g.set(k, [...(g.get(k) ?? []), p.yield])
    }
    return [...g.entries()].map(([key, ys]) => ({ key, yield: avg(ys), jobs: ys.length })).sort((a, b) => a.key.localeCompare(b.key))
  }

  // output & cost by pack size from child SKUs
  const sizeAgg = new Map<number, { packs: number; costSum: number; costN: number }>()
  for (const c of d.children) {
    const s = sizeAgg.get(Number(c.pack_size_g)) ?? { packs: 0, costSum: 0, costN: 0 }
    s.packs += Number(c.quantity)
    s.costSum += Number(c.unit_cost)
    s.costN += 1
    sizeAgg.set(Number(c.pack_size_g), s)
  }
  const outputBySize = [...sizeAgg.entries()].sort((a, b) => a[0] - b[0]).map(([size, v]) => ({ size: `${size}g`, packs: v.packs }))
  const costBySize = [...sizeAgg.entries()].sort((a, b) => a[0] - b[0]).map(([size, v]) => ({ size: `${size}g`, cost: v.costN ? v.costSum / v.costN : 0 }))

  const wasteReasonAgg = new Map<string, number>()
  for (const w of d.wastage) wasteReasonAgg.set(w.reason, (wasteReasonAgg.get(w.reason) ?? 0) + Number(w.grams))
  const wastageByReason = [...wasteReasonAgg.entries()].map(([reason, grams]) => ({ reason, grams }))

  // monthly yield + QC
  const monthAgg = new Map<string, { ys: number[]; qc: number }>()
  for (const p of perJob) {
    const cur = monthAgg.get(p.month) ?? { ys: [], qc: 0 }
    cur.ys.push(p.yield)
    cur.qc += p.qc
    monthAgg.set(p.month, cur)
  }
  const monthly = [...monthAgg.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({
    month,
    yield: Number(avg(v.ys).toFixed(1)),
    qc: v.qc,
  }))

  return {
    parentCount: d.parents.length,
    parentWeightG: d.parents.reduce((s, p) => s + toGrams(p.quantity, p.unit), 0),
    jobsTotal: d.jobs.length,
    completedCount: completed.length,
    avgYield: avg(perJob.map((p) => p.yield)),
    avgWastage: avg(perJob.map((p) => p.wastagePct)),
    totalPacks: d.children.reduce((s, c) => s + Number(c.quantity), 0),
    totalValue: d.children.reduce((s, c) => s + Number(c.total_value), 0),
    outputBySize,
    costBySize,
    wastageByReason,
    monthly,
    byMachine: groupYield((p) => p.machine),
    byOperator: groupYield((p) => p.operator),
    byShift: groupYield((p) => p.shift),
  }
}
