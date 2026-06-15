import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { useBlockNavigation } from '../lib/navGuard'
import { calculateCost, hoursBetween, type CostResult } from '../lib/cost'
import { childBatchId, childDescription, childItemCode } from '../lib/codes'
import { toGrams, formatWeight } from '../lib/units'
import { dateTime, money, num, pct, shiftFromIso } from '../lib/format'
import type {
  CostingConfig, JobPackSize, JobWastage, Machine, PackSize, PackagingCost, RepackJob, WastageReason,
} from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, Stat, StatusBadge } from '../components/ui'

interface Loaded {
  job: RepackJob
  packSizes: PackSize[]
  wastageReasons: WastageReason[]
  packagingCosts: PackagingCost[]
  config: CostingConfig
  machine: Machine | null
  lines: JobPackSize[]
  wastage: JobWastage[]
  childCount: number
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const [busy, setBusy] = useState(false)

  const { data, loading, error, refresh } = useData<Loaded | null>(async () => {
    if (!id) return null
    const { data: job } = await supabase
      .from('repack_jobs')
      .select('*, parent:parent_items(*)')
      .eq('id', id)
      .single()
    if (!job) return null
    const [ps, wr, pc, cfg, lines, wastage, machines, child] = await Promise.all([
      supabase.from('pack_sizes').select('*').eq('active', true).order('grams'),
      supabase.from('wastage_reasons').select('*').eq('active', true).order('name'),
      supabase.from('packaging_costs').select('*'),
      supabase.from('costing_config').select('*').limit(1).maybeSingle(),
      supabase.from('job_pack_sizes').select('*').eq('job_id', id).order('pack_size_g'),
      supabase.from('job_wastage').select('*').eq('job_id', id),
      supabase.from('machines').select('*').eq('code', (job as RepackJob).machine_code),
      supabase.from('child_skus').select('id', { count: 'exact', head: true }).eq('job_id', id),
    ])
    return {
      job: job as RepackJob,
      packSizes: ps.data ?? [],
      wastageReasons: wr.data ?? [],
      packagingCosts: pc.data ?? [],
      config: (cfg.data as CostingConfig) ?? { id: '', machine_cost_per_hour: 0, labor_cost_per_hour: 0 },
      machine: (machines.data?.[0] as Machine) ?? null,
      lines: lines.data ?? [],
      wastage: wastage.data ?? [],
      childCount: child.count ?? 0,
    }
  }, [id])

  // ── derived cost result ────────────────────────────────────────────────
  const result = useMemo<CostResult | null>(() => {
    if (!data?.job.parent) return null
    const parent = data.job.parent
    const inputWeightG = toGrams(parent.quantity, parent.unit)
    const machineRate = data.machine?.cost_per_hour_override ?? data.config.machine_cost_per_hour
    const packCost = (g: number) => data.packagingCosts.find((p) => Number(p.pack_size_g) === Number(g))?.cost_per_unit ?? 0
    return calculateCost({
      parentMaterialCost: parent.total_value,
      inputWeightG,
      machineHours: hoursBetween(data.job.start_at, data.job.complete_at),
      machineCostPerHour: machineRate,
      laborCostPerHour: data.config.labor_cost_per_hour,
      packLines: data.lines.map((l) => ({
        packSizeG: Number(l.pack_size_g),
        actualPacks: Number(l.actual_packs ?? 0),
        packagingPerUnit: packCost(l.pack_size_g),
      })),
      wastage: data.wastage.map((w) => ({ reason: w.reason, grams: Number(w.grams) })),
    })
  }, [data])

  // Lock navigation once processing has started until child SKUs are generated
  // (or the run is cancelled). The user must commit or cancel before leaving.
  const navigate = useNavigate()
  const locked = !!(data && data.job.start_at && data.childCount === 0)
  useBlockNavigation(
    locked,
    'Finish this job before leaving: complete processing and click “Generate Child SKUs”, or click “Cancel Process” to discard this run.',
  )

  if (loading) return <Spinner />
  if (error) return <Banner tone="error">{error}</Banner>
  if (!data || !data.job.parent) return <Banner tone="error">Job not found.</Banner>

  const { job, lines } = data
  const parent = job.parent!
  const inputWeightG = toGrams(parent.quantity, parent.unit)
  const status = job.status

