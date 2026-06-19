import { parseParentWorkbook } from '../lib/excel'
import { parentRow, parentTotalWeightG, type ParentCore } from '../lib/parent'
import { formatWeight } from '../lib/units'
import { PageHeader } from '../components/ui'
import DataGrid from '../components/DataGrid'

export default function Receipt() {
  return (
    <div>
      <PageHeader
        title="Parent Item Receipt"
        subtitle="Receive parent batches into stock. Import an Excel/CSV, edit inline, or add rows manually."
      />

      <DataGrid
        title="Received Parent Items"
        subtitle="Qty = number of units/bags; Weight Per Unit × Qty = total available weight that jobs draw from."
        table="parent_items"
        orderBy="received_at"
        ascending={false}
        cols={[
          { field: 'item_code', label: 'Parent ID', type: 'text', width: 'max-w-[130px]' },
          { field: 'description', label: 'Description', type: 'text' },
          { field: 'category', label: 'Category', type: 'text', width: 'max-w-[130px]' },
          { field: 'batch_id', label: 'Batch No', type: 'text', width: 'max-w-[130px]' },
          { field: 'qty', label: 'Qty', type: 'number', width: 'max-w-[90px]' },
          { field: 'weight_per_unit', label: 'Wt/Unit', type: 'number', width: 'max-w-[100px]' },
          { field: 'weight_unit', label: 'Unit', type: 'select', options: ['kg', 'g'], width: 'max-w-[80px]' },
          {
            field: 'total_weight_g',
            label: 'Total Weight',
            type: 'computed',
            compute: (r) => formatWeight(parentTotalWeightG(r as unknown as ParentCore)),
          },
          { field: 'expiry_date', label: 'Expiry', type: 'date', width: 'max-w-[150px]' },
          { field: 'total_cost', label: 'Parent Cost', type: 'number', width: 'max-w-[120px]' },
          { field: 'warehouse_name', label: 'Warehouse', type: 'text', width: 'max-w-[130px]' },
        ]}
        defaultRow={{
          item_code: '',
          description: '',
          category: '',
          batch_id: '',
          qty: 0,
          weight_per_unit: 0,
          weight_unit: 'kg',
          expiry_date: null,
          total_cost: 0,
          warehouse_name: '',
        }}
        deriveRow={(r) => parentRow(r as unknown as ParentCore)}
        onImport={async (file) => (await parseParentWorkbook(file)).map((p) => parentRow(p))}
        templateHeaders={['Parent ID', 'Description', 'Category', 'Batch No', 'Qty', 'Weight Per Unit', 'Weight Unit', 'Expiry Date', 'Parent Cost', 'Warehouse']}
        exportColumns={[
          { header: 'Parent ID', field: 'item_code' },
          { header: 'Description', field: 'description' },
          { header: 'Category', field: 'category' },
          { header: 'Batch No', field: 'batch_id' },
          { header: 'Qty', field: 'qty' },
          { header: 'Weight Per Unit', field: 'weight_per_unit' },
          { header: 'Weight Unit', field: 'weight_unit' },
          { header: 'Total Weight (g)', field: 'total_weight_g' },
          { header: 'Expiry Date', field: 'expiry_date' },
          { header: 'Parent Cost', field: 'total_cost' },
          { header: 'Warehouse', field: 'warehouse_name' },
        ]}
        fileBaseName="parent-items"
      />
    </div>
  )
}
