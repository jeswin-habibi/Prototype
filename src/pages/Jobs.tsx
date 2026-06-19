import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { dateTime, dateOnly } from '../lib/format'
import { formatWeight } from '../lib/units'
import type { Employee, Machine, ParentChildMap, ParentItem, ProcessType, RepackJob } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, StatusBadge } from '../components/ui'

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
  const [selected, setSelected] = useState<Record<string, string>>({}) // parentId → grams string
  const [search, setSearch] = useState('')
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
  const selectedCodes = [...new Set(selectedEntries.map(([pid]) => parentsById[pid]?.item_code).filter(Boolean))]
  const defaultOutput = selectedCodes.length === 1 ? selectedCodes[0] : ''
  const isBlend = selectedCodes.length > 1
  const effectiveOutput = outputProduct || defaultOutput

  const outputOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { code: string; description: string }[] = []
    for (const pr of refData?.products ?? []) if (!seen.has(pr.code)) { seen.add(pr.code); opts.push(pr) }
    for (const c of selectedCodes) if (c && !seen.has(c)) { seen.add(c); opts.push({ code: c, description: parentsById[Object.keys(selected).find((id) => parentsById[id]?.item_code === c) ?? '']?.description ?? '' }) }
    return opts
  }, [refData, selectedCodes, selected, parentsById])

  function toggle(p: ParentItem) {
    setSelected((s) => {
      const next = { ...s }
      if (p.id in next) delete next[p.id]
      else next[p.id] = ''
      return next
    })
  }
  function setWeight(id: string, v: string) {
    setSelected((s) => ({ ...s, [id]: v }))
  }

  async function create() {
    setError(null)
    if (!operator) return setError('Select an operator.')
    if (processType === 'Machine' && !machine) return setError('Select a machine.')
    if (selectedEntries.length === 0) return setError('Select at least one parent and enter a weight to draw.')
    if (!effectiveOutput) return setError('Select the output product for this blend.')
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

  return (
    <Section title="Create Job">
      {refData.parents.length === 0 && (
        <Banner tone="warn">No parent items yet — receive some on the Parent Receipt screen first.</Banner>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Processing</label>
          <select className="input" value={processType} onChange={(e) => setProcessType(e.target.value as ProcessType)}>
            <option value="Machine">Machine</option>
            <option value="Manual">Manual</option>
          </select>
        </div>
        {processType === 'Machine' && (
          <div>
            <label className="label">Machine</label>
            <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)}>
              {refData.machines.map((m) => (
                <option key={m.id} value={m.code}>{m.code}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label">Operator</label>
          <select className="input" value={operator} onChange={(e) => setOperator(e.target.value)}>
            {refData.employees.map((e) => (
              <option key={e.id} value={e.code}>{e.code} — {e.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Parent multi-select */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <label className="label mb-0">Parents (earliest expiry first)</label>
          <input
            className="input max-w-[220px]"
            placeholder="Search description / ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="th" />
                <th className="th">Parent ID</th>
                <th className="th">Description</th>
                <th className="th">Qty</th>
                <th className="th">Remaining</th>
                <th className="th">Expiry</th>
                <th className="th">Draw (kg)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td className="td text-slate-400" colSpan={7}>No parents match.</td></tr>
              ) : (
                filtered.map((p) => {
                  const checked = p.id in selected
                  const rem = remainingG(p)
                  return (
                    <tr key={p.id} className={`border-b border-slate-100 ${checked ? 'bg-brand-50/40' : ''}`}>
                      <td className="td">
                        <input type="checkbox" checked={checked} onChange={() => toggle(p)} disabled={rem <= 0 && !checked} />
                      </td>
                      <td className="td font-medium">{p.item_code}</td>
                      <td className="td">{p.description}</td>
                      <td className="td">{p.qty}</td>
                      <td className={`td ${rem <= 0 ? 'text-rose-500' : ''}`}>{formatWeight(rem)}</td>
                      <td className="td">{dateOnly(p.expiry_date)}</td>
                      <td className="td">
                        {checked && (
                          <div>
                            <input
                              className="input max-w-[110px]"
                              type="number"
                              step="0.1"
                              value={selected[p.id]}
                              max={rem / 1000}
                              placeholder={`≤ ${(rem / 1000).toFixed(1)}`}
                              onChange={(e) => setWeight(p.id, e.target.value)}
                            />
                            {fefoWarn(p) && <div className="mt-1 text-[11px] font-medium text-amber-600">⚠ Earlier-expiry batch in stock</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Output product */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Output product {isBlend && <span className="text-amber-600">(blend — pick one)</span>}</label>
          <select className="input" value={effectiveOutput} onChange={(e) => setOutputProduct(e.target.value)}>
            <option value="">Select…</option>
            {outputOptions.map((o) => (
              <option key={o.code} value={o.code}>{o.code}{o.description ? ` — ${o.description}` : ''}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            {isBlend
              ? 'Different products selected — choose the blend this job produces.'
              : 'Defaults to the selected parent’s product; child SKUs come from the Parent-Child Master.'}
          </p>
        </div>
        <div className="self-end text-sm text-slate-500">
          {selectedEntries.length > 0 && (
            <span>{selectedEntries.length} parent(s), drawing {formatWeight(selectedEntries.reduce((s, [, w]) => s + (Number(w) || 0) * 1000, 0))}.</span>
          )}
        </div>
      </div>

      {error && <Banner tone="error"><div className="mt-3">{error}</div></Banner>}

      <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
        <span>Date/time &amp; status (Created) are captured automatically.</span>
        <button className="btn-primary ml-auto" onClick={create} disabled={busy}>
          {busy ? 'Creating…' : 'Create Job'}
        </button>
      </div>
    </Section>
  )
}