  // ── mutations ──────────────────────────────────────────────────────────
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true)
    await fn()
    setBusy(false)
    await refresh()
  }
  const addPlanLine = (grams: number) =>
    run(async () => {
      await supabase.from('job_pack_sizes').insert({ job_id: id, pack_size_g: grams, expected_packs: 0, expected_output_g: 0 })
    })
  const setExpected = (line: JobPackSize, packs: number) =>
    run(async () => {
      await supabase.from('job_pack_sizes').update({ expected_packs: packs, expected_output_g: packs * Number(line.pack_size_g) }).eq('id', line.id)
    })
  const setActual = (line: JobPackSize, packs: number) =>
    run(async () => {
      await supabase.from('job_pack_sizes').update({ actual_packs: packs, actual_output_g: packs * Number(line.pack_size_g) }).eq('id', line.id)
    })
  const removeLine = (line: JobPackSize) => run(async () => { await supabase.from('job_pack_sizes').delete().eq('id', line.id) })

  const startProcessing = () =>
    run(async () => {
      const now = new Date().toISOString()
      await supabase.from('repack_jobs').update({ status: 'Processing', start_at: now, shift: shiftFromIso(now) }).eq('id', id)
    })
  const completeProcessing = () =>
    run(async () => {
      await supabase.from('repack_jobs').update({ status: 'Completed', complete_at: new Date().toISOString() }).eq('id', id)
    })

  async function cancelProcess() {
    if (
      !confirm(
        'Cancel this processing run?\n\nThe job returns to planning and the entered actuals and wastage for this run are cleared. The planned pack-size mix is kept.',
      )
    )
      return
    await run(async () => {
      await supabase.from('repack_jobs').update({ status: 'Created', start_at: null, complete_at: null, shift: null }).eq('id', id)
      await supabase.from('job_pack_sizes').update({ actual_packs: null, actual_output_g: null }).eq('job_id', id)
      await supabase.from('job_wastage').delete().eq('job_id', id)
    })
    navigate('/jobs')
  }

  const addWastage = (reason: string, grams: number) =>
    run(async () => { await supabase.from('job_wastage').insert({ job_id: id, reason, grams }) })
  const removeWastage = (w: JobWastage) => run(async () => { await supabase.from('job_wastage').delete().eq('id', w.id) })

  async function generateChildSkus() {
    if (!result) return
    await run(async () => {
      await supabase.from('child_skus').delete().eq('job_id', id) // regenerate cleanly
      const rows = result.lines
        .filter((l) => l.actualPacks > 0)
        .map((l, idx) => ({
          job_id: id,
          parent_item_id: parent.id,
          child_item_code: childItemCode(parent.item_code, l.packSizeG),
          description: childDescription(parent.description, l.packSizeG),
          unit: 'pack',
          batch_id: childBatchId(parent.batch_id, idx),
          pack_size_g: l.packSizeG,
          quantity: l.actualPacks,
          expiry_date: parent.expiry_date,
          unit_cost: Number(l.costPerPack.toFixed(4)),
          total_value: Number(l.lineTotalCost.toFixed(2)),
          warehouse_name: parent.warehouse_name,
        }))
      if (rows.length) await supabase.from('child_skus').insert(rows)
    })
  }

  const totalExpectedG = lines.reduce((s, l) => s + Number(l.expected_output_g), 0)
  const unplannedSizes = data.packSizes.filter((p) => !lines.some((l) => Number(l.pack_size_g) === Number(p.grams)))

  return (
    <div>
      <PageHeader
        title={`Job — ${parent.item_code}`}
        subtitle={`Batch ${parent.batch_id} • ${job.machine_code} • ${job.operator_code}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {locked && (
              <button className="btn-danger" onClick={cancelProcess} disabled={busy}>
                Cancel Process
              </button>
            )}
          </div>
        }
      />

      {locked && (
        <Banner tone="warn">
          <strong>This job is in progress.</strong> Finish it by completing processing and generating
          child SKUs, or click <strong>Cancel Process</strong>. You can’t navigate away until then.
        </Banner>
      )}

      {/* Parent / timing summary */}
      <Section title="Parent & Processing">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Item" value={parent.item_code} sub={parent.description} />
          <Stat label="Input weight" value={formatWeight(inputWeightG)} sub={`${parent.quantity}${parent.unit}`} />
          <Stat label="Start" value={job.start_at ? dateTime(job.start_at) : '—'} sub={job.shift ?? ''} />
          <Stat label="Complete" value={job.complete_at ? dateTime(job.complete_at) : '—'} sub={job.start_at && job.complete_at ? `${hoursBetween(job.start_at, job.complete_at).toFixed(2)} h` : ''} />
        </div>
      </Section>

      {/* Plan mix */}
      <Section
        title="Planned Output Mix"
        actions={
          status === 'Created' && unplannedSizes.length > 0 ? (
            <select
              className="input max-w-[160px]"
              value=""
              onChange={(e) => e.target.value && addPlanLine(Number(e.target.value))}
              disabled={busy}
            >
              <option value="">+ Add pack size…</option>
              {unplannedSizes.map((p) => (
                <option key={p.id} value={p.grams}>{p.label}</option>
              ))}
            </select>
          ) : null
        }
      >
        {lines.length === 0 ? (
          <Empty>{status === 'Created' ? 'Add one or more pack sizes to plan.' : 'No pack sizes were planned.'}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Pack size</th>
                  <th className="th">Expected packs</th>
                  <th className="th">Expected output (g)</th>
                  {status === 'Created' && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="td font-medium">{Number(l.pack_size_g)}g</td>
                    <td className="td">
                      {status === 'Created' ? (
                        <input
                          className="input max-w-[120px]"
                          type="number"
                          defaultValue={Number(l.expected_packs)}
                          onBlur={(e) => setExpected(l, Number(e.target.value) || 0)}
                        />
                      ) : (
                        num(Number(l.expected_packs))
                      )}
                    </td>
                    <td className="td">{num(Number(l.expected_output_g))}</td>
                    {status === 'Created' && (
                      <td className="td text-right">
                        <button className="text-rose-600 hover:underline" onClick={() => removeLine(l)}>Remove</button>
                      </td>
                    )}
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="td">Total</td>
                  <td className="td" />
                  <td className="td">{num(totalExpectedG)} g</td>
                  {status === 'Created' && <td className="td" />}
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-slate-500">Total parent weight available: {formatWeight(inputWeightG)}.</p>
          </div>
        )}

        {status === 'Created' && (
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={startProcessing} disabled={busy || lines.length === 0}>
              ▶ Start Processing
            </button>
          </div>
        )}
      </Section>

      {/* Production capture (actuals) */}
      {(status === 'Processing' || status === 'Completed') && (
        <Section title="Production Capture (actual packs)">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Pack size</th>
                  <th className="th">Actual qty packed</th>
                  <th className="th">Actual output (g)</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="td font-medium">{Number(l.pack_size_g)}g</td>
                    <td className="td">
                      {status === 'Processing' ? (
                        <input
                          className="input max-w-[120px]"
                          type="number"
                          defaultValue={l.actual_packs == null ? '' : Number(l.actual_packs)}
                          onBlur={(e) => setActual(l, Number(e.target.value) || 0)}
                        />
                      ) : (
                        num(Number(l.actual_packs ?? 0))
                      )}
                    </td>
                    <td className="td">{num(Number(l.actual_output_g ?? 0))}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="td">Total output</td>
                  <td className="td" />
                  <td className="td">{num(result?.totalActualOutputG ?? 0)} g</td>
                </tr>
              </tbody>
            </table>
          </div>
          {status === 'Processing' && (
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={completeProcessing} disabled={busy}>
                ✓ Complete Processing
              </button>
            </div>
          )}
        </Section>
      )}

      {/* Wastage */}
      {(status === 'Processing' || status === 'Completed') && (
        <WastageSection
          reasons={data.wastageReasons}
          wastage={data.wastage}
          onAdd={addWastage}
          onRemove={removeWastage}
          busy={busy}
        />
      )}

      {/* Output summary + costing */}
      {status === 'Completed' && result && (
        <>
          <OutputSummary result={result} wastage={data.wastage} />
          <CostingSection result={result} job={job} machine={data.machine} config={data.config} />
          <Section title="Child SKU Generation">
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={generateChildSkus} disabled={busy}>
                {data.childCount > 0 ? 'Regenerate Child SKUs' : 'Generate Child SKUs'}
              </button>
              {data.childCount > 0 && (
                <span className="text-sm text-emerald-600">
                  {data.childCount} child record(s) created — see{' '}
                  <Link to="/records" className="font-medium underline">Records</Link>.
                </span>
              )}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function WastageSection({
  reasons, wastage, onAdd, onRemove, busy,
}: {
  reasons: WastageReason[]
  wastage: JobWastage[]
  onAdd: (reason: string, grams: number) => void
  onRemove: (w: JobWastage) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  const [grams, setGrams] = useState('')
  const total = wastage.reduce((s, w) => s + Number(w.grams), 0)
  return (
    <Section title="Wastage / Losses">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="label">Wastage reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select…</option>
            {reasons.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="w-36">
          <label className="label">Grams wasted</label>
          <input className="input" type="number" value={grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
        <button
          className="btn-secondary"
          disabled={busy || !reason || !grams}
          onClick={() => { onAdd(reason, Number(grams) || 0); setReason(''); setGrams('') }}
        >
          + Add
        </button>
      </div>

      {wastage.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Reason</th>
                <th className="th">Grams</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {wastage.map((w) => (
                <tr key={w.id} className="border-b border-slate-100">
                  <td className="td">{w.reason}</td>
                  <td className="td">{num(Number(w.grams))}</td>
                  <td className="td text-right">
                    <button className="text-rose-600 hover:underline" onClick={() => onRemove(w)}>Remove</button>
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <td className="td">Total wastage</td>
                <td className="td">{num(total)} g</td>
                <td className="td" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function OutputSummary({ result, wastage }: { result: CostResult; wastage: JobWastage[] }) {
  const byReason = wastage.reduce<Record<string, number>>((acc, w) => {
    acc[w.reason] = (acc[w.reason] ?? 0) + Number(w.grams)
    return acc
  }, {})
  return (
    <Section title="Output Summary">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Input weight" value={`${num(result.inputWeightG)} g`} />
        <Stat label="Total output" value={`${num(result.totalActualOutputG)} g`} />
        <Stat label="Yield %" value={pct(result.yieldPct)} tone={result.yieldPct >= 90 ? 'good' : result.yieldPct >= 75 ? 'warn' : 'bad'} />
        <Stat label="Lost yield %" value={pct(result.lostYieldPct)} tone={result.lostYieldPct <= 10 ? 'good' : 'warn'} />
      </div>

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-600">Wastage breakdown</h3>
        {Object.keys(byReason).length === 0 ? (
          <Empty>No wastage recorded.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full max-w-md">
              <tbody>
                {Object.entries(byReason).map(([reason, g]) => (
                  <tr key={reason} className="border-b border-slate-100">
                    <td className="td">{reason}</td>
                    <td className="td text-right">{num(g)} g</td>
                    <td className="td text-right text-slate-400">{pct((g / result.inputWeightG) * 100)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="td">Total wastage</td>
                  <td className="td text-right">{num(result.totalWastageG)} g</td>
                  <td className="td text-right">{pct(result.wastagePct)}</td>
                </tr>
                {result.processVarianceG !== 0 && (
                  <tr className="text-amber-600">
                    <td className="td">Unaccounted process variance</td>
                    <td className="td text-right">{num(result.processVarianceG)} g</td>
                    <td className="td text-right">{pct((result.processVarianceG / result.inputWeightG) * 100)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  )
}

function CostingSection({
  result, job, machine, config,
}: {
  result: CostResult
  job: RepackJob
  machine: Machine | null
  config: CostingConfig
}) {
  const machineHours = hoursBetween(job.start_at, job.complete_at)
  const machineRate = machine?.cost_per_hour_override ?? config.machine_cost_per_hour
  return (
    <Section title="Repacking Cost Sheet">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Parent material cost" value={money(result.parentMaterialCost)} />
        <Stat label="Total repacking cost" value={money(result.totalRepackingCost)} />
        <Stat label="Total batch cost" value={money(result.totalBatchCost)} />
        <Stat label="Cost / gram (blended)" value={money(result.blendedCostPerGram, 4)} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <h3 className="mb-2 font-semibold text-slate-600">Repacking cost breakdown</h3>
          <Row label="Packaging cost" value={money(result.packagingCost)} />
          <Row label={`Machine cost (${machineHours.toFixed(2)} h × ${money(machineRate)})`} value={money(result.machineCost)} />
          <Row label={`Labor cost (${machineHours.toFixed(2)} h × ${money(config.labor_cost_per_hour)})`} value={money(result.laborCost)} />
          <Row label="Total repacking cost" value={money(result.totalRepackingCost)} bold />
          <Row label="Actual output weight" value={`${num(result.totalActualOutputG)} g`} />
        </div>

        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <h3 className="mb-2 font-semibold text-slate-600">Cost per pack</h3>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th">Size</th>
                <th className="th">Packs</th>
                <th className="th">Packaging</th>
                <th className="th">Cost / pack</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.packSizeG} className="border-b border-slate-100">
                  <td className="td font-medium">{l.packSizeG}g</td>
                  <td className="td">{num(l.actualPacks)}</td>
                  <td className="td">{money(l.packagingPerUnit, 2)}</td>
                  <td className="td font-semibold">{money(l.costPerPack, 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? 'border-t border-slate-200 font-semibold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  )
}
