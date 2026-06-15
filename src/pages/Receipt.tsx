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
          <ParentTable rows={items} />
        )}
      </Section>
    </div>
  )
}

function ParentTable({ rows }: { rows: Array<ParsedParent | ParentItem> }) {
  return (
    <div className="overflow-x-auto">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
