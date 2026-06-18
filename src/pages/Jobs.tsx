import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { dateTime } from '../lib/format'
import type { Employee, Machine, ParentItem, RepackJob } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, StatusBadge } from '../components/ui'

interface JobRow extends RepackJob {
  parent: ParentItem
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
    if (
      !confirm(
        `Delete this repacking job for ${job.parent?.item_code} (batch ${job.parent?.batch_id})?\n\n` +
          'This also deletes its planned mix, wastage, and any generated child SKU records.',
      )
    )
      return
    await supabase.from('repack_jobs').delete().eq('id', job.id)
    void jobs.refresh()
  }

  const refData = useData<{ parents: ParentItem[]; machines: Machine[]; employees: Employee[] }>(async () => {
    const [p, m, e] = await Promise.all([
      supabase.from('parent_items').select('*').order('received_at', { ascending: false }),
      supabase.from('machines').select('*').eq('active', true).order('code'),
      supabase.from('employees').select('*').eq('active', true).order('code'),
    ])
    return { parents: p.data ?? [], machines: m.data ?? [], employees: e.data ?? [] }
  }, [])

  return (
    <div>
      <PageHeader
        title="Repacking Jobs"
        subtitle="Create a job against a parent batch, then run it on the job screen."
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
                <Link
                  key={j.id}
                  to={`/jobs/${j.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-3 active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{j.parent?.item_code}</div>
                      <div className="text-xs text-slate-500">Batch {j.parent?.batch_id}</div>
                    </div>
                    <StatusBadge status={j.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>🛠 {j.machine_code}</span>
                    <span>👷 {j.operator_code}</span>
                    <span>🕒 {dateTime(j.created_at)}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                    <span className="text-sm font-medium text-brand">Open →</span>
                    <button
                      className="text-sm text-rose-600"
                      onClick={(e) => {
                        e.preventDefault()
                        deleteJob(j)
                      }}
                    >
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
                    {['Parent', 'Batch', 'Machine', 'Operator', 'Status', 'Created', ''].map((h) => (
                      <th key={h} className="th">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.data.map((j) => (
                    <tr key={j.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="td font-medium">{j.parent?.item_code}</td>
                      <td className="td">{j.parent?.batch_id}</td>
                      <td className="td">{j.machine_code}</td>
                      <td className="td">{j.operator_code}</td>
                      <td className="td">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="td">{dateTime(j.created_at)}</td>
                      <td className="td text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link to={`/jobs/${j.id}`} className="font-medium text-brand hover:underline">
                            Open →
                          </Link>
                          <button className="text-rose-600 hover:underline" onClick={() => deleteJob(j)}>
                            Delete
                          </button>
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

function CreateJob({
  refData,
  onCreated,
}: {
  refData: { parents: ParentItem[]; machines: Machine[]; employees: Employee[] } | null
  onCreated: (id: string) => void
}) {
  const [parentId, setParentId] = useState('')
  const [machine, setMachine] = useState('')
  const [operator, setOperator] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parent = refData?.parents.find((p) => p.id === parentId)

  async function create() {
    if (!parentId || !machine || !operator) {
      setError('Select parent batch, machine and operator.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('repack_jobs')
      .insert({ parent_item_id: parentId, machine_code: machine, operator_code: operator, status: 'Created' })
      .select('id')
      .single()
    setBusy(false)
    if (error) setError(error.message)
    else onCreated(data.id)
  }

  if (!refData) return <Section title="Create Job"><Spinner /></Section>

  return (
    <Section title="Create Job">
      {refData.parents.length === 0 && (
        <Banner tone="warn">No parent items yet — receive one on the Parent Receipt screen first.</Banner>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Parent Batch</label>
          <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Select…</option>
            {refData.parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.item_code} — {p.batch_id} ({p.quantity}{p.unit})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Machine</label>
          <select className="input" value={machine} onChange={(e) => setMachine(e.target.value)}>
            <option value="">Select…</option>
            {refData.machines.map((m) => (
              <option key={m.id} value={m.code}>
                {m.code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Operator</label>
          <select className="input" value={operator} onChange={(e) => setOperator(e.target.value)}>
            <option value="">Select…</option>
            {refData.employees.map((e) => (
              <option key={e.id} value={e.code}>
                {e.code} — {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {parent && (
        <div className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
          <div><span className="text-slate-500">Item code:</span> <b>{parent.item_code}</b></div>
          <div><span className="text-slate-500">Description:</span> <b>{parent.description}</b></div>
          <div><span className="text-slate-500">Unit:</span> <b>{parent.unit}</b></div>
        </div>
      )}

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
