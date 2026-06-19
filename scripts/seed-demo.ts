/* Demo seeder + scenario tests. Runs against the live Supabase (uses .env).
   WIPES all data, inserts ~6 months of realistic demo data, drives jobs through the
   REAL app logic (cost/time/childMap), then asserts end-to-end invariants.
   Run: npx vite-node scripts/seed-demo.ts                                        */
import { supabase } from '../src/lib/supabase'
import { parentRow } from '../src/lib/parent'
import { calculateCost } from '../src/lib/cost'
import { activeSeconds } from '../src/lib/time'
import { resolveChild, childExpiry } from '../src/lib/childMap'
import { childBatchId } from '../src/lib/codes'
import { shiftFromIso } from '../src/lib/format'

const DAY = 86_400_000
const now = Date.now()
const iso = (ms: number) => new Date(ms).toISOString()
const isoDate = (ms: number) => iso(ms).slice(0, 10)
const sizeLabel = (g: number) => (g >= 1000 ? `${g / 1000}kg` : `${g}g`)

async function ins(table: string, rows: any[]): Promise<any[]> {
  if (rows.length === 0) return []
  const { data, error } = await supabase.from(table).insert(rows).select()
  if (error) throw new Error(`insert ${table}: ${error.message}`)
  return data ?? []
}
async function wipe(table: string) {
  const { error } = await supabase.from(table).delete().not('id', 'is', null)
  if (error) throw new Error(`wipe ${table}: ${error.message}`)
}

// ─────────────────────────── 1. WIPE ───────────────────────────
const WIPE_ORDER = [
  'child_skus', 'job_cost_snapshot', 'job_wastage', 'job_time_events', 'job_pack_sizes',
  'job_parents', 'repack_jobs', 'parent_items', 'parent_child_map',
  'packaging_costs', 'pack_sizes', 'wastage_reasons', 'machines', 'employees', 'costing_config',
]
console.log('Wiping…')
for (const t of WIPE_ORDER) await wipe(t)

// ─────────────────────────── 2. Masters ───────────────────────────
const config = { machine_cost_per_hour: 42, labor_cost_per_hour: 16 }
await ins('costing_config', [config])

const EMPLOYEES = [
  ['EMP01', 'Arun Nair'], ['EMP02', 'Priya Menon'], ['EMP03', 'Mohammed Rafi'], ['EMP04', 'Sneha Pillai'],
  ['EMP05', 'Joseph Thomas'], ['EMP06', 'Fatima Beevi'], ['EMP07', 'Kiran Kumar'], ['EMP08', 'Lakshmi Rao'],
  ['EMP09', 'Vishnu Das'], ['EMP10', 'Aisha Banu'],
]
await ins('employees', EMPLOYEES.map(([code, name]) => ({ code, name, active: true })))

const MACHINES = [['MC-01', 'Repack Line 1'], ['MC-02', 'Repack Line 2'], ['MC-03', 'Repack Line 3']]
await ins('machines', MACHINES.map(([code, name]) => ({ code, name, active: true })))

const SIZES = [50, 100, 250, 500, 1000]
await ins('pack_sizes', SIZES.map((g) => ({ grams: g, label: sizeLabel(g), active: true })))

await ins('wastage_reasons', ['QC Rejects', 'Shrinkage', 'Spillage', 'Moisture Loss', 'Machine Loss'].map((name) => ({ name, active: true })))

const PACK_COST: Record<number, number> = { 50: 0.18, 100: 0.25, 250: 0.45, 500: 0.7, 1000: 1.1 }
await ins('packaging_costs', SIZES.map((g) => ({ pack_size_g: g, cost_per_unit: PACK_COST[g] })))

