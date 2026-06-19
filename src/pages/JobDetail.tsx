import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { useBlockNavigation } from '../lib/navGuard'
import { calculateCost, type CostResult } from '../lib/cost'
import { childBatchId } from '../lib/codes'
import { resolveChild, childExpiry } from '../lib/childMap'
import { activeSeconds, formatDuration } from '../lib/time'
import { formatWeight } from '../lib/units'
import { dateTime, money, num, pct, shiftFromIso } from '../lib/format'
import type {
  CostingConfig, JobPackSize, JobParent, JobTimeEvent, JobWastage, Machine,
  PackSize, PackagingCost, ParentChildMap, RepackJob, WastageReason,
} from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, Stat, StatusBadge } from '../components/ui'

interface Loaded {
  job: RepackJob
  jobParents: JobParent[]
  packSizes: PackSize[]
  wastageReasons: WastageReason[]
  packagingCosts: PackagingCost[]
  config: CostingConfig
  machine: Machine | null
  map: ParentChildMap[]
  lines: JobPackSize[]
  wastage: JobWastage[]
  timeEvents: JobTimeEvent[]
  childCount: number
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const { data, loading, error, refresh } = useData<Loaded | null>(async () => {
    if (!id) return null
    const { data: job } = await supabase
      .from('repack_jobs')
      .select('*, parent:parent_items(*)')
      .eq('id', id)
      .single()
    if (!job) return null
    const j = job as RepackJob
    const [jp, ps, wr, pc, cfg, lines, wastage, events, machines, map, child] = await Promise.all([
      supabase.from('job_parents').select('*, parent:parent_items(*)').eq('job_id', id),
      supabase.from('pack_sizes').select('*').eq('active', true).order('grams'),
      supabase.from('wastage_reasons').select('*').eq('active', true).order('name'),
      supabase.from('packaging_costs').select('*'),
      supabase.from('costing_config').select('*').limit(1).maybeSingle(),
      supabase.from('job_pack_sizes').select('*').eq('job_id', id).order('pack_size_g'),
      supabase.from('job_wastage').select('*').eq('job_id', id),
      supabase.from('job_time_events').select('*').eq('job_id', id).order('at'),
      supabase.from('machines').select('*').eq('code', j.machine_code ?? ''),
      supabase.from('parent_child_map').select('*'),
      supabase.from('child_skus').select('id', { count: 'exact', head: true }).eq('job_id', id),
    ])
    return {
      job: j,
      jobParents: (jp.data ?? []) as JobParent[],
      packSizes: ps.data ?? [],
      wastageReasons: wr.data ?? [],
      packagingCosts: pc.data ?? [],
      config: (cfg.data as CostingConfig) ?? { id: '', machine_cost_per_hour: 0, labor_cost_per_hour: 0 },
      machine: (machines.data?.[0] as Machine) ?? null,
      map: (map.data ?? []) as ParentChildMap[],
      lines: lines.data ?? [],
      wastage: wastage.data ?? [],
      timeEvents: (events.data ?? []) as JobTimeEvent[],
      childCount: child.count ?? 0,
    }
  }, [id])

