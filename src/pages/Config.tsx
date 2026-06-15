import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { Banner, Empty, PageHeader, Section, Spinner } from '../components/ui'

type ColType = 'text' | 'number' | 'boolean'
interface Col {
  field: string
  label: string
  type: ColType
}

/** Generic CRUD editor for a flat master table. */
function MasterEditor({
  title,
  table,
  cols,
  defaultRow,
  orderBy,
}: {
  title: string
  table: string
  cols: Col[]
  defaultRow: Record<string, unknown>
  orderBy: string
}) {
  const { data, loading, error, refresh } = useData<Record<string, unknown>[]>(async () => {
    const { data, error } = await supabase.from(table).select('*').order(orderBy)
    if (error) throw error
    return data ?? []
  }, [table])
  const [busy, setBusy] = useState(false)

  async function update(id: string, field: string, value: unknown) {
    setBusy(true)
    await supabase.from(table).update({ [field]: value }).eq('id', id)
    setBusy(false)
    void refresh()
  }
  async function add() {
    setBusy(true)
    await supabase.from(table).insert(defaultRow)
    setBusy(false)
    void refresh()
  }
  async function remove(id: string) {
    if (!confirm('Delete this row?')) return
    setBusy(true)
    await supabase.from(table).delete().eq('id', id)
    setBusy(false)
    void refresh()
  }

  return (
    <Section
      title={title}
      actions={
        <button className="btn-secondary" onClick={add} disabled={busy}>
          + Add
        </button>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty>No entries yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                {cols.map((c) => (
                  <th key={c.field} className="th">
                    {c.label}
                  </th>
                ))}
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={String(row.id)} className="border-b border-slate-100">
                  {cols.map((c) => (
                    <td key={c.field} className="td">
                      {c.type === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(row[c.field])}
                          onChange={(e) => update(String(row.id), c.field, e.target.checked)}
                        />
                      ) : (
                        <input
                          className="input max-w-[180px]"
                          type={c.type === 'number' ? 'number' : 'text'}
                          defaultValue={row[c.field] == null ? '' : String(row[c.field])}
                          onBlur={(e) =>
                            update(
                              String(row.id),
                              c.field,
                              c.type === 'number'
                                ? e.target.value === ''
                                  ? null
                                  : Number(e.target.value)
                                : e.target.value,
                            )
                          }
                        />
                      )}
                    </td>
                  ))}
                  <td className="td text-right">
                    <button className="text-rose-600 hover:underline" onClick={() => remove(String(row.id))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function CostingConfigEditor() {
  const { data, loading, refresh } = useData<{ id: string; machine_cost_per_hour: number; labor_cost_per_hour: number } | null>(
    async () => {
      const { data } = await supabase.from('costing_config').select('*').limit(1).maybeSingle()
      return data
    },
    [],
  )

  async function update(field: string, value: number) {
    if (!data) return
    await supabase.from('costing_config').update({ [field]: value }).eq('id', data.id)
    void refresh()
  }

  return (
    <Section title="Costing Config (rates)">
      {loading ? (
        <Spinner />
      ) : !data ? (
        <Empty>No costing_config row. Run schema.sql seed.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Machine cost / hour</label>
            <input
              className="input"
              type="number"
              defaultValue={data.machine_cost_per_hour}
              onBlur={(e) => update('machine_cost_per_hour', Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <label className="label">Labor cost / hour</label>
            <input
              className="input"
              type="number"
              defaultValue={data.labor_cost_per_hour}
              onBlur={(e) => update('labor_cost_per_hour', Number(e.target.value) || 0)}
            />
          </div>
        </div>
      )}
    </Section>
  )
}

export default function Config() {
  return (
    <div>
      <PageHeader title="Configuration" subtitle="Admin masters & rates. Changes save on blur." />

      <MasterEditor
        title="Employee Master"
        table="employees"
        orderBy="code"
        cols={[
          { field: 'code', label: 'Code', type: 'text' },
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ code: 'EMP000', name: 'New Operator', active: true }}
      />

      <MasterEditor
        title="Machine Master"
        table="machines"
        orderBy="code"
        cols={[
          { field: 'code', label: 'Code', type: 'text' },
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'cost_per_hour_override', label: 'Cost/hr override', type: 'number' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ code: 'Machine 5', name: 'Machine 5', active: true }}
      />

      <MasterEditor
        title="Pack Sizes"
        table="pack_sizes"
        orderBy="grams"
        cols={[
          { field: 'grams', label: 'Grams', type: 'number' },
          { field: 'label', label: 'Label', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ grams: 500, label: '500g', active: true }}
      />

      <MasterEditor
        title="Wastage Reasons"
        table="wastage_reasons"
        orderBy="name"
        cols={[
          { field: 'name', label: 'Reason', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ name: 'New Reason', active: true }}
      />

      <MasterEditor
        title="Packaging Cost (per pack size)"
        table="packaging_costs"
        orderBy="pack_size_g"
        cols={[
          { field: 'pack_size_g', label: 'Pack size (g)', type: 'number' },
          { field: 'cost_per_unit', label: 'Cost / unit', type: 'number' },
        ]}
        defaultRow={{ pack_size_g: 500, cost_per_unit: 0 }}
      />

      <CostingConfigEditor />
    </div>
  )
}
