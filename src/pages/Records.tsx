import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { exportChildRecords, exportRows } from '../lib/excel'
import { money, num } from '../lib/format'
import { formatWeight } from '../lib/units'
import type { ChildSku, JobParent, RepackJob } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner, SummaryBar } from '../components/ui'
import { IconBox, IconCoins, IconImport, IconRecords, IconWeight } from '../components/icons'

type Tab = 'children' | 'adjustments'

const tonnes = (g: number) => (g >= 1e6 ? `${(g / 1e6).toFixed(2)} t` : `${num(Math.round(g / 1000))} kg`)

export default function Records() {
  const [tab, setTab] = useState<Tab>('children')
  return (
    <div>
      <PageHeader title="Records" subtitle="Generated child SKUs and parent stock adjustments from completed jobs." />
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-soft dark:border-ink-700 dark:bg-ink-800 sm:inline-grid sm:w-auto sm:grid-cols-2">
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
      className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${active ? 'bg-gradient-to-br from-brand-light to-brand text-white shadow-soft' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-ink-700'}`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{children}</div>
    </div>
  )
}

/** Green icon chip on the left of a record card. */
function Chip() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand/15 dark:text-brand-light">
      <IconBox className="h-5 w-5" />
    </div>
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

  const cd = data ?? []

  return (
    <Section
      title="Child SKU Records"
      actions={cd.length > 0 ? <button className="btn-primary text-xs sm:text-sm" onClick={() => exportChildRecords(cd)} disabled={busy}>⬇ Export to Excel</button> : null}
    >
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : cd.length === 0 ? (
        <Empty>No child SKU records yet. Complete a job and generate child SKUs.</Empty>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {cd.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 border-l-[3px] border-l-brand bg-white p-3 shadow-soft dark:border-ink-700 dark:bg-ink-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Chip />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-white">{r.child_item_code}</div>
                      <div className="truncate text-xs text-slate-500 dark:text-slate-400">{r.description}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{money(r.total_value)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">total cost</div>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                  <Field icon="🏷️" label="Category">{r.category || '—'}</Field>
                  <Field icon="▥" label="Barcode">{r.child_barcode || '—'}</Field>
                  <Field icon="⚖️" label="Size">{num(Number(r.pack_size_g))}g</Field>
                  <Field icon="🧮" label="Qty">{num(r.quantity)} {r.unit}</Field>
                  <Field icon="💲" label="Unit cost">{money(r.unit_cost, 4)}</Field>
                  <Field icon="📦" label="Parent ID">{r.output_product_code ?? '—'}</Field>
                  <Field icon="🔖" label="Batch">{r.batch_id}</Field>
                  <Field icon="🏬" label="Warehouse">{r.warehouse_name}</Field>
                  <div className="col-span-2">
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">Expiry (editable)</span>
                    <input className="input w-full" type="date" defaultValue={r.expiry_date ? String(r.expiry_date).slice(0, 10) : ''} onBlur={(e) => setExpiry(r, e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-ink-700">
                  {['Child ID', 'Description', 'Category', 'Barcode', 'Unit', 'Batch ID', 'Size', 'Qty', 'Expiry', 'Unit Cost', 'Total Cost', 'Parent ID', 'Warehouse'].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cd.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/40">
                    <td className="td font-medium dark:text-white">{r.child_item_code}</td>
                    <td className="td">{r.description}</td>
                    <td className="td">{r.category}</td>
                    <td className="td">{r.child_barcode}</td>
                    <td className="td">{r.unit}</td>
                    <td className="td">{r.batch_id}</td>
                    <td className="td">{num(Number(r.pack_size_g))}g</td>
                    <td className="td">{num(r.quantity)}</td>
                    <td className="td">
                      <input className="input max-w-[150px]" type="date" defaultValue={r.expiry_date ? String(r.expiry_date).slice(0, 10) : ''} onBlur={(e) => setExpiry(r, e.target.value)} />
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

          <SummaryBar
            items={[
              { icon: <IconRecords className="h-4 w-4" />, label: 'Child SKUs', value: num(cd.length) },
              { icon: <IconBox className="h-4 w-4" />, label: 'Total Packs', value: num(cd.reduce((s, r) => s + Number(r.quantity), 0)) },
              { icon: <IconCoins className="h-4 w-4" />, label: 'Total Value', value: money(cd.reduce((s, r) => s + Number(r.total_value), 0)), sub: 'KWD' },
              { icon: <IconWeight className="h-4 w-4" />, label: 'Pack Sizes', value: num(new Set(cd.map((r) => Number(r.pack_size_g))).size) },
            ]}
          />
        </>
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

  const ad = data ?? []
  const drawnByParent: Record<string, number> = {}
  for (const r of ad) drawnByParent[r.parent_item_id] = (drawnByParent[r.parent_item_id] ?? 0) + Number(r.required_weight_g)
  const balanceOf = (r: AdjRow) => Number(r.parent?.total_weight_g ?? 0) - (drawnByParent[r.parent_item_id] ?? 0)

  const uniq = new Map<string, number>()
  for (const r of ad) if (!uniq.has(r.parent_item_id)) uniq.set(r.parent_item_id, balanceOf(r))
  const totalBalance = [...uniq.values()].reduce((a, b) => a + b, 0)
  const totalDrawn = ad.reduce((s, r) => s + Number(r.required_weight_g), 0)
  const totalCost = ad.reduce((s, r) => s + Number(r.material_cost), 0)

  function exportAdj(rows: AdjRow[]) {
    exportRows(
      rows.map((r) => ({
        'Parent ID': r.parent?.item_code ?? '',
        Description: r.parent?.description ?? '',
        'Original Qty (bags)': Number(r.parent?.qty ?? 0),
        'Original Weight (g)': Number(r.parent?.total_weight_g ?? 0),
        'Output Product': r.job?.output_product_code ?? '',
        'Drawn Weight (g)': Number(r.required_weight_g),
        'Material Cost': Number(r.material_cost),
        'Balance Weight (g)': balanceOf(r),
      })),
      'parent-adjustments.xlsx',
    )
  }

  return (
    <Section
      title="Parent Adjustments"
      actions={ad.length > 0 ? <button className="btn-primary text-xs sm:text-sm" onClick={() => exportAdj(ad)}>⬇ Export to Excel</button> : null}
    >
      {loading ? (
        <Spinner />
      ) : error ? (
        <Banner tone="error">{error}</Banner>
      ) : ad.length === 0 ? (
        <Empty>No parent draws yet. Create a job that consumes parents.</Empty>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {ad.map((r) => {
              const balance = balanceOf(r)
              return (
                <div key={r.id} className="rounded-xl border border-slate-200 border-l-[3px] border-l-brand bg-white p-3 shadow-soft dark:border-ink-700 dark:bg-ink-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Chip />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white">{r.parent?.item_code}</div>
                        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{r.parent?.description}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${balance <= 0 ? 'text-rose-500' : 'text-brand-600 dark:text-brand-light'}`}>{formatWeight(balance)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">balance</div>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
                    <Field icon="📦" label="Original qty">{num(Number(r.parent?.qty ?? 0))} bags</Field>
                    <Field icon="⚖️" label="Original weight">{formatWeight(Number(r.parent?.total_weight_g ?? 0))}</Field>
                    <Field icon="🏷️" label="Output product">{r.job?.output_product_code ?? '—'}</Field>
                    <Field icon="⬇️" label="Drawn weight">{formatWeight(Number(r.required_weight_g))}</Field>
                    <Field icon="💰" label="Material cost">{money(Number(r.material_cost))}</Field>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-ink-700">
                  {['Parent ID', 'Description', 'Orig. Qty', 'Orig. Weight', 'Output Product', 'Drawn Weight', 'Material Cost', 'Balance Weight'].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ad.map((r) => {
                  const balance = balanceOf(r)
                  return (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-ink-800 dark:hover:bg-ink-800/40">
                      <td className="td font-medium dark:text-white">{r.parent?.item_code}</td>
                      <td className="td">{r.parent?.description}</td>
                      <td className="td">{num(Number(r.parent?.qty ?? 0))} bags</td>
                      <td className="td">{formatWeight(Number(r.parent?.total_weight_g ?? 0))}</td>
                      <td className="td">{r.job?.output_product_code ?? '—'}</td>
                      <td className="td">{formatWeight(Number(r.required_weight_g))}</td>
                      <td className="td">{money(Number(r.material_cost))}</td>
                      <td className={`td font-medium ${balance <= 0 ? 'text-rose-500' : 'text-brand-600 dark:text-brand-light'}`}>{formatWeight(balance)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <SummaryBar
            items={[
              { icon: <IconRecords className="h-4 w-4" />, label: 'Adjustments', value: num(ad.length) },
              { icon: <IconWeight className="h-4 w-4" />, label: 'Total Balance', value: tonnes(totalBalance) },
              { icon: <IconImport className="h-4 w-4" />, label: 'Total Drawn', value: tonnes(totalDrawn) },
              { icon: <IconCoins className="h-4 w-4" />, label: 'Materials Cost', value: money(totalCost), sub: 'KWD' },
            ]}
          />
        </>
      )}
    </Section>
  )
}