  // Live clock while actively processing (so active time / accruing cost tick up).
  useEffect(() => {
    if (data?.job.status !== 'Processing') return
    const t = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [data?.job.status])

  const nowIso = useMemo(() => new Date(nowTs).toISOString(), [nowTs])

  const result = useMemo<CostResult | null>(() => {
    if (!data) return null
    const inputWeightG = data.jobParents.reduce((s, p) => s + Number(p.required_weight_g), 0)
    const parentMaterialCost = data.jobParents.reduce((s, p) => s + Number(p.material_cost), 0)
    const machineRate = data.job.process_type === 'Manual' ? 0 : data.machine?.cost_per_hour_override ?? data.config.machine_cost_per_hour
    const running = data.job.status === 'Processing'
    const machineHours = activeSeconds(data.timeEvents, running ? nowIso : undefined) / 3600
    const packCost = (g: number) => data.packagingCosts.find((p) => Number(p.pack_size_g) === Number(g))?.cost_per_unit ?? 0
    return calculateCost({
      parentMaterialCost,
      inputWeightG,
      machineHours,
      machineCostPerHour: machineRate,
      laborCostPerHour: data.config.labor_cost_per_hour,
      packLines: data.lines.map((l) => ({
        packSizeG: Number(l.pack_size_g),
        actualPacks: Number(l.actual_packs ?? 0),
        packagingPerUnit: packCost(l.pack_size_g),
      })),
      wastage: data.wastage.map((w) => ({ reason: w.reason, grams: Number(w.grams) })),
    })
  }, [data, nowIso])

  // Auto-seed a QC Rejects wastage row = remaining grams, once, when output is first entered.
  const seededRef = useRef<string | null>(null)
  useEffect(() => {
    if (!data || data.job.status !== 'Completed' || !id) return
    const out = data.lines.reduce((s, l) => s + Number(l.pack_size_g) * Number(l.actual_packs ?? 0), 0)
    const inW = data.jobParents.reduce((s, p) => s + Number(p.required_weight_g), 0)
    if (out > 0 && data.wastage.length === 0 && seededRef.current !== id) {
      seededRef.current = id
      const remaining = Math.max(0, inW - out)
      if (remaining > 0) {
        void supabase.from('job_wastage').insert({ job_id: id, reason: 'QC Rejects', grams: Number(remaining.toFixed(2)) }).then(() => refresh())
      }
    }
  }, [data, id, refresh])

  // A started, ungenerated job is "in progress". We only BLOCK navigation while actively
  // Processing — an On-Hold job can be left and resumed later.
  const inProgress = !!(data && data.job.start_at && data.childCount === 0)
  const locked = inProgress && data!.job.status !== 'On Hold'
  useBlockNavigation(
    locked,
    'Finish this job before leaving: stop processing, then click “Generate Child SKUs”, or “Cancel Process”. (Put it On Hold if you need to step away.)',
  )

  if (loading) return <Spinner />
  if (error) return <Banner tone="error">{error}</Banner>
  if (!data) return <Banner tone="error">Job not found.</Banner>

  const { job, jobParents } = data
  const status = job.status
  const primary = jobParents[0]?.parent ?? job.parent ?? null
  const outProd = job.output_product_code || primary?.item_code || '—'
  const inputWeightG = jobParents.reduce((s, p) => s + Number(p.required_weight_g), 0)
  const materialCost = jobParents.reduce((s, p) => s + Number(p.material_cost), 0)
  const running = status === 'Processing'
  const activeSec = activeSeconds(data.timeEvents, running ? nowIso : undefined)
  const machineHours = activeSec / 3600
  const machineRate = job.process_type === 'Manual' ? 0 : data.machine?.cost_per_hour_override ?? data.config.machine_cost_per_hour
  const totalPacks = data.lines.reduce((s, l) => s + Number(l.actual_packs ?? 0), 0)
  const addedSizes = new Set(data.lines.map((l) => Number(l.pack_size_g)))
  const availableSizes = data.packSizes.filter((p) => !addedSizes.has(Number(p.grams)))
  const unmappedSizes = status === 'Completed'
    ? [...new Set(data.lines.filter((l) => Number(l.actual_packs ?? 0) > 0).map((l) => Number(l.pack_size_g)))]
        .filter((sz) => !resolveChild(data.map, job.output_product_code || primary?.item_code || '', sz, '').mapped)
    : []

  // ── mutations ──────────────────────────────────────────────────────────
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true)
    await fn()
    setBusy(false)
    await refresh()
  }
  const logEvent = (type: JobTimeEvent['event_type'], at: string) =>
    supabase.from('job_time_events').insert({ job_id: id, event_type: type, at })

  const startProcessing = () =>
    run(async () => {
      const now = new Date().toISOString()
      await logEvent('start', now)
      await supabase.from('repack_jobs').update({ status: 'Processing', start_at: now, shift: shiftFromIso(now) }).eq('id', id)
    })
  const holdProcessing = () =>
    run(async () => {
      await logEvent('hold', new Date().toISOString())
      await supabase.from('repack_jobs').update({ status: 'On Hold' }).eq('id', id)
    })
  const resumeProcessing = () =>
    run(async () => {
      await logEvent('resume', new Date().toISOString())
      await supabase.from('repack_jobs').update({ status: 'Processing' }).eq('id', id)
    })
  const stopProcessing = () =>
    run(async () => {
      const now = new Date().toISOString()
      await logEvent('stop', now)
      await supabase.from('repack_jobs').update({ status: 'Completed', complete_at: now }).eq('id', id)
    })

  const addOutputLine = (grams: number) =>
    run(async () => {
      await supabase.from('job_pack_sizes').insert({ job_id: id, pack_size_g: grams, actual_packs: 0, actual_output_g: 0 })
    })
  const setActual = (line: JobPackSize, packs: number) =>
    run(async () => {
      await supabase.from('job_pack_sizes').update({ actual_packs: packs, actual_output_g: packs * Number(line.pack_size_g) }).eq('id', line.id)
    })
  const removeLine = (line: JobPackSize) => run(async () => { await supabase.from('job_pack_sizes').delete().eq('id', line.id) })

  const addWastage = (reason: string, grams: number) => run(async () => { await supabase.from('job_wastage').insert({ job_id: id, reason, grams }) })
  const removeWastage = (w: JobWastage) => run(async () => { await supabase.from('job_wastage').delete().eq('id', w.id) })

  async function cancelProcess() {
    if (!confirm('Cancel this run?\n\nThe job returns to Created and the time log, output lines, and wastage for this run are cleared. Inputs are kept.'))
      return
    await run(async () => {
      await supabase.from('job_time_events').delete().eq('job_id', id)
      await supabase.from('job_pack_sizes').delete().eq('job_id', id)
      await supabase.from('job_wastage').delete().eq('job_id', id)
      await supabase.from('repack_jobs').update({ status: 'Created', start_at: null, complete_at: null, shift: null, active_seconds: null }).eq('id', id)
    })
    seededRef.current = null
    navigate('/jobs')
  }

  async function generateChildSkus() {
    if (!result || !id) return
    await run(async () => {
      const inputs = data!.jobParents
      const expiry = childExpiry(inputs)
      const warehouse = primary?.warehouse_name ?? ''
      const productCode = job.output_product_code || primary?.item_code || ''
      const batchBase = inputs.length === 1 ? primary?.batch_id || productCode : productCode

      await supabase.from('child_skus').delete().eq('job_id', id)
      const rows = result.lines
        .filter((l) => l.actualPacks > 0)
        .map((l, idx) => {
          const rc = resolveChild(data!.map, productCode, l.packSizeG, primary?.description ?? productCode)
          return {
            job_id: id,
            parent_item_id: primary?.id ?? null, // legacy link → primary input (blends keep the input list in job_parents)
            output_product_code: productCode,
            child_item_code: rc.child_code,
            description: rc.child_description,
            child_barcode: rc.child_barcode,
            category: rc.category,
            unit: 'pack',
            batch_id: childBatchId(batchBase, idx),
            pack_size_g: l.packSizeG,
            quantity: l.actualPacks,
            expiry_date: expiry,
            unit_cost: Number(l.costPerPack.toFixed(4)),
            total_value: Number(l.lineTotalCost.toFixed(2)),
            warehouse_name: warehouse,
          }
        })
      if (rows.length) await supabase.from('child_skus').insert(rows)

      const finalActiveSec = activeSeconds(data!.timeEvents)
      await supabase.from('job_cost_snapshot').upsert(
        {
          job_id: id,
          process_type: job.process_type,
          output_product_code: productCode,
          completed_on: (job.complete_at ?? new Date().toISOString()).slice(0, 10),
          shift: job.shift,
          input_weight_g: result.inputWeightG,
          output_weight_g: result.totalActualOutputG,
          yield_pct: result.yieldPct,
          lost_yield_pct: result.lostYieldPct,
          wastage_g: result.totalWastageG,
          packs_produced: result.lines.reduce((s, l) => s + l.actualPacks, 0),
          active_seconds: finalActiveSec,
          total_material_cost: result.parentMaterialCost,
          machine_cost: result.machineCost,
          labor_cost: result.laborCost,
          packaging_cost: result.packagingCost,
          total_batch_cost: result.totalBatchCost,
        },
        { onConflict: 'job_id' },
      )
      await supabase.from('repack_jobs').update({ active_seconds: finalActiveSec }).eq('id', id)
    })
  }

  return (
    <div>
      <PageHeader
        title={`Job — ${outProd}`}
        subtitle={`${job.process_type} • ${job.machine_code ?? 'Manual'} • ${job.operator_code}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {inProgress && (
              <button className="btn-danger" onClick={cancelProcess} disabled={busy}>Cancel Process</button>
            )}
          </div>
        }
      />

      {locked && (
        <Banner tone="warn">
          <strong>This job is in progress.</strong> Stop processing, enter the actual output &amp; wastage, then
          <strong> Generate Child SKUs</strong> — or <strong>Cancel Process</strong>. You can’t navigate away until then.
        </Banner>
      )}

      {/* Inputs */}
      <Section title="Inputs">
        {jobParents.length === 0 ? (
          <Empty>No inputs on this job.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="th">Parent ID</th>
                  <th className="th">Description</th>
                  <th className="th">Drawn weight</th>
                  <th className="th">Material cost</th>
                  <th className="th">Expiry</th>
                </tr>
              </thead>
              <tbody>
                {jobParents.map((jp) => (
                  <tr key={jp.id} className="border-b border-slate-100">
                    <td className="td font-medium">{jp.parent?.item_code}</td>
                    <td className="td">{jp.parent?.description}</td>
                    <td className="td">{formatWeight(Number(jp.required_weight_g))}</td>
                    <td className="td">{money(Number(jp.material_cost))}</td>
                    <td className="td">{jp.parent?.expiry_date ?? '—'}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="td">Total → {outProd}</td>
                  <td className="td" />
                  <td className="td">{formatWeight(inputWeightG)}</td>
                  <td className="td">{money(materialCost)}</td>
                  <td className="td" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Processing controls + timing */}
      <Section title="Processing">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Start" valueClassName="text-sm" value={job.start_at ? dateTime(job.start_at) : '—'} sub={job.shift ?? ''} />
          <Stat label="Active time" value={formatDuration(activeSec)} sub={running ? 'running…' : status === 'On Hold' ? 'paused' : ''} tone={status === 'On Hold' ? 'warn' : 'default'} />
          <Stat label="Complete" valueClassName="text-sm" value={job.complete_at ? dateTime(job.complete_at) : '—'} />
          <Stat label="Status" valueClassName="text-base" value={status} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {status === 'Created' && (
            <button className="btn-primary" onClick={startProcessing} disabled={busy || jobParents.length === 0}>▶ Start Processing</button>
          )}
          {status === 'Processing' && (
            <>
              <button className="btn-secondary" onClick={holdProcessing} disabled={busy}>⏸ Hold</button>
              <button className="btn-primary" onClick={stopProcessing} disabled={busy}>■ Stop Processing</button>
            </>
          )}
          {status === 'On Hold' && (
            <button className="btn-primary" onClick={resumeProcessing} disabled={busy}>▶ Resume</button>
          )}
        </div>
      </Section>

      {/* Actual produced items (after stop) */}
      {status === 'Completed' && (
        <Section
          title="Actual Produced Items"
          actions={
            availableSizes.length > 0 ? (
              <select className="input max-w-[160px]" value="" onChange={(e) => e.target.value && addOutputLine(Number(e.target.value))} disabled={busy}>
                <option value="">+ Add pack size…</option>
                {availableSizes.map((p) => (
                  <option key={p.id} value={p.grams}>{p.label}</option>
                ))}
              </select>
            ) : null
          }
        >
          {data.lines.length === 0 ? (
            <Empty>Add the pack sizes produced and enter the number of packs.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="th">Pack size</th>
                    <th className="th">Packs produced</th>
                    <th className="th">Output (g)</th>
                    <th className="th" />
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="td font-medium">{Number(l.pack_size_g)}g</td>
                      <td className="td">
                        <input
                          className="input max-w-[120px]"
                          type="number"
                          defaultValue={l.actual_packs == null ? '' : Number(l.actual_packs)}
                          onBlur={(e) => setActual(l, Number(e.target.value) || 0)}
                        />
                      </td>
                      <td className="td">{num(Number(l.pack_size_g) * Number(l.actual_packs ?? 0))}</td>
                      <td className="td text-right">
                        <button className="text-rose-600 hover:underline" onClick={() => removeLine(l)}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="td">Total output</td>
                    <td className="td">{num(totalPacks)} packs</td>
                    <td className="td">{num(result?.totalActualOutputG ?? 0)} g</td>
                    <td className="td" />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {result && result.totalActualOutputG > inputWeightG && (
            <Banner tone="warn">Output {formatWeight(result.totalActualOutputG)} exceeds input {formatWeight(inputWeightG)} — check the pack counts.</Banner>
          )}
        </Section>
      )}

      {/* Wastage */}
      {status === 'Completed' && (
        <WastageSection
          reasons={data.wastageReasons}
          wastage={data.wastage}
          remainingG={Math.max(0, inputWeightG - (result?.totalActualOutputG ?? 0) - data.wastage.reduce((s, w) => s + Number(w.grams), 0))}
          onAdd={addWastage}
          onRemove={removeWastage}
          busy={busy}
        />
      )}

      {/* Output summary + costing + generate */}
      {status === 'Completed' && result && (
        <>
          <OutputSummary result={result} activeSec={activeSec} packs={totalPacks} />
          <CostingSection result={result} machineHours={machineHours} machineRate={machineRate} laborRate={data.config.labor_cost_per_hour} manual={job.process_type === 'Manual'} />
          <Section title="Child SKU Generation">
            {unmappedSizes.length > 0 && (
              <Banner tone="warn">
                No Parent-Child Master entry for <strong>{outProd}</strong> at {unmappedSizes.map((s) => `${s}g`).join(', ')} — child codes will be auto-generated. Add them in Config → Parent-Child Master for proper codes/barcodes.
              </Banner>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={generateChildSkus} disabled={busy || totalPacks === 0}>
                {data.childCount > 0 ? 'Regenerate Child SKUs' : 'Generate Child SKUs'}
              </button>
              {data.childCount > 0 && (
                <span className="text-sm text-emerald-600">
                  {data.childCount} child record(s) created — see <Link to="/records" className="font-medium underline">Records</Link>.
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
  reasons, wastage, remainingG, onAdd, onRemove, busy,
}: {
  reasons: WastageReason[]
  wastage: JobWastage[]
  remainingG: number
  onAdd: (reason: string, grams: number) => void
  onRemove: (w: JobWastage) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('QC Rejects')
  const [grams, setGrams] = useState('')
  const total = wastage.reduce((s, w) => s + Number(w.grams), 0)
  return (
    <Section title="Wastage / Losses">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className="label">Wastage reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasons.map((r) => (<option key={r.id} value={r.name}>{r.name}</option>))}
          </select>
        </div>
        <div className="w-36">
          <label className="label">Grams wasted</label>
          <input className="input" type="number" value={grams} onChange={(e) => setGrams(e.target.value)} placeholder={remainingG > 0 ? `${Math.round(remainingG)} left` : ''} />
        </div>
        <button className="btn-secondary" disabled={busy || !reason || !grams} onClick={() => { onAdd(reason, Number(grams) || 0); setGrams('') }}>+ Add</button>
        {remainingG > 0.5 && (
          <button className="btn-secondary" disabled={busy} onClick={() => onAdd('QC Rejects', Number(remainingG.toFixed(2)))}>
            + QC Rejects ({num(Math.round(remainingG))} g remaining)
          </button>
        )}
      </div>

      {wastage.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full max-w-md">
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

function Mini({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const t = tone === 'good' ? 'text-emerald-600' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900'
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white px-2.5 py-1.5">
      <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`text-sm font-bold leading-snug ${t}`}>{value}</div>
    </div>
  )
}

function OutputSummary({ result, activeSec, packs }: { result: CostResult; activeSec: number; packs: number }) {
  return (
    <Section title="Output Summary">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        <Mini label="Input" value={formatWeight(result.inputWeightG)} />
        <Mini label="Output" value={formatWeight(result.totalActualOutputG)} />
        <Mini label="Yield" value={pct(result.yieldPct)} tone={result.yieldPct >= 90 ? 'good' : result.yieldPct >= 75 ? 'warn' : 'bad'} />
        <Mini label="Lost yield" value={pct(result.lostYieldPct)} tone={result.lostYieldPct <= 10 ? 'good' : 'warn'} />
        <Mini label="Wastage" value={`${(result.totalWastageG / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`} />
        <Mini label="Time" value={formatDuration(activeSec)} />
        <Mini label="Packs" value={num(packs)} />
        {result.processVarianceG !== 0 && <Mini label="Unaccounted" value={`${num(result.processVarianceG)} g`} tone="warn" />}
      </div>
    </Section>
  )
}

function CostingSection({
  result, machineHours, machineRate, laborRate, manual,
}: {
  result: CostResult
  machineHours: number
  machineRate: number
  laborRate: number
  manual: boolean
}) {
  return (
    <Section title="Repacking Cost Sheet">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Mini label="Material" value={money(result.parentMaterialCost)} />
        <Mini label="Repacking" value={money(result.totalRepackingCost)} />
        <Mini label="Total batch" value={money(result.totalBatchCost)} />
        <Mini label="Cost / gram" value={money(result.blendedCostPerGram, 4)} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 text-[13px]">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost breakdown</h3>
          <Row label="Packaging" value={money(result.packagingCost)} />
          <Row label={manual ? 'Machine (manual → 0)' : `Machine (${machineHours.toFixed(1)}h × ${money(machineRate, 0)})`} value={money(result.machineCost)} />
          <Row label={`Labor (${machineHours.toFixed(1)}h × ${money(laborRate, 0)})`} value={money(result.laborCost)} />
          <Row label="Total repacking" value={money(result.totalRepackingCost)} bold />
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 p-3">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Cost per pack</h3>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="th !py-1.5">Size</th><th className="th !py-1.5">Packs</th><th className="th !py-1.5">Pkg</th><th className="th !py-1.5">Cost/pack</th>
              </tr>
            </thead>
            <tbody>
              {result.lines.map((l) => (
                <tr key={l.packSizeG} className="border-b border-slate-100">
                  <td className="td !py-1.5 font-medium">{l.packSizeG}g</td>
                  <td className="td !py-1.5">{num(l.actualPacks)}</td>
                  <td className="td !py-1.5">{money(l.packagingPerUnit, 2)}</td>
                  <td className="td !py-1.5 font-semibold">{money(l.costPerPack, 4)}</td>
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
    <div className={`flex justify-between py-0.5 ${bold ? 'mt-0.5 border-t border-slate-200 pt-1 font-semibold' : ''}`}>
      <span className="text-slate-500">{label}</span>
      <span>{value}</span>
    </div>
  )
}
