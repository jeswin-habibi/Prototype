import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { money, num, pct } from '../lib/format'
import type { JobCostSnapshot, JobStatus, ProcessType } from '../types'
import { Empty, PageHeader, Section, Spinner } from '../components/ui'

const COLORS = ['#0f766e', '#14b8a6', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899', '#22c55e']

type ChildRow = {
  pack_size_g: number; quantity: number; unit_cost: number; total_value: number
  child_item_code: string; output_product_code: string | null; category: string; created_at: string
}
type WasteRow = {
  grams: number; reason: string
  job: { process_type: ProcessType; output_product_code: string | null; complete_at: string | null; status: JobStatus } | null
}
interface Bundle {
  snaps: JobCostSnapshot[]; children: ChildRow[]; wastage: WasteRow[]; statusCounts: Record<JobStatus, number>
}
type Granularity = 'day' | 'month' | 'year'
type Tab = 'Overview' | 'Production' | 'Cost' | 'Wastage' | 'Time'
const TABS: Tab[] = ['Overview', 'Production', 'Cost', 'Wastage', 'Time']

export default function Dashboard() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [gran, setGran] = useState<Granularity>('month')
  const [tab, setTab] = useState<Tab>('Overview')
  const [drillOutput, setDrillOutput] = useState<number | null>(null)
  const [drillCost, setDrillCost] = useState<number | null>(null)

  const { data, loading } = useData<Bundle>(async () => {
    const range = <T extends { gte: (c: string, v: string) => T; lte: (c: string, v: string) => T }>(q: T, col: string, hiSuffix = '') => {
      let r = q
      if (from) r = r.gte(col, from)
      if (to) r = r.lte(col, to + hiSuffix)
      return r
    }
    const countStatus = (s: JobStatus) => supabase.from('repack_jobs').select('id', { count: 'exact', head: true }).eq('status', s)
    const [snapRes, childRes, wasteRes, cCreated, cProcessing, cHold, cCompleted] = await Promise.all([
      range(supabase.from('job_cost_snapshot').select('*'), 'completed_on'),
      range(supabase.from('child_skus').select('pack_size_g, quantity, unit_cost, total_value, child_item_code, output_product_code, category, created_at'), 'created_at', 'T23:59:59'),
      supabase.from('job_wastage').select('grams, reason, job:repack_jobs(process_type, output_product_code, complete_at, status)'),
      countStatus('Created'), countStatus('Processing'), countStatus('On Hold'), countStatus('Completed'),
    ])
    return {
      snaps: (snapRes.data ?? []) as JobCostSnapshot[],
      children: (childRes.data ?? []) as ChildRow[],
      wastage: (wasteRes.data ?? []) as unknown as WasteRow[],
      statusCounts: { Created: cCreated.count ?? 0, Processing: cProcessing.count ?? 0, 'On Hold': cHold.count ?? 0, Completed: cCompleted.count ?? 0 },
    }
  }, [from, to])

  const m = useMemo(() => (data ? computeMetrics(data, gran, from, to) : null), [data, gran, from, to])

  const trendCard = (
    <Section
      title="Production trend"
      actions={
        <select className="input max-w-[120px]" value={gran} onChange={(e) => setGran(e.target.value as Granularity)}>
          <option value="day">Daily</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
      }
    >
      {!m || m.trend.length === 0 ? <Empty>No completed jobs in range.</Empty> : (
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={m.trend} margin={{ left: -10, right: 8, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line yAxisId="l" type="monotone" dataKey="outputKg" name="Output (kg)" stroke="#0f766e" strokeWidth={2.5} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="yield" name="Yield %" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Section>
  )

  return (
    <div>
      <PageHeader title="Dashboard" />

      {/* Date filter — own row, fixed layout (Clear always present so nothing reflows) */}
      <div className="mb-4 flex max-w-md items-end gap-2">
        <div className="min-w-0 flex-1">
          <label className="label">From</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="min-w-0 flex-1">
          <label className="label">To</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-secondary shrink-0" onClick={() => { setFrom(''); setTo('') }} disabled={!from && !to}>
          Clear
        </button>
      </div>

      {loading || !m ? (
        <Spinner />
      ) : (
        <>
          {/* Compact KPI tiles — 4-up, dense, abbreviated values */}
          <div className="mb-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            <Kpi label="In (kg)" value={num(Math.round(m.inputKg))} />
            <Kpi label="Out (kg)" value={num(Math.round(m.outputKg))} />
            <Kpi label="Yield" value={pct(m.avgYield)} tone={m.avgYield >= 90 ? 'good' : m.avgYield >= 75 ? 'warn' : 'bad'} />
            <Kpi label="Waste" value={pct(m.avgWastePct)} tone={m.avgWastePct <= 5 ? 'good' : 'warn'} />
            <Kpi label="Wastage" value={`${num(Math.round(m.totalWastageKg))}kg`} />
            <Kpi label="Packs" value={compact(m.packsProduced)} />
            <Kpi label="Value" value={compact(m.outputValue)} />
            <Kpi label="Done" value={num(m.statusCounts.Completed)} tone="good" />
          </div>

          {/* Status pipeline — Created = total jobs; others = current status */}
          <div className="mb-4 flex divide-x divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
            <Pipe label="Created" n={m.statusCounts.Created + m.statusCounts.Processing + m.statusCounts['On Hold'] + m.statusCounts.Completed} />
            <Pipe label="Processing" n={m.statusCounts.Processing} tone="text-amber-600" />
            <Pipe label="On Hold" n={m.statusCounts['On Hold']} tone="text-orange-600" />
            <Pipe label="Completed" n={m.statusCounts.Completed} tone="text-emerald-600" />
          </div>

          {/* Tab bar */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-soft">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${tab === t ? 'bg-gradient-to-br from-brand-light to-brand text-white shadow-soft' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content (each tab = 1–2 full-width charts → little scrolling) */}
          {tab === 'Overview' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {trendCard}
              <Section title="Output by pack size"><Bars data={m.outputBySize} xKey="label" yKey="packs" yLabel="packs" /></Section>
            </div>
          )}

          {tab === 'Production' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title={drillOutput == null ? 'Output by pack size' : `Output — ${drillOutput}g by child (high → low)`}>
                {drillOutput != null && <button className="mb-2 text-sm text-brand hover:underline" onClick={() => setDrillOutput(null)}>← All sizes</button>}
                <Bars data={drillOutput == null ? m.outputBySize : (m.outputDrill[drillOutput] ?? [])} xKey="label" yKey="packs" yLabel="packs" onBarClick={drillOutput == null ? (e) => setDrillOutput(Number(e.size)) : undefined} />
                {drillOutput == null && <p className="mt-1 text-xs text-slate-400">Tap a bar to drill into child items.</p>}
              </Section>
              {trendCard}
            </div>
          )}

          {tab === 'Cost' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title={drillCost == null ? 'Cost per pack by size' : `Cost / pack — ${drillCost}g by child`}>
                {drillCost != null && <button className="mb-2 text-sm text-brand hover:underline" onClick={() => setDrillCost(null)}>← All sizes</button>}
                <Bars data={drillCost == null ? m.costBySize : (m.costDrill[drillCost] ?? [])} xKey="label" yKey="cost" yLabel="cost/pack" money onBarClick={drillCost == null ? (e) => setDrillCost(Number(e.size)) : undefined} />
                {drillCost == null && <p className="mt-1 text-xs text-slate-400">Tap a bar to drill into child items.</p>}
              </Section>
              <Section title="Manual vs Machine">
                <ProcessTable rows={m.byProcess} />
              </Section>
            </div>
          )}

          {tab === 'Wastage' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Wastage by reason">
                {m.wastageByReason.length === 0 ? <Empty>No wastage in range.</Empty> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={m.wastageByReason} dataKey="grams" nameKey="reason" cx="50%" cy="44%" outerRadius={72}>
                        {m.wastageByReason.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${num(v)} g`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </Section>
              <Section title="Wastage: Manual vs Machine"><Bars data={m.wastageByProcess} xKey="label" yKey="grams" yLabel="grams" /></Section>
              <Section title="Wastage by parent"><Bars data={m.wastageByParent} xKey="label" yKey="grams" yLabel="grams" /></Section>
              <Section title="Wastage by category"><Bars data={m.wastageByCategory} xKey="label" yKey="grams" yLabel="grams" /></Section>
            </div>
          )}

          {tab === 'Time' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section title="Avg production time by parent (min)"><Bars data={m.timeByParent} xKey="label" yKey="minutes" yLabel="min" /></Section>
              <Section title="Avg production time by category (min)"><Bars data={m.timeByCategory} xKey="label" yKey="minutes" yLabel="min" /></Section>
              <Section title="Manual vs Machine"><ProcessTable rows={m.byProcess} /></Section>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const t = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white px-2 py-1.5 shadow-soft">
      <div className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`truncate text-[13px] font-extrabold leading-tight sm:text-base ${t}`}>{value}</div>
    </div>
  )
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return `${Math.round(n)}`
}

function Pipe({ label, n, tone = 'text-slate-700' }: { label: string; n: number; tone?: string }) {
  return (
    <div className="flex-1 px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-lg font-extrabold ${tone}`}>{num(n)}</div>
    </div>
  )
}

function ProcessTable({ rows }: { rows: { type: string; jobs: number; avgYield: number; avgMinutes: number; costPerPack: number; outputKg: number }[] }) {
  if (rows.length === 0) return <Empty>No completed jobs in range.</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200">
            <th className="th">Type</th><th className="th">Jobs</th><th className="th">Yield</th><th className="th">Time</th><th className="th">Cost/pack</th><th className="th">Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} className="border-b border-slate-100">
              <td className="td font-medium">{r.type}</td>
              <td className="td">{num(r.jobs)}</td>
              <td className="td">{pct(r.avgYield)}</td>
              <td className="td">{num(Math.round(r.avgMinutes))}m</td>
              <td className="td">{money(r.costPerPack, 3)}</td>
              <td className="td">{num(Math.round(r.outputKg))}kg</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Bars({
  data, xKey, yKey, yLabel, money: isMoney, onBarClick,
}: {
  data: Record<string, unknown>[]; xKey: string; yKey: string; yLabel: string; money?: boolean
  onBarClick?: (entry: Record<string, unknown>) => void
}) {
  if (data.length === 0) return <Empty>No data in range.</Empty>
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ left: -12, right: 8, top: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={54} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v: number) => (isMoney ? money(v, 4) : `${num(v)} ${yLabel}`)} />
        <Bar dataKey={yKey} radius={[4, 4, 0, 0]} cursor={onBarClick ? 'pointer' : undefined}
          onClick={onBarClick ? (e: unknown) => onBarClick((e as { payload: Record<string, unknown> }).payload) : undefined}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ───────────────────────── aggregation ─────────────────────────
function avg(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0 }

function computeMetrics(d: Bundle, gran: Granularity, from: string, to: string) {
  const snaps = d.snaps
  const catByProduct: Record<string, string> = {}
  for (const c of d.children) if (c.output_product_code && c.category && !catByProduct[c.output_product_code]) catByProduct[c.output_product_code] = c.category

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  const inputG = sum(snaps.map((s) => Number(s.input_weight_g)))
  const outputG = sum(snaps.map((s) => Number(s.output_weight_g)))
  const totalWastageG = sum(snaps.map((s) => Number(s.wastage_g)))

  const sizeAgg = new Map<number, { packs: number; value: number }>()
  const outputDrill: Record<number, { label: string; packs: number; size: number }[]> = {}
  const costDrill: Record<number, { label: string; cost: number; size: number }[]> = {}
  const sizeChild = new Map<number, Map<string, { packs: number; value: number }>>()
  for (const c of d.children) {
    const size = Number(c.pack_size_g)
    const a = sizeAgg.get(size) ?? { packs: 0, value: 0 }
    a.packs += Number(c.quantity); a.value += Number(c.total_value)
    sizeAgg.set(size, a)
    const cm = sizeChild.get(size) ?? new Map()
    const cc = cm.get(c.child_item_code) ?? { packs: 0, value: 0 }
    cc.packs += Number(c.quantity); cc.value += Number(c.total_value)
    cm.set(c.child_item_code, cc); sizeChild.set(size, cm)
  }
  const sizes = [...sizeAgg.keys()].sort((a, b) => a - b)
  const outputBySize = sizes.map((s) => ({ label: `${s}g`, packs: sizeAgg.get(s)!.packs, size: s }))
  const costBySize = sizes.map((s) => { const a = sizeAgg.get(s)!; return { label: `${s}g`, cost: a.packs ? a.value / a.packs : 0, size: s } })
  for (const s of sizes) {
    const entries = [...(sizeChild.get(s) ?? new Map()).entries()] as [string, { packs: number; value: number }][]
    outputDrill[s] = entries.map(([code, v]) => ({ label: code, packs: v.packs, size: s })).sort((a, b) => b.packs - a.packs)
    costDrill[s] = entries.map(([code, v]) => ({ label: code, cost: v.packs ? v.value / v.packs : 0, size: s })).sort((a, b) => b.cost - a.cost)
  }

  const inRange = (isoStr: string | null) => {
    if (!isoStr) return false
    const day = isoStr.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  }
  const waste = d.wastage.filter((w) => w.job && w.job.status === 'Completed' && inRange(w.job.complete_at))
  const groupSum = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => {
    const map = new Map<string, number>()
    for (const r of rows) map.set(key(r), (map.get(key(r)) ?? 0) + val(r))
    return [...map.entries()].map(([label, grams]) => ({ label, grams })).sort((a, b) => b.grams - a.grams)
  }
  const wastageByReason = groupSum(waste, (w) => w.reason || 'Unknown', (w) => Number(w.grams)).map((r) => ({ reason: r.label, grams: r.grams }))
  const wastageByProcess = groupSum(waste, (w) => w.job!.process_type, (w) => Number(w.grams))
  const wastageByParent = groupSum(waste, (w) => w.job!.output_product_code ?? '—', (w) => Number(w.grams)).slice(0, 12)
  const wastageByCategory = groupSum(waste, (w) => catByProduct[w.job!.output_product_code ?? ''] ?? 'Uncategorized', (w) => Number(w.grams))

  const keyOf = (s: JobCostSnapshot) => {
    const day = (s.completed_on ?? '').slice(0, 10)
    return gran === 'year' ? day.slice(0, 4) : gran === 'month' ? day.slice(0, 7) : day
  }
  const trendMap = new Map<string, { outG: number; yields: number[] }>()
  for (const s of snaps) {
    const k = keyOf(s) || '—'
    const t = trendMap.get(k) ?? { outG: 0, yields: [] }
    t.outG += Number(s.output_weight_g); t.yields.push(Number(s.yield_pct)); trendMap.set(k, t)
  }
  const trend = [...trendMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, v]) => ({ key, outputKg: Number((v.outG / 1000).toFixed(1)), yield: Number(avg(v.yields).toFixed(1)) }))

  const timeGroup = (key: (s: JobCostSnapshot) => string) => {
    const map = new Map<string, number[]>()
    for (const s of snaps) { const k = key(s); map.set(k, [...(map.get(k) ?? []), Number(s.active_seconds) / 60]) }
    return [...map.entries()].map(([label, mins]) => ({ label, minutes: Number(avg(mins).toFixed(1)) })).sort((a, b) => b.minutes - a.minutes).slice(0, 12)
  }
  const timeByParent = timeGroup((s) => s.output_product_code ?? '—')
  const timeByCategory = timeGroup((s) => catByProduct[s.output_product_code ?? ''] ?? 'Uncategorized')

  const byProcessMap = new Map<ProcessType, JobCostSnapshot[]>()
  for (const s of snaps) byProcessMap.set(s.process_type, [...(byProcessMap.get(s.process_type) ?? []), s])
  const byProcess = [...byProcessMap.entries()].map(([type, rows]) => {
    const packs = sum(rows.map((r) => Number(r.packs_produced)))
    return {
      type, jobs: rows.length, avgYield: avg(rows.map((r) => Number(r.yield_pct))), avgMinutes: avg(rows.map((r) => Number(r.active_seconds) / 60)),
      costPerPack: packs ? sum(rows.map((r) => Number(r.total_batch_cost))) / packs : 0, outputKg: sum(rows.map((r) => Number(r.output_weight_g))) / 1000,
    }
  })

  return {
    inputKg: inputG / 1000, outputKg: outputG / 1000, avgYield: avg(snaps.map((s) => Number(s.yield_pct))),
    avgWastePct: inputG ? (totalWastageG / inputG) * 100 : 0, totalWastageKg: totalWastageG / 1000,
    packsProduced: sum(snaps.map((s) => Number(s.packs_produced))), outputValue: sum(snaps.map((s) => Number(s.total_batch_cost))),
    statusCounts: d.statusCounts, outputBySize, costBySize, outputDrill, costDrill,
    wastageByReason, wastageByProcess, wastageByParent, wastageByCategory, trend, timeByParent, timeByCategory, byProcess,
  }
}