// ─────────────────────────── 3. Products & Parent-Child Master ───────────────────────────
// Parent ID + Child ID are alphanumeric SKU codes; the descriptive name lives in the description.
// Parent IDs are numeric item codes; child IDs are `${parentId}-C${n}` (n = size index).
const CSHW = '1000123', ALMD = '1000231', PSTA = '1000345', WLNT = '1000456', RAIS = '1000567', APRC = '1000678', TRMX = '1000801', NTMX = '1000902'
interface Product { code: string; name: string; cat: string; bagKg: number; costKg: number; sizes: number[]; blendOf?: string[] }
const PRODUCTS: Product[] = [
  { code: CSHW, name: 'Cashew Nuts W320', cat: 'Nuts', bagKg: 25, costKg: 8.2, sizes: [100, 250, 500] },
  { code: ALMD, name: 'Almonds Nonpareil', cat: 'Nuts', bagKg: 25, costKg: 7.1, sizes: [100, 250, 500] },
  { code: PSTA, name: 'Pistachios Roasted & Salted', cat: 'Nuts', bagKg: 22, costKg: 13.5, sizes: [100, 250] },
  { code: WLNT, name: 'Walnut Halves', cat: 'Nuts', bagKg: 20, costKg: 9.4, sizes: [250, 500] },
  { code: RAIS, name: 'Golden Raisins', cat: 'Dried Fruit', bagKg: 12.5, costKg: 2.9, sizes: [250, 500, 1000] },
  { code: APRC, name: 'Turkish Apricots', cat: 'Dried Fruit', bagKg: 10, costKg: 5.6, sizes: [250, 500] },
  { code: TRMX, name: 'Premium Trail Mix', cat: 'Mixes', bagKg: 0, costKg: 0, sizes: [100, 250, 500], blendOf: [CSHW, ALMD, RAIS] },
  { code: NTMX, name: 'Deluxe Nut Mix', cat: 'Mixes', bagKg: 0, costKg: 0, sizes: [250, 500], blendOf: [CSHW, ALMD, WLNT, PSTA] },
]
const byCode: Record<string, Product> = Object.fromEntries(PRODUCTS.map((p) => [p.code, p]))

let barcode = 8_901_234_500_001
const mapRows: any[] = []
for (const p of PRODUCTS)
  p.sizes.forEach((s, idx) =>
    mapRows.push({
      parent_code: p.code, parent_description: p.name, category: p.cat, pack_size_g: s,
      child_code: `${p.code}-C${idx + 1}`, child_description: `${p.name} ${sizeLabel(s)} Pack`,
      child_barcode: String(barcode++), active: true,
    }),
  )
await ins('parent_child_map', mapRows)
const { data: MAP } = await supabase.from('parent_child_map').select('*')

// ─────────────────────────── 4. Parent receipts (across ~6 months) ───────────────────────────
// 2 batches per raw product; large bulk qty; received over the period; description carries the bag weight.
const RAW = PRODUCTS.filter((p) => !p.blendOf)
const parentInsert: any[] = []
let batchSeq = 1
for (const p of RAW) {
  for (let b = 0; b < 2; b++) {
    const receivedDaysAgo = 180 - b * 70 - batchSeq * 3
    const expiryDays = [80, 150, 240, 330, 400][batchSeq % 5]
    parentInsert.push(
      parentRow({
        item_code: p.code, description: `${p.name} ${p.bagKg}kg bag`, category: p.cat,
        batch_id: `${p.code}-B${String(batchSeq).padStart(3, '0')}`, qty: 60, weight_per_unit: p.bagKg, weight_unit: 'kg',
        expiry_date: isoDate(now + expiryDays * DAY), total_cost: 60 * p.bagKg * p.costKg,
        warehouse_name: p.cat === 'Dried Fruit' ? 'WH-C' : 'WH-A',
      }),
    )
    // stamp received_at by overriding (parentRow doesn't set it)
    ;(parentInsert[parentInsert.length - 1] as any).received_at = iso(now - receivedDaysAgo * DAY)
    batchSeq++
  }
}
const parents = await ins('parent_items', parentInsert)
const pById: Record<string, any> = {}
const remaining: Record<string, number> = {}
const batchesByCode: Record<string, any[]> = {}
for (const row of parents) {
  pById[row.id] = row
  remaining[row.id] = Number(row.total_weight_g)
  ;(batchesByCode[row.item_code] ??= []).push(row)
}
const chooseBatch = (code: string) => batchesByCode[code].reduce((a, b) => (remaining[b.id] >= remaining[a.id] ? b : a))

