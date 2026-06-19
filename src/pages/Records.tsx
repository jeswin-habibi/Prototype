import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { exportChildRecords, exportRows } from '../lib/excel'
import { money, num } from '../lib/format'
import { formatWeight } from '../lib/units'
import type { ChildSku, JobParent, RepackJob } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner } from '../components/ui'

type Tab = 'children' | 'adjustments'

export default function Records() {
  const [tab, setTab] = useState<Tab>('children')
  return (
    <div>
      <PageHeader title="Records" subtitle="Generated child SKUs and parent stock adjustments from completed jobs." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-soft">
        <TabButton active={tab === 'children'} onClick={() => setTab('children')}>Child SKUs</TabButton>
        <TabButton active={tab === 'adjustments'} onClick={() => setTab('adjustments')}>Parent Adjustments</TabButton>
      </div>
      {tab === 'children' ? <ChildRecords /> : <ParentAdjustments />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${active ? 'bg-gradient-to-br from-brand-light to-brand text-white shadow-soft' : 'text-slate-600 hover:bg-slate-50'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function ChildRecords() {
  const [busy, setBusy] = useState(false)
  const { data, loading, error, refresh } = useData<ChildSku[]>(async () => {
    const { data, error } = await supabase.from('child_skus').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }, [])

  async function setExpiry(row: ChildSku, value: string) {
    setBusy(true)
    await supabase.from('child_skus').update({ expiry_date: value || null }).eq('id', row.id)
    setBusy(false)
    void refresh()
  }

  return (
    <Section
      title="Child SKU Records"
      actions={
        data && data.length > 0 ? (
          <button className="btn-primary" onClick={() => exportChildRecords(data)} disabled={busy}>⬇ Excel (.xlsx)</button>
        ) : null
      }
    >
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : !data || data.length === 0 ? (
        <Empty>No child SKU records yet. Complete a job and generate child SKUs.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                {['Child ID', 'Description', 'Category', 'Barcode', 'Unit', 'Batch ID', 'Size', 'Qty', 'Expiry', 'Unit Cost', 'Total Cost', 'Parent ID', 'Warehouse'].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="td font-medium">{r.child_item_code}</td>
                  <td className="td">{r.description}</td>
                  <td className="td">{r.category}</td>
                  <td className="td">{r.child_barcode}</td>
                  <td className="td">{r.unit}</td>
                  <td className="td">{r.batch_id}</td>
                  <td className="td">{num(Number(r.pack_size_g))}g</td>
                  <td className="td">{num(r.quantity)}</td>
                  <td className="td">
                    <input
                      className="input max-w-[150px]"
                      type="date"
                      defaultValue={r.expiry_date ? String(r.expiry_date).slice(0, 10) : ''}
                      onBlur={(e) => setExpiry(r, e.target.value)}
                    />
                  </td>
                  <td className="td">{money(r.unit_cost, 4)}</td>
                  <td className="td">{money(r.total_value)}</td>
                  <td className="td">{r.output_product_code ?? '—'}</td>
                  <td className="td">{r.warehouse_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

interface AdjRow extends JobParent {
  parent: NonNullable<JobParent['parent']>
  job: Pick<RepackJob, 'output_product_code' | 'created_at' | 'status'> | null
}

function ParentAdjustments() {
  const { data, loading, error } = useData<AdjRow[]>(async () => {
    const { data, error } = await supabase
      .from('job_parents')
      .select('*, parent:parent_items(*), job:repack_jobs(output_product_code, created_at, status)')
      .order('id', { ascending: false })
    if (error) throw error
    return (data ?? []) as AdjRow[]
  }, [])

  // Current balance per parent = total weight − Σ all draws against it.
  const drawnByParent: Record<string, number> = {}
  for (const r of data ?? []) drawnByParent[r.parent_item_id] = (drawnByParent[r.parent_item_id] ?? 0) + Number(r.required_weight_g)

  function exportAdj(rows: AdjRow[]) {
    exportRows(
      rows.map((r) => ({
        'Parent ID': r.parent?.item_code ?? '',
        Description: r.parent?.description ?? '',
        'Output Product': r.job?.output_product_code ?? '',
        'Drawn Weight (g)': Number(r.required_weight_g),
        'Material Cost': Number(r.material_cost),
        'Balance Weight (g)': Number(r.parent?.total_weight_g ?? 0) - (drawnByParent[r.parent_item_id] ?? 0),
      })),
      'parent-adjustments.xlsx',
    )
  }

  return (
    <Section
      title="Parent Adjustments"
      actions={data && data.length > 0 ? <button className="btn-primary" onClick={() => exportAdj(data)}>⬇ Excel (.xlsx)</button> : null}
    >
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : !data || data.length === 0 ? (
        <Empty>No parent draws yet. Create a job that consumes parents.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                {['Parent ID', 'Description', 'Output Product', 'Drawn Weight', 'Material Cost', 'Balance Weight'].map((h) => (
                  <th key={h} className="th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => {
                const balance = Number(r.parent?.total_weight_g ?? 0) - (drawnByParent[r.parent_item_id] ?? 0)
                return (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="td font-medium">{r.parent?.item_code}</td>
                    <td className="td">{r.parent?.description}</td>
                    <td className="td">{r.job?.output_product_code ?? '—'}</td>
                    <td className="td">{formatWeight(Number(r.required_weight_g))}</td>
                    <td className="td">{money(Number(r.material_cost))}</td>
                    <td className={`td font-medium ${balance <= 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{formatWeight(balance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}
