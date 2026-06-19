import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { dateTime, dateOnly } from '../lib/format'
import { formatWeight } from '../lib/units'
import type { Employee, Machine, ParentChildMap, ParentItem, ProcessType, RepackJob } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, StatusBadge } from '../components/ui'

// Days from today until a YYYY-MM-DD date (negative = already expired).
function daysUntil(d: string | null): number | null {
  if (!d) return null
  return Math.ceil((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86_400_000)
}
function expTone(days: number | null): string {
  if (days == null) return 'text-slate-400'
  if (days < 0) return 'text-rose-600'
  if (days <= 30) return 'text-amber-600'
  return 'text-emerald-600'
}

interface JobRow extends RepackJob {
  parent: ParentItem | null
}

interface RefData {
  parents: ParentItem[]
  machines: Machine[]
  employees: Employee[]
  products: { code: string; description: string }[]
  consumed: Record<string, number>
}

export default function Jobs() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  const jobs = useData<JobRow[]>(async () => {
    const { data, error } = await supabase
      .from('repack_jobs')
      .select('*, parent:parent_items(*)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as JobRow[]
  }, [])

  async function deleteJob(job: JobRow) {
    if (!confirm('Delete this repacking job?\n\nThis also deletes its inputs, time log, output lines, wastage, and any generated child SKUs.'))
      return
    await supabase.from('repack_jobs').delete().eq('id', job.id)
    void jobs.refresh()
  }

  const refData = useData<RefData>(async () => {
    const [p, m, e, map, jp] = await Promise.all([
      supabase.from('parent_items').select('*').order('expiry_date', { ascending: true, nullsFirst: false }),
      supabase.from('machines').select('*').eq('active', true).order('code'),
      supabase.from('employees').select('*').eq('active', true).order('code'),
      supabase.from('parent_child_map').select('parent_code, parent_description').eq('active', true),
      supabase.from('job_parents').select('parent_item_id, required_weight_g'),
    ])
    const consumed: Record<string, number> = {}
    for (const r of (jp.data ?? []) as { parent_item_id: string; required_weight_g: number }[]) {
      consumed[r.parent_item_id] = (consumed[r.parent_item_id] ?? 0) + Number(r.required_weight_g)
    }
    const seen = new Set<string>()
    const products: { code: string; description: string }[] = []
    for (const r of (map.data ?? []) as Pick<ParentChildMap, 'parent_code' | 'parent_description'>[]) {
      if (r.parent_code && !seen.has(r.parent_code)) {
        seen.add(r.parent_code)
        products.push({ code: r.parent_code, description: r.parent_description })
      }
    }
    return { parents: p.data ?? [], machines: m.data ?? [], employees: e.data ?? [], products, consumed }
  }, [])

  return (
    <div>
      <PageHeader
        title="Repacking Jobs"
        subtitle="Create a job: pick Machine or Manual, draw weight from one or more parents, then run it."
        actions={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Close' : '+ Create Job'}
          </button>
        }
      />

      {creating && (
        <CreateJob
          refData={refData.data}
          onCreated={(id) => {
            setCreating(false)
            void jobs.refresh()
            void refData.refresh()
            navigate(`/jobs/${id}`)
          }}
        />
      )}

      <Section title="All Jobs">
        {jobs.loading ? (
          <Spinner />
        ) : jobs.error ? (
          <Banner tone="error">{jobs.error}</Banner>
        ) : !jobs.data || jobs.data.length === 0 ? (
          <Empty>No jobs yet. Create one to begin.</Empty>
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 md:hidden">
              {jobs.data.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="block rounded-xl border border-slate-200 bg-white p-3 active:bg-slate-50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{j.output_product_code || j.parent?.item_code || 'Job'}</div>
                      <div className="text-xs text-slate-500">{j.process_type}</div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>🛠 {j.machine_code ?? 'Manual'}</span>
                    <span>👷 {j.operator_code}</span>
                    <span>🕒 {dateTime(j.created_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="text-sm font-medium text-brand">Open →</span>
                    <button className="text-sm text-rose-600" onClick={(e) => { e.preventDefault(); deleteJob(j) }}>
                      Delete
                    </button>
                  </div>
                </Link>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    {['Output', 'Type', 'Machine', 'Operator', 'Status', 'Created', ''].map((h) => (
                      <th key={h} className="th">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.map((j) => (
                    <tr key={j.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="td font-medium">{j.output_product_code || j.parent?.item_code || '—'}</td>
                      <td className="td">{j.process_type}</td>
                      <td className="td">{j.machine_code ?? '—'}</td>
                      <td className="td">{j.operator_code}</td>
                      <td className="td"><StatusBadge status={j.status} /></td>
                      <td className="td">{dateTime(j.created_at)}</td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link to={`/jobs/${j.id}`} className="font-medium text-brand hover:underline">Open →</Link>
                          <button className="text-rose-600 hover:underline" onClick={() => deleteJob(j)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </div>
  )
}

function CreateJob({ refData, onCreated }: { refData: RefData | null; onCreated: (id: string) => void }) {
  const [processType, setProcessType] = useState<ProcessType>('Machine')
  const [machine, setMachine] = useState('')
  const [operator, setOperator] = useState('')
  const [outputProduct, setOutputProduct] = useState('')
  const [selected, setSelected] = useState<Record<string, string>>({}) // parentId → kg string
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false) // parent dropdown open
  const [qtyFor, setQtyFor] = useState<ParentItem | null>(null) // parent awaiting a qty entry
  const [qtyInput, setQtyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default machine/operator to the first active entry once data arrives.
  useEffect(() => {
    if (!refData) return
    setMachine((m) => m || refData.machines[0]?.code || '')
    setOperator((o) => o || refData.employees[0]?.code || '')
  }, [refData])

  const parentsById = useMemo(() => {
    const map: Record<string, ParentItem> = {}
    for (const p of refData?.parents ?? []) map[p.id] = p
    return map
  }, [refData])

  const remainingG = (p: ParentItem) => Number(p.total_weight_g) - (refData?.consumed[p.id] ?? 0)
  // FEFO: warn if an earlier-expiry batch of the same product still has stock.
  const fefoWarn = (p: ParentItem) =>
    (refData?.parents ?? []).some((o) => o.item_code === p.item_code && o.id !== p.id && remainingG(o) > 0 && !!o.expiry_date && !!p.expiry_date && o.expiry_date < p.expiry_date)

  const selectedEntries = Object.entries(selected).filter(([, w]) => Number(w) > 0)
  const totalDrawnG = selectedEntries.reduce((s, [, w]) => s + (Number(w) || 0) * 1000, 0)
  const selectedCodes = [...new Set(selectedEntries.map(([pid]) => parentsById[pid]?.item_code).filter(Boolean))]
  const defaultOutput = selectedCodes.length === 1 ? selectedCodes[0] : ''
  const effectiveOutput = outputProduct || defaultOutput
  const showOutput = selectedEntries.length > 1 // only a mix needs a chosen output product

  const outputOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { code: string; description: string }[] = []
    for (const pr of refData?.products ?? []) if (!seen.has(pr.code)) { seen.add(pr.code); opts.push(pr) }
    for (const c of selectedCodes) if (c && !seen.has(c)) { seen.add(c); opts.push({ code: c, description: parentsById[Object.keys(selected).find((id) => parentsById[id]?.item_code === c) ?? '']?.description ?? '' }) }
    return opts
  }, [refData, selectedCodes, selected, parentsById])

  const qtyMaxKg = qtyFor ? remainingG(qtyFor) / 1000 : 0
  const qtyValid = Number(qtyInput) > 0 && Number(qtyInput) <= qtyMaxKg + 1e-9

  function onCheck(p: ParentItem) {
    if (p.id in selected) {
      setSelected((s) => { const n = { ...s }; delete n[p.id]; return n }) // uncheck → remove
    } else {
      setQtyInput('') // checking a new parent → prompt for the draw qty
      setQtyFor(p)
    }
  }
  function editQty(p: ParentItem) { setQtyInput(selected[p.id] ?? ''); setQtyFor(p) }
  function confirmQty() {
    if (!qtyFor || !qtyValid) return
    setSelected((s) => ({ ...s, [qtyFor.id]: qtyInput }))
    setQtyFor(null); setQtyInput('')
  }
  function removeSelected(id: string) { setSelected((s) => { const n = { ...s }; delete n[id]; return n }) }

  async function create() {
    setError(null)
    if (!operator) return setError('Select an operator.')
    if (processType === 'Machine' && !machine) return setError('Select a machine.')
    if (selectedEntries.length === 0) return setError('Select at least one parent.')
    if (!effectiveOutput) return setError('Select the output product for this mix.')
    for (const [pid, w] of selectedEntries) {
      const p = parentsById[pid]
      const rem = remainingG(p)
      if (Number(w) * 1000 > rem + 1e-6) return setError(`Weight drawn from ${p.item_code} (${Number(w)} kg) exceeds remaining ${formatWeight(rem)}.`)
    }
    setBusy(true)
    const primary = selectedEntries[0][0]
    const { data: job, error: e1 } = await supabase
      .from('repack_jobs')
      .insert({
        parent_item_id: primary,
        machine_code: processType === 'Machine' ? machine : null,
        operator_code: operator,
        process_type: processType,
        output_product_code: effectiveOutput,
        status: 'Created',
      })
      .select('id')
      .single()
    if (e1 || !job) { setBusy(false); return setError(e1?.message ?? 'Failed to create job.') }
    // Consume each parent atomically (locks the row, re-checks remaining). Falls back to a
    // plain insert if the consume_parent function isn't deployed yet (PostgREST code PGRST202).
    for (const [pid, w] of selectedEntries) {
      const p = parentsById[pid]
      const grams = Number(w) * 1000
      const cpg = Number(p.total_weight_g) > 0 ? Number(p.total_cost) / Number(p.total_weight_g) : 0
      const { error: rpcErr } = await supabase.rpc('consume_parent', { p_job_id: job.id, p_parent_id: pid, p_weight_g: grams })
      if (rpcErr) {
        if (rpcErr.code === 'PGRST202') {
          const { error: insErr } = await supabase.from('job_parents').insert({ job_id: job.id, parent_item_id: pid, required_weight_g: grams, material_cost: grams * cpg })
          if (insErr) { setBusy(false); return setError(insErr.message) }
        } else { setBusy(false); return setError(rpcErr.message) }
      }
    }
    setBusy(false)
    onCreated(job.id)
  }

  if (!refData) return <Section title="Create Job"><Spinner /></Section>

  const filtered = refData.parents.filter((p) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return p.description.toLowerCase().includes(q) || p.item_code.toLowerCase().includes(q)
  })
  // Soonest in-stock batch among the current results (list is already expiry-sorted) → "Use first".
  const soonestId = filtered.find((p) => remainingG(p) > 0 && !!p.expiry_date)?.id ?? null
  const bigBtn = (active: boolean) =>
    `flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 py-6 text-base font-bold transition ${
      active ? 'border-brand bg-brand-50 text-brand-700 shadow-soft' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
    }`

  return (
    <Section title="Create Job">
      {refData.parents.length === 0 && (
        <Banner tone="warn">No parent items yet — receive some on the Parent Receipt screen first.</Banner>
      )}

      {/* Process type — big buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={bigBtn(processType === 'Machine')} onClick={() => setProcessType('Machine')}>
          <span className="text-2xl" aria-hidden>🛠️</span>
          Machine
        </button>
        <button type="button" className={bigBtn(processType === 'Manual')} onClick={() => setProcessType('Manual')}>
          <span className="text-2xl" aria-hidden>✋</span>
          Manual
        </button>
      </div>

      {/* Machine line + operator */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {processType === 'Machine' && (
          <div>
            <label className="label">Machine</label>
            <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)}>
              {refData.machines.map((m) => (<option key={m.id} value={m.code}>{m.code}</option>))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Operator</label>
          <select className="input" value={operator} onChange={(e) => setOperator(e.target.value)}>
            {refData.employees.map((e) => (<option key={e.id} value={e.code}>{e.code} — {e.name}</option>))}
          </select>
        </div>
      </div>

      {/* Parent selection — dropdown */}
      <div className="mt-5">
        <label className="label">Parents</label>
        <button type="button" className="input flex items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
          <span className={selectedEntries.length ? 'text-slate-800' : 'text-slate-400'}>
            {selectedEntries.length ? `${selectedEntries.length} selected • ${formatWeight(totalDrawnG)}` : 'Click to select parents…'}
          </span>
          <span className="text-slate-400">{open ? '▴' : '▾'}</span>
        </button>

        {/* selected chips */}
        {selectedEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedEntries.map(([pid, w]) => (
              <span key={pid} className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-sm text-brand-700">
                <button type="button" className="font-medium" onClick={() => editQty(parentsById[pid])}>{parentsById[pid]?.item_code}: {w} kg</button>
                <button type="button" className="text-brand-700/60 hover:text-rose-600" onClick={() => removeSelected(pid)} aria-label="Remove">✕</button>
              </span>
            ))}
          </div>
        )}

        {/* dropdown panel */}
        {open && (
          <div className="mt-2 overflow-hidden rounded-xl border border-slate-200 shadow-card">
            <div className="border-b border-slate-100 p-2">
              <input className="input" autoFocus placeholder="Search description / ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
              <p className="mt-1 px-1 text-[11px] font-medium text-slate-400">↓ Soonest expiry first — use the top one first</p>
            </div>
            <div className="max-h-64 overflow-auto">
              {filtered.length === 0 ? (
                <div className="p-3 text-sm text-slate-400">No parents match.</div>
              ) : (
                filtered.map((p) => {
                  const checked = p.id in selected
                  const rem = remainingG(p)
                  const days = daysUntil(p.expiry_date)
                  return (
                    <label key={p.id} className={`flex cursor-pointer items-center gap-3 border-b border-slate-50 px-3 py-2 ${checked ? 'bg-brand-50/40' : 'hover:bg-slate-50'}`}>
                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={checked} disabled={rem <= 0 && !checked} onChange={() => onCheck(p)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 font-medium text-slate-800">
                            {p.item_code}
                            {p.id === soonestId && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">⏱ Use first</span>}
                          </span>
                          <span className={`shrink-0 text-xs font-semibold ${expTone(days)}`}>
                            {days == null ? 'no expiry' : days < 0 ? `expired ${-days}d ago` : `${days}d left`}
                          </span>
                        </span>
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-500">{p.description}</span>
                          <span className={`shrink-0 text-[11px] ${rem <= 0 ? 'text-rose-500' : 'text-slate-400'}`}>{formatWeight(rem)} left</span>
                        </span>
                        <span className="block text-[11px] text-slate-400">Exp {dateOnly(p.expiry_date)}{fefoWarn(p) && <span className="ml-1 text-amber-600">• earlier batch in stock</span>}</span>
                      </span>
                    </label>
                  )
                })
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 p-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setOpen(false); setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 250) }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Output product — only for a mix (more than one parent) */}
      {showOutput && (
        <div className="mt-4">
          <label className="label">Output product</label>
          <select className="input" value={effectiveOutput} onChange={(e) => setOutputProduct(e.target.value)}>
            <option value="">Select…</option>
            {outputOptions.map((o) => (<option key={o.code} value={o.code}>{o.code}{o.description ? ` — ${o.description}` : ''}</option>))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Multiple parents selected — choose the product this job produces.</p>
        </div>
      )}

      {error && <Banner tone="error"><div className="mt-3">{error}</div></Banner>}

      <div className="mt-5 flex items-center gap-2">
        <span className="text-xs text-slate-400">Date/time &amp; status are captured automatically.</span>
        <button className="btn-primary ml-auto" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create Job'}</button>
      </div>

      {/* Required-qty prompt — portal to body, centred modal */}
      {qtyFor && createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4" onClick={() => { setQtyFor(null); setQtyInput('') }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lift" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900">Required quantity</h3>
            <p className="mt-1 text-sm text-slate-600">{qtyFor.item_code} — {qtyFor.description}</p>
            <p className="mt-0.5 text-xs text-slate-400">Available: {formatWeight(remainingG(qtyFor))}</p>
            <label className="label mt-4">Weight to draw (kg)</label>
            <input
              className="input text-base"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={qtyInput}
              max={qtyMaxKg}
              placeholder={`≤ ${qtyMaxKg.toFixed(1)}`}
              onChange={(e) => setQtyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmQty() }}
            />
            {qtyInput !== '' && !qtyValid && <div className="mt-1.5 text-xs text-rose-600">Enter a value between 0 and {qtyMaxKg.toFixed(1)} kg.</div>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={() => { setQtyFor(null); setQtyInput('') }}>Cancel</button>
              <button type="button" className="btn-primary" onClick={confirmQty} disabled={!qtyValid}>Add</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </Section>
  )
}