// ─────────────────────────── 5. Completed jobs via real logic ───────────────────────────
interface Input { code: string; batch: string; grams: number }
interface Spec {
  whenMs: number; processType: 'Machine' | 'Manual'; machine?: string; operator: string
  output: string; size: number; yield: number; durMin: number; holdMin?: number
  inputs: Input[]; extraWaste?: number; extraReason?: string
}

async function completedJob(s: Spec) {
  const stopMs = s.whenMs
  const durMs = s.durMin * 60_000
  const holdMs = (s.holdMin ?? 0) * 60_000
  const startMs = stopMs - durMs - holdMs
  const startIso = iso(startMs)
  const stopIso = iso(stopMs)
  const events: any[] = [{ event_type: 'start', at: startIso }]
  if (holdMs > 0) {
    const hAt = startMs + durMs / 2
    events.push({ event_type: 'hold', at: iso(hAt) }, { event_type: 'resume', at: iso(hAt + holdMs) })
  }
  events.push({ event_type: 'stop', at: stopIso })
  const activeSec = activeSeconds(events.map((e, i) => ({ id: String(i), job_id: 'x', event_type: e.event_type, at: e.at })))

  let inputG = 0, materialCost = 0
  const jpRows: any[] = []
  const inputObjs: any[] = []
  for (const inp of s.inputs) {
    const par = batchesByCode[inp.code].find((p) => p.batch_id === inp.batch)
    if (!par) throw new Error(`no parent ${inp.code}|${inp.batch}`)
    if (remaining[par.id] < inp.grams - 1e-6) throw new Error(`OVER-DRAW ${inp.code} ${inp.batch}: need ${inp.grams}, have ${remaining[par.id]}`)
    remaining[par.id] -= inp.grams
    const cpg = Number(par.total_cost) / Number(par.total_weight_g)
    const mc = inp.grams * cpg
    inputG += inp.grams; materialCost += mc
    jpRows.push({ parent_item_id: par.id, required_weight_g: inp.grams, material_cost: mc })
    inputObjs.push({ parent: par })
  }
  const packs = Math.max(1, Math.floor((inputG * s.yield) / s.size))
  const outputG = packs * s.size
  const wasteTotal = Math.max(0, inputG - outputG)
  const wasteRows: any[] = []
  if (s.extraWaste && wasteTotal > s.extraWaste) {
    wasteRows.push({ reason: 'QC Rejects', grams: Number((wasteTotal - s.extraWaste).toFixed(2)) })
    wasteRows.push({ reason: s.extraReason ?? 'Shrinkage', grams: s.extraWaste })
  } else wasteRows.push({ reason: 'QC Rejects', grams: Number(wasteTotal.toFixed(2)) })

  const machineRate = s.processType === 'Manual' ? 0 : config.machine_cost_per_hour
  const result = calculateCost({
    parentMaterialCost: materialCost, inputWeightG: inputG,
    machineHours: activeSec / 3600, machineCostPerHour: machineRate, laborCostPerHour: config.labor_cost_per_hour,
    packLines: [{ packSizeG: s.size, actualPacks: packs, packagingPerUnit: PACK_COST[s.size] ?? 0 }],
    wastage: wasteRows.map((w) => ({ reason: w.reason, grams: Number(w.grams) })),
  })

  const primary = pById[batchesByCode[s.inputs[0].code].find((p) => p.batch_id === s.inputs[0].batch)!.id]
  const [job] = await ins('repack_jobs', [{
    parent_item_id: primary.id, machine_code: s.processType === 'Machine' ? s.machine : null, operator_code: s.operator,
    process_type: s.processType, output_product_code: s.output, status: 'Completed',
    shift: shiftFromIso(startIso), created_at: iso(startMs - 600_000), start_at: startIso, complete_at: stopIso, active_seconds: activeSec,
  }])
  await ins('job_parents', jpRows.map((r) => ({ job_id: job.id, ...r })))
  await ins('job_time_events', events.map((e) => ({ job_id: job.id, ...e })))
  await ins('job_pack_sizes', [{ job_id: job.id, pack_size_g: s.size, expected_packs: 0, expected_output_g: 0, actual_packs: packs, actual_output_g: outputG }])
  await ins('job_wastage', wasteRows.map((w) => ({ job_id: job.id, ...w })))

  const expiry = childExpiry(inputObjs)
  const batchBase = s.inputs.length === 1 ? primary.batch_id : s.output
  const childRows = result.lines.filter((l) => l.actualPacks > 0).map((l, idx) => {
    const rc = resolveChild((MAP ?? []) as any, s.output, l.packSizeG, primary.description)
    return {
      job_id: job.id, parent_item_id: primary.id, output_product_code: s.output,
      child_item_code: rc.child_code, description: rc.child_description, child_barcode: rc.child_barcode, category: rc.category,
      unit: 'pack', batch_id: childBatchId(batchBase, idx), pack_size_g: l.packSizeG, quantity: l.actualPacks, expiry_date: expiry,
      unit_cost: Number(l.costPerPack.toFixed(4)), total_value: Number(l.lineTotalCost.toFixed(2)), warehouse_name: primary.warehouse_name,
    }
  })
  await ins('child_skus', childRows)
  await ins('job_cost_snapshot', [{
    job_id: job.id, process_type: s.processType, output_product_code: s.output, completed_on: stopIso.slice(0, 10), shift: shiftFromIso(startIso),
    input_weight_g: result.inputWeightG, output_weight_g: result.totalActualOutputG, yield_pct: result.yieldPct, lost_yield_pct: result.lostYieldPct,
    wastage_g: result.totalWastageG, packs_produced: packs, active_seconds: activeSec,
    total_material_cost: result.parentMaterialCost, machine_cost: result.machineCost, labor_cost: result.laborCost,
    packaging_cost: result.packagingCost, total_batch_cost: result.totalBatchCost,
  }])
}

