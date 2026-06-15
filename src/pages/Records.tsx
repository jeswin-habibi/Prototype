import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { exportChildRecords } from '../lib/excel'
import { dateOnly, money, num } from '../lib/format'
import type { ChildSku } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner } from '../components/ui'

export default function Records() {
  const { data, loading, error } = useData<ChildSku[]>(async () => {
    const { data, error } = await supabase
      .from('child_skus')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }, [])

  function exportCsv(rows: ChildSku[]) {
    const headers = ['Child Item Code', 'Description', 'Unit', 'Batch ID', 'Quantity', 'Expiry Date', 'Unit Cost', 'Total Value', 'Warehouse Name']
    const lines = rows.map((r) =>
      [r.child_item_code, r.description, r.unit, r.batch_id, r.quantity, r.expiry_date ?? '', r.unit_cost, r.total_value, r.warehouse_name]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'child-sku-records.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader
        title="Child SKU Records"
        subtitle="Finished packs generated from completed jobs — export for ERP import."
        actions={
          data && data.length > 0 ? (
            <>
              <button className="btn-secondary" onClick={() => exportCsv(data)}>⬇ CSV</button>
              <button className="btn-primary" onClick={() => exportChildRecords(data)}>⬇ Excel (.xlsx)</button>
            </>
          ) : null
        }
      />

      <Section title="Records">
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
                  {['Child Item Code', 'Description', 'Unit', 'Batch ID', 'Qty', 'Expiry', 'Unit Cost', 'Total Value', 'Warehouse'].map((h) => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="td font-medium">{r.child_item_code}</td>
                    <td className="td">{r.description}</td>
                    <td className="td">{r.unit}</td>
                    <td className="td">{r.batch_id}</td>
                    <td className="td">{num(r.quantity)}</td>
                    <td className="td">{dateOnly(r.expiry_date)}</td>
                    <td className="td">{money(r.unit_cost, 4)}</td>
                    <td className="td">{money(r.total_value)}</td>
                    <td className="td">{r.warehouse_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
