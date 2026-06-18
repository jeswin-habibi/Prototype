import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { parseParentWorkbook, type ParsedParent } from '../lib/excel'
import { toGrams } from '../lib/units'
import { dateOnly, money } from '../lib/format'
import type { ParentItem } from '../types'
import { Banner, Empty, PageHeader, Section, Spinner } from '../components/ui'

export default function Receipt() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ParsedParent[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const { data: items, loading, refresh } = useData<ParentItem[]>(async () => {
    const { data, error } = await supabase
      .from('parent_items')
      .select('*')
      .order('received_at', { ascending: false })
    if (error) throw error
    return data ?? []
  }, [])

  async function onFile(file: File) {
    setParseError(null)
    setMsg(null)
    try {
      const rows = await parseParentWorkbook(file)
      if (rows.length === 0) setParseError('No rows found. Check the column headers.')
      setPreview(rows)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e))
    }
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('parent_items').insert(preview)
    setSaving(false)
    if (error) {
      setParseError(error.message)
    } else {
      setMsg(`Saved ${preview.length} parent item(s).`)
      setPreview([])
      if (fileRef.current) fileRef.current.value = ''
      void refresh()
    }
  }

  async function deleteItem(item: ParentItem) {
    if (
      !confirm(
        `Delete parent item "${item.item_code}" (batch ${item.batch_id})?\n\n` +
          'This also deletes any repacking jobs and child SKU records created from this batch.',
      )
    )
      return
    setMsg(null)
    const { error } = await supabase.from('parent_items').delete().eq('id', item.id)
    if (error) setParseError(error.message)
    else {
      setMsg(`Deleted ${item.item_code} (batch ${item.batch_id}).`)
      void refresh()
    }
  }

  return (
    <div>
      <PageHeader
        title="Parent Item Receipt"
        subtitle="Upload the GRN Excel to receive parent batches into stock."
      />

      <Section title="Upload Excel">
        <p className="mb-3 text-sm text-slate-500">
          Expected columns: item code, description, unit, batchID, quantity, expiry date, unit cost,
          total value, warehouse name. Header names are matched flexibly.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="block text-sm"
          onChange={(e) => e.target.files && onFile(e.target.files[0])}
        />
        {parseError && (
          <Banner tone="error">
            <div className="mt-3">{parseError}</div>
          </Banner>
        )}
        {msg && <Banner tone="info">{msg}</Banner>}

        {preview.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">{preview.length} row(s) to import</span>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : `Save ${preview.length} item(s)`}
              </button>
            </div>
            <ParentTable rows={preview} />
          </div>
        )}
      </Section>

      <Section title="Received Parent Items">
        {loading ? (
          <Spinner />
        ) : !items || items.length === 0 ? (
          <Empty>No parent items received yet.</Empty>
        ) : (
          <ParentTable rows={items} onDelete={deleteItem} />
        )}
      </Section>
    </div>
  )
}

function ParentTable({
  rows,
  onDelete,
}: {
  rows: Array<ParsedParent | ParentItem>
  onDelete?: (item: ParentItem) => void
}) {
  return (
    <>
      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">{r.item_code}</div>
                <div className="text-xs text-slate-500">{r.description}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-slate-900">{money(r.total_value)}</div>
                <div className="text-[11px] text-slate-400">total value</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><span className="text-slate-400">Batch:</span> {r.batch_id}</span>
              <span><span className="text-slate-400">Qty:</span> {r.quantity} {r.unit}</span>
              <span><span className="text-slate-400">Weight:</span> {toGrams(r.quantity, r.unit).toLocaleString()} g</span>
              <span><span className="text-slate-400">Unit cost:</span> {money(r.unit_cost, 4)}</span>
              <span><span className="text-slate-400">Expiry:</span> {dateOnly(r.expiry_date)}</span>
              <span><span className="text-slate-400">WH:</span> {r.warehouse_name}</span>
            </div>
            {onDelete && 'id' in r && (
              <div className="mt-2 flex justify-end border-t border-slate-100 pt-2">
                <button className="text-sm text-rose-600" onClick={() => onDelete(r)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              {['Item Code', 'Description', 'Unit', 'Batch', 'Qty', 'Weight (g)', 'Expiry', 'Unit Cost', 'Total Value', 'Warehouse'].map(
                (h) => (
                  <th key={h} className="th">
                    {h}
                  </th>
                ),
              )}
              {onDelete && <th className="th" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-100">
                <td className="td font-medium">{r.item_code}</td>
                <td className="td">{r.description}</td>
                <td className="td">{r.unit}</td>
                <td className="td">{r.batch_id}</td>
                <td className="td">{r.quantity}</td>
                <td className="td">{toGrams(r.quantity, r.unit).toLocaleString()}</td>
                <td className="td">{dateOnly(r.expiry_date)}</td>
                <td className="td">{money(r.unit_cost, 4)}</td>
                <td className="td">{money(r.total_value)}</td>
                <td className="td">{r.warehouse_name}</td>
                {onDelete && (
                  <td className="td text-right">
                    {'id' in r && (
                      <button className="text-rose-600 hover:underline" onClick={() => onDelete(r)}>
                        Delete
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
