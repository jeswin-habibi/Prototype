import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { parseParentChildMap } from '../lib/excel'
import { Empty, PageHeader, Section, Spinner } from '../components/ui'
import DataGrid from '../components/DataGrid'

// ── Auto-generate unique values for new master rows (prevents unique-constraint errors on "+ Add") ──
/** Next sequential code from existing rows, e.g. EMP001 → EMP004, "Machine 4" → "Machine 5". */
function nextCode(rows: Record<string, unknown>[], field: string, prefix: string, pad = 0): string {
  let max = 0
  for (const r of rows) {
    const v = String(r[field] ?? '')
    if (v.startsWith(prefix)) {
      const n = parseInt(v.slice(prefix.length), 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const n = max + 1
  return prefix + (pad ? String(n).padStart(pad, '0') : String(n))
}
/** Next unused numeric value (max + step) for unique numeric columns like pack-size grams. */
function nextNumber(rows: Record<string, unknown>[], field: string, step: number): number {
  let max = 0
  for (const r of rows) {
    const n = Number(r[field])
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + step
}
/** Next unused name, e.g. "New Reason", "New Reason 2", … */
function nextName(rows: Record<string, unknown>[], field: string, base: string): string {
  const used = new Set(rows.map((r) => String(r[field] ?? '')))
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base} ${i}`)) i++
  return `${base} ${i}`
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
    <Section title="Costing Config (rates)" collapsible defaultOpen={false}>
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
      <PageHeader title="Configuration" subtitle="Admin masters & rates. Tap a master to open it; changes save on blur." />

      <DataGrid
        title="Parent-Child Master"
        collapsible
        defaultOpen
        subtitle="Maps a product (Parent ID) at a pack size to its child SKU. A blend is just rows entered under the blend's own Parent ID. Import appends/updates by (Parent ID, Size)."
        table="parent_child_map"
        orderBy="parent_code"
        cols={[
          { field: 'parent_code', label: 'Parent ID', type: 'text', width: 'max-w-[140px]' },
          { field: 'parent_description', label: 'Parent Description', type: 'text' },
          { field: 'category', label: 'Category', type: 'text', width: 'max-w-[140px]' },
          { field: 'pack_size_g', label: 'Size (g)', type: 'number', width: 'max-w-[100px]' },
          { field: 'child_code', label: 'Child ID', type: 'text', width: 'max-w-[140px]' },
          { field: 'child_description', label: 'Child Description', type: 'text' },
          { field: 'child_barcode', label: 'Child Barcode', type: 'text', width: 'max-w-[160px]' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{
          parent_code: '',
          parent_description: '',
          category: '',
          pack_size_g: 100,
          child_code: '',
          child_description: '',
          child_barcode: '',
          active: true,
        }}
        onImport={parseParentChildMap}
        importConflict="parent_code,pack_size_g"
        templateHeaders={['Parent ID', 'Parent Description', 'Category', 'Size', 'Child ID', 'Child Description', 'Child Barcode']}
        exportColumns={[
          { header: 'Parent ID', field: 'parent_code' },
          { header: 'Parent Description', field: 'parent_description' },
          { header: 'Category', field: 'category' },
          { header: 'Size', field: 'pack_size_g' },
          { header: 'Child ID', field: 'child_code' },
          { header: 'Child Description', field: 'child_description' },
          { header: 'Child Barcode', field: 'child_barcode' },
        ]}
        fileBaseName="parent-child-master"
      />

      <DataGrid
        title="Employee Master"
        collapsible
        defaultOpen={false}
        table="employees"
        orderBy="code"
        cols={[
          { field: 'code', label: 'Code', type: 'text' },
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ code: 'EMP000', name: 'New Operator', active: true }}
        buildAddRow={(rows) => ({ code: nextCode(rows, 'code', 'EMP', 3), name: 'New Operator', active: true })}
      />

      <DataGrid
        title="Machine Master"
        collapsible
        defaultOpen={false}
        table="machines"
        orderBy="code"
        cols={[
          { field: 'code', label: 'Code', type: 'text' },
          { field: 'name', label: 'Name', type: 'text' },
          { field: 'cost_per_hour_override', label: 'Cost/hr override', type: 'number' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ code: 'Machine 5', name: 'Machine 5', active: true }}
        buildAddRow={(rows) => { const code = nextCode(rows, 'code', 'Machine ', 0); return { code, name: code, active: true } }}
      />

      <DataGrid
        title="Pack Sizes"
        collapsible
        defaultOpen={false}
        table="pack_sizes"
        orderBy="grams"
        cols={[
          { field: 'grams', label: 'Grams', type: 'number' },
          { field: 'label', label: 'Label', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ grams: 500, label: '500g', active: true }}
        buildAddRow={(rows) => { const grams = nextNumber(rows, 'grams', 50); return { grams, label: `${grams}g`, active: true } }}
      />

      <DataGrid
        title="Wastage Reasons"
        collapsible
        defaultOpen={false}
        table="wastage_reasons"
        orderBy="name"
        cols={[
          { field: 'name', label: 'Reason', type: 'text' },
          { field: 'active', label: 'Active', type: 'boolean' },
        ]}
        defaultRow={{ name: 'New Reason', active: true }}
        buildAddRow={(rows) => ({ name: nextName(rows, 'name', 'New Reason'), active: true })}
      />

      <DataGrid
        title="Packaging Cost (per pack size)"
        collapsible
        defaultOpen={false}
        table="packaging_costs"
        orderBy="pack_size_g"
        cols={[
          { field: 'pack_size_g', label: 'Pack size (g)', type: 'number' },
          { field: 'cost_per_unit', label: 'Cost / unit', type: 'number' },
        ]}
        defaultRow={{ pack_size_g: 500, cost_per_unit: 0 }}
        buildAddRow={(rows) => ({ pack_size_g: nextNumber(rows, 'pack_size_g', 50), cost_per_unit: 0 })}
      />

      <CostingConfigEditor />
    </div>
  )
}