// Generate ~48 completed jobs spread across ~175 days (≈ Dec 2025 → Jun 2026).
const N = 48
const SINGLES = RAW.map((p) => p.code)
console.log(`Seeding ${N} completed jobs across ~6 months…`)
for (let i = 0; i < N; i++) {
  const whenMs = now - Math.round((i + 0.5) * (175 / N)) * DAY + ((i % 4) - 2) * 3_600_000
  const isBlend = i % 7 === 3
  const output = isBlend ? (i % 14 === 3 ? NTMX : TRMX) : SINGLES[i % SINGLES.length]
  const prod = byCode[output]
  const size = prod.sizes[i % prod.sizes.length]
  const processType: 'Machine' | 'Manual' = i % 9 < 5 ? 'Manual' : 'Machine'
  const isMachine = processType === 'Machine'
  const operator = `EMP${String((i % 10) + 1).padStart(2, '0')}`
  const machine = `MC-0${(i % 3) + 1}`
  // Machines run higher yield, faster throughput (less labour/pack) → higher yield + lower cost/pack.
  const yieldPct = isMachine ? 0.94 + (i % 5) * 0.008 : 0.86 + (i % 7) * 0.009
  const packsTarget = (isMachine ? 170 : 110) + (i % 6) * 20
  const durMin = Math.max(isMachine ? 35 : 90, Math.round(packsTarget / (isMachine ? 4.2 : 0.9)))
  const holdMin = i % 6 === 0 ? 20 + (i % 3) * 10 : 0
  const totalIn = Math.round((packsTarget * size) / yieldPct)

  let inputs: Input[]
  if (prod.blendOf) {
    const parts = prod.blendOf
    const shares = parts.length === 3 ? [0.4, 0.35, 0.25] : [0.3, 0.3, 0.2, 0.2]
    inputs = parts.map((code, k) => ({ code, batch: chooseBatch(code).batch_id, grams: Math.round(totalIn * shares[k]) }))
  } else {
    inputs = [{ code: output, batch: chooseBatch(output).batch_id, grams: totalIn }]
  }
  const extraWaste = i % 5 === 0 ? 400 + (i % 4) * 200 : undefined
  const extraReason = ['Shrinkage', 'Spillage', 'Moisture Loss', 'Machine Loss'][i % 4]
  await completedJob({ whenMs, processType, machine, operator, output, size, yield: yieldPct, durMin, holdMin, inputs, extraWaste, extraReason })
}

