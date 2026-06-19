/* Demo seeder + scenario tests. Runs against the live Supabase (uses .env).
   WIPES all data, inserts realistic demo data, drives jobs through the REAL app
   logic (cost/time/childMap), then asserts end-to-end invariants.
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

// ─────────────────────────── 3. Parent-Child Master ───────────────────────────
const PRODUCTS: Record<string, { desc: string; cat: string; sizes: number[] }> = {
  CASHEW: { desc: 'Cashew Nuts W320', cat: 'Nuts', sizes: [100, 250, 500] },
  ALMOND: { desc: 'Almonds Nonpareil', cat: 'Nuts', sizes: [100, 250, 500] },
  PISTA: { desc: 'Pistachios Roasted & Salted', cat: 'Nuts', sizes: [100, 250] },
  WALNUT: { desc: 'Walnut Halves', cat: 'Nuts', sizes: [250, 500] },
  RAISIN: { desc: 'Golden Raisins', cat: 'Dried Fruit', sizes: [250, 500, 1000] },
  APRICOT: { desc: 'Turkish Apricots', cat: 'Dried Fruit', sizes: [250, 500] },
  TRAILMIX: { desc: 'Premium Trail Mix', cat: 'Mixes', sizes: [100, 250, 500] },
  NUTMIX: { desc: 'Deluxe Nut Mix', cat: 'Mixes', sizes: [250, 500] },
}
let barcode = 8_901_234_500_001
const mapRows: any[] = []
for (const [code, p] of Object.entries(PRODUCTS))
  for (const s of p.sizes)
    mapRows.push({
      parent_code: code, parent_description: p.desc, category: p.cat, pack_size_g: s,
      child_code: `${code}-${s}`, child_description: `${p.desc} ${sizeLabel(s)} Pack`,
      child_barcode: String(barcode++), active: true,
    })
await ins('parent_child_map', mapRows)
const { data: MAP } = await supabase.from('parent_child_map').select('*')

// ─────────────────────────── 4. Parent receipts ───────────────────────────
const COST_PER_KG: Record<string, number> = { CASHEW: 8.2, ALMOND: 7.1, PISTA: 13.5, WALNUT: 9.4, RAISIN: 2.9, APRICOT: 5.6 }
// code, batch, bags, kg/bag, daysToExpiry, warehouse  (some near-expiry → FEFO demo)
const BATCHES = [
  ['CASHEW', 'CSW-2406A', 12, 25, 240, 'WH-A'], ['CASHEW', 'CSW-2405B', 8, 25, 70, 'WH-A'],
  ['ALMOND', 'ALM-2406A', 10, 25, 300, 'WH-A'], ['ALMOND', 'ALM-2404C', 6, 25, 110, 'WH-B'],
  ['PISTA', 'PST-2406A', 8, 22, 200, 'WH-A'],
  ['WALNUT', 'WLN-2405A', 9, 20, 150, 'WH-B'],
  ['RAISIN', 'RSN-2406A', 14, 12.5, 330, 'WH-C'], ['RAISIN', 'RSN-2405B', 10, 12.5, 60, 'WH-C'],
  ['APRICOT', 'APR-2406A', 7, 10, 210, 'WH-C'],
] as const
const parentInsert = BATCHES.map(([code, batch, qty, wpu, exp, wh]) =>
  parentRow({
    item_code: code as string, description: PRODUCTS[code].desc, category: PRODUCTS[code].cat,
    batch_id: batch as string, qty: qty as number, weight_per_unit: wpu as number, weight_unit: 'kg',
    expiry_date: isoDate(now + (exp as number) * DAY), total_cost: (qty as number) * (wpu as number) * COST_PER_KG[code],
    warehouse_name: wh as string,
  }),
)
const parents = await ins('parent_items', parentInsert)
const pKey: Record<string, any> = {}
const remaining: Record<string, number> = {}
for (const row of parents) { pKey[`${row.item_code}|${row.batch_id}`] = row; remaining[row.id] = Number(row.total_weight_g) }

// ─────────────────────────── 5. Completed jobs (via real logic) ───────────────────────────
interface Spec {
  daysAgo: number; hour: number; processType: 'Machine' | 'Manual'; machine?: string; operator: string
  output: string; size: number; yield: number; durMin: number; holdMin?: number
  inputs: { code: string; batch: string; grams: number }[]; extraWaste?: number; extraReason?: string
}
const COMPLETED: Spec[] = [
  { daysAgo: 26, hour: 9, processType: 'Machine', machine: 'MC-01', operator: 'EMP01', output: 'CASHEW', size: 250, yield: 0.95, durMin: 95, inputs: [{ code: 'CASHEW', batch: 'CSW-2406A', grams: 60000 }] },
  { daysAgo: 24, hour: 14, processType: 'Manual', operator: 'EMP05', output: 'RAISIN', size: 500, yield: 0.97, durMin: 140, inputs: [{ code: 'RAISIN', batch: 'RSN-2405B', grams: 50000 }] },
  { daysAgo: 22, hour: 10, processType: 'Machine', machine: 'MC-02', operator: 'EMP02', output: 'ALMOND', size: 100, yield: 0.93, durMin: 110, holdMin: 35, inputs: [{ code: 'ALMOND', batch: 'ALM-2404C', grams: 40000 }], extraWaste: 600, extraReason: 'Machine Loss' },
  { daysAgo: 20, hour: 15, processType: 'Machine', machine: 'MC-03', operator: 'EMP03', output: 'PISTA', size: 100, yield: 0.9, durMin: 130, inputs: [{ code: 'PISTA', batch: 'PST-2406A', grams: 35000 }], extraWaste: 900, extraReason: 'Shrinkage' },
  { daysAgo: 18, hour: 9, processType: 'Manual', operator: 'EMP06', output: 'APRICOT', size: 250, yield: 0.96, durMin: 120, inputs: [{ code: 'APRICOT', batch: 'APR-2406A', grams: 30000 }] },
  { daysAgo: 16, hour: 11, processType: 'Machine', machine: 'MC-01', operator: 'EMP04', output: 'TRAILMIX', size: 250, yield: 0.94, durMin: 150, inputs: [{ code: 'CASHEW', batch: 'CSW-2406A', grams: 20000 }, { code: 'ALMOND', batch: 'ALM-2406A', grams: 15000 }, { code: 'RAISIN', batch: 'RSN-2406A', grams: 15000 }], extraWaste: 800, extraReason: 'Spillage' },
  { daysAgo: 14, hour: 16, processType: 'Machine', machine: 'MC-02', operator: 'EMP07', output: 'WALNUT', size: 250, yield: 0.92, durMin: 100, inputs: [{ code: 'WALNUT', batch: 'WLN-2405A', grams: 45000 }] },
  { daysAgo: 12, hour: 8, processType: 'Manual', operator: 'EMP08', output: 'CASHEW', size: 500, yield: 0.96, durMin: 160, inputs: [{ code: 'CASHEW', batch: 'CSW-2405B', grams: 55000 }] },
  { daysAgo: 10, hour: 13, processType: 'Machine', machine: 'MC-03', operator: 'EMP09', output: 'NUTMIX', size: 500, yield: 0.93, durMin: 170, holdMin: 25, inputs: [{ code: 'CASHEW', batch: 'CSW-2406A', grams: 18000 }, { code: 'ALMOND', batch: 'ALM-2406A', grams: 18000 }, { code: 'WALNUT', batch: 'WLN-2405A', grams: 12000 }, { code: 'PISTA', batch: 'PST-2406A', grams: 12000 }] },
  { daysAgo: 8, hour: 10, processType: 'Machine', machine: 'MC-01', operator: 'EMP10', output: 'ALMOND', size: 250, yield: 0.95, durMin: 105, inputs: [{ code: 'ALMOND', batch: 'ALM-2406A', grams: 50000 }] },
  { daysAgo: 6, hour: 15, processType: 'Manual', operator: 'EMP01', output: 'RAISIN', size: 1000, yield: 0.98, durMin: 90, inputs: [{ code: 'RAISIN', batch: 'RSN-2406A', grams: 60000 }] },
  { daysAgo: 5, hour: 9, processType: 'Machine', machine: 'MC-02', operator: 'EMP02', output: 'CASHEW', size: 100, yield: 0.91, durMin: 115, inputs: [{ code: 'CASHEW', batch: 'CSW-2406A', grams: 30000 }], extraWaste: 700, extraReason: 'QC Rejects' },
  { daysAgo: 3, hour: 14, processType: 'Machine', machine: 'MC-03', operator: 'EMP03', output: 'TRAILMIX', size: 100, yield: 0.92, durMin: 135, inputs: [{ code: 'CASHEW', batch: 'CSW-2405B', grams: 12000 }, { code: 'ALMOND', batch: 'ALM-2404C', grams: 10000 }, { code: 'RAISIN', batch: 'RSN-2405B', grams: 10000 }] },
  { daysAgo: 2, hour: 11, processType: 'Manual', operator: 'EMP05', output: 'WALNUT', size: 500, yield: 0.94, durMin: 145, inputs: [{ code: 'WALNUT', batch: 'WLN-2405A', grams: 40000 }] },
  { daysAgo: 1, hour: 16, processType: 'Machine', machine: 'MC-01', operator: 'EMP06', output: 'PISTA', size: 250, yield: 0.93, durMin: 100, inputs: [{ code: 'PISTA', batch: 'PST-2406A', grams: 38000 }] },
]

async function completedJob(s: Spec) {
  const stopMs = now - s.daysAgo * DAY + (s.hour - 12) * 3_600_000
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
    const par = pKey[`${inp.code}|${inp.batch}`]
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

  const primary = pKey[`${s.inputs[0].code}|${s.inputs[0].batch}`]
  const [job] = await ins('repack_jobs', [{
    parent_item_id: primary.id,
    machine_code: s.processType === 'Machine' ? s.machine : null, operator_code: s.operator,
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
  return job.id
}

console.log(`Seeding ${COMPLETED.length} completed jobs…`)
for (const s of COMPLETED) await completedJob(s)

// ─────────────────────────── 6. In-flight jobs (pipeline) ───────────────────────────
async function simpleJob(status: string, opts: { processType: 'Machine' | 'Manual'; machine?: string; operator: string; output: string; inputs: { code: string; batch: string; grams: number }[]; startedMinAgo?: number; held?: boolean }) {
  const startMs = now - (opts.startedMinAgo ?? 60) * 60_000
  const [job] = await ins('repack_jobs', [{
    parent_item_id: pKey[`${opts.inputs[0].code}|${opts.inputs[0].batch}`].id,
    machine_code: opts.processType === 'Machine' ? opts.machine : null, operator_code: opts.operator,
    process_type: opts.processType, output_product_code: opts.output, status,
    shift: status === 'Created' ? null : shiftFromIso(iso(startMs)),
    start_at: status === 'Created' ? null : iso(startMs),
  }])
  const jp = opts.inputs.map((inp) => {
    const par = pKey[`${inp.code}|${inp.batch}`]
    remaining[par.id] -= inp.grams
    return { job_id: job.id, parent_item_id: par.id, required_weight_g: inp.grams, material_cost: inp.grams * (Number(par.total_cost) / Number(par.total_weight_g)) }
  })
  await ins('job_parents', jp)
  if (status !== 'Created') await ins('job_time_events', [{ job_id: job.id, event_type: 'start', at: iso(startMs) }])
  if (opts.held) await ins('job_time_events', [{ job_id: job.id, event_type: 'hold', at: iso(startMs + 20 * 60_000) }])
  return job.id
}
await simpleJob('Created', { processType: 'Machine', machine: 'MC-02', operator: 'EMP07', output: 'CASHEW', inputs: [{ code: 'CASHEW', batch: 'CSW-2406A', grams: 25000 }] })
await simpleJob('Processing', { processType: 'Machine', machine: 'MC-03', operator: 'EMP08', output: 'ALMOND', inputs: [{ code: 'ALMOND', batch: 'ALM-2406A', grams: 30000 }], startedMinAgo: 75 })
await simpleJob('On Hold', { processType: 'Manual', operator: 'EMP09', output: 'RAISIN', inputs: [{ code: 'RAISIN', batch: 'RSN-2406A', grams: 22000 }], startedMinAgo: 95, held: true })

// ─────────────────────────── 7. Scenario assertions ───────────────────────────
console.log('\n──────── SCENARIO TESTS ────────')
const results: { name: string; ok: boolean; detail?: string }[] = []
const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }

const q = async (t: string, sel = '*') => (await supabase.from(t).select(sel)).data ?? []
const allParents: any[] = await q('parent_items')
const allJP: any[] = await q('job_parents')
const allJobs: any[] = await q('repack_jobs')
const allChildren: any[] = await q('child_skus')
const allSnaps: any[] = await q('job_cost_snapshot')
const allEvents: any[] = await q('job_time_events')
const mapRowsDb: any[] = await q('parent_child_map')

// A. No parent over-drawn
const drawn: Record<string, number> = {}
for (const jp of allJP) drawn[jp.parent_item_id] = (drawn[jp.parent_item_id] ?? 0) + Number(jp.required_weight_g)
const overdrawn = allParents.filter((p) => (drawn[p.id] ?? 0) > Number(p.total_weight_g) + 1e-6)
check('No parent over-drawn (Σ draws ≤ total weight)', overdrawn.length === 0, overdrawn.map((p) => p.item_code).join(', '))

// B. Snapshot per completed job
const completedJobs = allJobs.filter((j) => j.status === 'Completed')
check('Snapshot exists for every completed job', completedJobs.every((j) => allSnaps.some((s) => s.job_id === j.id)), `${completedJobs.length} completed, ${allSnaps.length} snapshots`)

// C. Cost invariant: Σ child total_value ≈ snapshot total_batch_cost
let cInv = true, cBad = ''
for (const s of allSnaps) {
  const sumChild = allChildren.filter((c) => c.job_id === s.job_id).reduce((a, c) => a + Number(c.total_value), 0)
  if (Math.abs(sumChild - Number(s.total_batch_cost)) > 0.5) { cInv = false; cBad = `job ${s.job_id.slice(0, 8)}: Σchild ${sumChild.toFixed(2)} vs batch ${Number(s.total_batch_cost).toFixed(2)}` }
}
check('Σ child total_value == total_batch_cost (per job)', cInv, cBad)

// D. Manual ⇒ machine cost 0; Machine ⇒ machine cost > 0
const manualBad = allSnaps.filter((s) => s.process_type === 'Manual' && Number(s.machine_cost) !== 0)
const machineBad = allSnaps.filter((s) => s.process_type === 'Machine' && Number(s.machine_cost) <= 0)
check('Manual jobs have machine cost = 0', manualBad.length === 0)
check('Machine jobs have machine cost > 0', machineBad.length === 0)

// E. Active time excludes On-Hold (jobs with a hold: active < wall-clock)
const holdJobIds = new Set(allEvents.filter((e) => e.event_type === 'hold').map((e) => e.job_id))
const completedHolds = completedJobs.filter((j) => holdJobIds.has(j.id))
let holdOk = completedHolds.length > 0
for (const j of completedHolds) {
  const wall = (new Date(j.complete_at).getTime() - new Date(j.start_at).getTime()) / 1000
  if (!(Number(j.active_seconds) < wall - 1)) holdOk = false
}
check('On-Hold excluded from active time (active < wall-clock)', holdOk, `${completedHolds.length} held job(s)`)

// F. Blends (multi-input): child expiry = latest input expiry; output is the blend product
const blendSnaps = allSnaps.filter((s) => ['TRAILMIX', 'NUTMIX'].includes(s.output_product_code))
let blendOk = blendSnaps.length > 0
for (const s of blendSnaps) {
  const kids = allChildren.filter((c) => c.job_id === s.job_id)
  const inputs = allJP.filter((jp) => jp.job_id === s.job_id).map((jp) => allParents.find((p) => p.id === jp.parent_item_id))
  const latest = inputs.map((p) => p.expiry_date).filter(Boolean).sort().at(-1)
  if (inputs.length < 2) blendOk = false
  if (!kids.every((c) => c.expiry_date === latest)) blendOk = false
}
check('Blends: multi-input + child expiry = latest input', blendOk, `${blendSnaps.length} blend job(s)`)

// G. Child identity matches Parent-Child Master
let idOk = true, idBad = ''
for (const c of allChildren) {
  const m = mapRowsDb.find((r) => r.parent_code === c.output_product_code && Number(r.pack_size_g) === Number(c.pack_size_g))
  if (!m) { idOk = false; idBad = `no map for ${c.output_product_code}/${c.pack_size_g}`; break }
  if (c.child_item_code !== m.child_code || c.child_barcode !== m.child_barcode) { idOk = false; idBad = `${c.child_item_code} ≠ ${m.child_code}`; break }
}
check('Child identity (code+barcode) from Parent-Child Master', idOk, idBad)

// H. Yield math
let yOk = true
for (const s of allSnaps) {
  const expected = Number(s.input_weight_g) ? (Number(s.output_weight_g) / Number(s.input_weight_g)) * 100 : 0
  if (Math.abs(expected - Number(s.yield_pct)) > 0.1) yOk = false
}
check('Yield % == output/input × 100', yOk)

// I. Status pipeline populated
const byStatus = (st: string) => allJobs.filter((j) => j.status === st).length
check('Status pipeline has all states', ['Created', 'Processing', 'On Hold', 'Completed'].every((st) => byStatus(st) >= 1),
  `Created ${byStatus('Created')}, Processing ${byStatus('Processing')}, On Hold ${byStatus('On Hold')}, Completed ${byStatus('Completed')}`)

// ─────────────────────────── 8. Summary ───────────────────────────
const passed = results.filter((r) => r.ok).length
console.log('\n──────── SUMMARY ────────')
console.log(`Parents: ${allParents.length} | Jobs: ${allJobs.length} (Completed ${completedJobs.length}) | Child SKUs: ${allChildren.length} | Snapshots: ${allSnaps.length}`)
console.log(`Tests: ${passed}/${results.length} passed`)
if (passed !== results.length) { console.error('SOME TESTS FAILED'); process.exit(1) }
console.log('All scenario tests passed ✅')
process.exit(0)