// ─────────────────────────── 6. In-flight jobs (pipeline) ───────────────────────────
async function simpleJob(status: string, opts: { processType: 'Machine' | 'Manual'; machine?: string; operator: string; output: string; inputs: Input[]; startedMinAgo?: number; held?: boolean }) {
  const startMs = now - (opts.startedMinAgo ?? 60) * 60_000
  const primary = batchesByCode[opts.inputs[0].code].find((p) => p.batch_id === opts.inputs[0].batch)!
  const [job] = await ins('repack_jobs', [{
    parent_item_id: primary.id, machine_code: opts.processType === 'Machine' ? opts.machine : null, operator_code: opts.operator,
    process_type: opts.processType, output_product_code: opts.output, status,
    shift: status === 'Created' ? null : shiftFromIso(iso(startMs)), start_at: status === 'Created' ? null : iso(startMs),
  }])
  const jp = opts.inputs.map((inp) => {
    const par = batchesByCode[inp.code].find((p) => p.batch_id === inp.batch)!
    remaining[par.id] -= inp.grams
    return { job_id: job.id, parent_item_id: par.id, required_weight_g: inp.grams, material_cost: inp.grams * (Number(par.total_cost) / Number(par.total_weight_g)) }
  })
  await ins('job_parents', jp)
  if (status !== 'Created') await ins('job_time_events', [{ job_id: job.id, event_type: 'start', at: iso(startMs) }])
  if (opts.held) await ins('job_time_events', [{ job_id: job.id, event_type: 'hold', at: iso(startMs + 20 * 60_000) }])
}
await simpleJob('Created', { processType: 'Machine', machine: 'MC-02', operator: 'EMP07', output: CSHW, inputs: [{ code: CSHW, batch: chooseBatch(CSHW).batch_id, grams: 25000 }] })
await simpleJob('Processing', { processType: 'Machine', machine: 'MC-03', operator: 'EMP08', output: ALMD, inputs: [{ code: ALMD, batch: chooseBatch(ALMD).batch_id, grams: 30000 }], startedMinAgo: 75 })
await simpleJob('On Hold', { processType: 'Manual', operator: 'EMP09', output: RAIS, inputs: [{ code: RAIS, batch: chooseBatch(RAIS).batch_id, grams: 22000 }], startedMinAgo: 95, held: true })

// ─────────────────────────── 7. Scenario assertions ───────────────────────────
console.log('\n──────── SCENARIO TESTS ────────')
const results: { name: string; ok: boolean }[] = []
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

const q = async (t: string) => (await supabase.from(t).select('*')).data ?? []
const allParents: any[] = await q('parent_items')
const allJP: any[] = await q('job_parents')
const allJobs: any[] = await q('repack_jobs')
const allChildren: any[] = await q('child_skus')
const allSnaps: any[] = await q('job_cost_snapshot')
const allEvents: any[] = await q('job_time_events')
const mapRowsDb: any[] = await q('parent_child_map')

const drawn: Record<string, number> = {}
for (const jp of allJP) drawn[jp.parent_item_id] = (drawn[jp.parent_item_id] ?? 0) + Number(jp.required_weight_g)
check('No parent over-drawn (Σ draws ≤ total weight)', allParents.every((p) => (drawn[p.id] ?? 0) <= Number(p.total_weight_g) + 1e-6))

const completedJobs = allJobs.filter((j) => j.status === 'Completed')
check('Snapshot exists for every completed job', completedJobs.every((j) => allSnaps.some((s) => s.job_id === j.id)), `${completedJobs.length} completed`)

let cInv = true
for (const s of allSnaps) {
  const sumChild = allChildren.filter((c) => c.job_id === s.job_id).reduce((a, c) => a + Number(c.total_value), 0)
  if (Math.abs(sumChild - Number(s.total_batch_cost)) > 0.5) cInv = false
}
check('Σ child total_value == total_batch_cost (per job)', cInv)
check('Manual jobs have machine cost = 0', allSnaps.filter((s) => s.process_type === 'Manual').every((s) => Number(s.machine_cost) === 0))
check('Machine jobs have machine cost > 0', allSnaps.filter((s) => s.process_type === 'Machine').every((s) => Number(s.machine_cost) > 0))

const holdJobIds = new Set(allEvents.filter((e) => e.event_type === 'hold').map((e) => e.job_id))
const completedHolds = completedJobs.filter((j) => holdJobIds.has(j.id))
check('On-Hold excluded from active time (active < wall-clock)', completedHolds.length > 0 && completedHolds.every((j) => Number(j.active_seconds) < (new Date(j.complete_at).getTime() - new Date(j.start_at).getTime()) / 1000 - 1), `${completedHolds.length} held`)

const blendSnaps = allSnaps.filter((s) => [TRMX, NTMX].includes(s.output_product_code))
let blendOk = blendSnaps.length > 0
for (const s of blendSnaps) {
  const kids = allChildren.filter((c) => c.job_id === s.job_id)
  const inputs = allJP.filter((jp) => jp.job_id === s.job_id).map((jp) => allParents.find((p) => p.id === jp.parent_item_id))
  const latest = inputs.map((p) => p.expiry_date).filter(Boolean).sort().at(-1)
  if (inputs.length < 2 || !kids.every((c) => c.expiry_date === latest)) blendOk = false
}
check('Blends: multi-input + child expiry = latest input', blendOk, `${blendSnaps.length} blends`)

let idOk = true
for (const c of allChildren) {
  const m = mapRowsDb.find((r) => r.parent_code === c.output_product_code && Number(r.pack_size_g) === Number(c.pack_size_g))
  if (!m || c.child_item_code !== m.child_code || c.child_barcode !== m.child_barcode) { idOk = false; break }
}
check('Child identity (code+barcode) from Parent-Child Master', idOk)

check('Yield % == output/input × 100', allSnaps.every((s) => Math.abs((Number(s.input_weight_g) ? (Number(s.output_weight_g) / Number(s.input_weight_g)) * 100 : 0) - Number(s.yield_pct)) < 0.1))

const byStatus = (st: string) => allJobs.filter((j) => j.status === st).length
check('Status pipeline has all states', ['Created', 'Processing', 'On Hold', 'Completed'].every((st) => byStatus(st) >= 1), `C${byStatus('Created')} P${byStatus('Processing')} H${byStatus('On Hold')} ✓${byStatus('Completed')}`)

const months = new Set(allSnaps.map((s) => String(s.completed_on).slice(0, 7)))
check('Data spans multiple months', months.size >= 4, `${months.size} months: ${[...months].sort().join(', ')}`)

const snapBy = (pt: string) => allSnaps.filter((s) => s.process_type === pt)
const avgY = (rows: any[]) => (rows.length ? rows.reduce((a, s) => a + Number(s.yield_pct), 0) / rows.length : 0)
const costPP = (rows: any[]) => { const p = rows.reduce((a, s) => a + Number(s.packs_produced), 0); return p ? rows.reduce((a, s) => a + Number(s.total_batch_cost), 0) / p : 0 }
const mach = snapBy('Machine'), man = snapBy('Manual')
check('Machine avg yield > Manual avg yield', avgY(mach) > avgY(man), `M ${avgY(mach).toFixed(1)}% vs ${avgY(man).toFixed(1)}%`)
check('Machine cost/pack < Manual cost/pack', costPP(mach) < costPP(man), `M ${costPP(mach).toFixed(3)} vs ${costPP(man).toFixed(3)}`)

// ─────────────────────────── 8. Summary ───────────────────────────
const passed = results.filter((r) => r.ok).length
console.log('\n──────── SUMMARY ────────')
console.log(`Parents: ${allParents.length} | Jobs: ${allJobs.length} (Completed ${completedJobs.length}) | Child SKUs: ${allChildren.length} | Snapshots: ${allSnaps.length}`)
console.log(`Tests: ${passed}/${results.length} passed`)
if (passed !== results.length) { console.error('SOME TESTS FAILED'); process.exit(1) }
console.log('All scenario tests passed ✅')
process.exit(0)
