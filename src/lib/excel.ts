import * as XLSX from 'xlsx'
import type { ChildSku, ParentItem, Unit } from '../types'

export type ParsedParent = Omit<ParentItem, 'id' | 'received_at'>

// Map many possible header spellings to our canonical fields.
const HEADER_ALIASES: Record<string, keyof ParsedParent> = {
  'item code': 'item_code',
  'itemcode': 'item_code',
  'parent item code': 'item_code',
  'code': 'item_code',
  'description': 'description',
  'desc': 'description',
  'unit': 'unit',
  'uom': 'unit',
  'batch id': 'batch_id',
  'batchid': 'batch_id',
  'batch': 'batch_id',
  'lot': 'batch_id',
  'quantity': 'quantity',
  'qty': 'quantity',
  'expiry date': 'expiry_date',
  'expiry': 'expiry_date',
  'expiry_date': 'expiry_date',
  'unit cost': 'unit_cost',
  'unitcost': 'unit_cost',
  'rate': 'unit_cost',
  'total value': 'total_value',
  'totalvalue': 'total_value',
  'value': 'total_value',
  'warehouse name': 'warehouse_name',
  'warehouse': 'warehouse_name',
  'location': 'warehouse_name',
}

function normHeader(h: string): keyof ParsedParent | null {
  const key = String(h).trim().toLowerCase()
  return HEADER_ALIASES[key] ?? null
}

function normUnit(v: unknown): Unit {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'kg' || s === 'kgs' || s === 'kilogram' || s === 'kilograms') return 'kg'
  return 'g'
}

function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  // Excel serial number
  if (typeof v === 'number') {
    const ssf = (XLSX as unknown as { SSF?: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null } }).SSF
    const d = ssf ? ssf.parse_date_code(v) : null
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const parsed = new Date(String(v))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export async function parseParentWorkbook(file: File): Promise<ParsedParent[]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  return rows
    .map((row): ParsedParent | null => {
      const out: Partial<ParsedParent> = {}
      for (const [header, value] of Object.entries(row)) {
        const field = normHeader(header)
        if (!field) continue
        if (field === 'unit') out.unit = normUnit(value)
        else if (field === 'expiry_date') out.expiry_date = toIsoDate(value)
        else if (field === 'quantity' || field === 'unit_cost' || field === 'total_value')
          out[field] = Number(value) || 0
        else out[field] = String(value ?? '').trim() as never
      }
      if (!out.item_code && !out.batch_id) return null // skip blank rows
      const quantity = out.quantity ?? 0
      const unitCost = out.unit_cost ?? 0
      return {
        item_code: out.item_code ?? '',
        description: out.description ?? '',
        unit: out.unit ?? 'g',
        batch_id: out.batch_id ?? '',
        quantity,
        expiry_date: out.expiry_date ?? null,
        unit_cost: unitCost,
        // derive total value if the sheet didn't provide one
        total_value: out.total_value ? out.total_value : quantity * unitCost,
        warehouse_name: out.warehouse_name ?? '',
      }
    })
    .filter((r): r is ParsedParent => r !== null)
}

/** Export child SKU records to an .xlsx file (ERP-import friendly columns). */
export function exportChildRecords(records: ChildSku[], fileName = 'child-sku-records.xlsx') {
  const data = records.map((r) => ({
    'Child Item Code': r.child_item_code,
    Description: r.description,
    Unit: r.unit,
    'Batch ID': r.batch_id,
    Quantity: r.quantity,
    'Expiry Date': r.expiry_date ?? '',
    'Unit Cost': Number(r.unit_cost.toFixed(4)),
    'Total Value': Number(r.total_value.toFixed(2)),
    'Warehouse Name': r.warehouse_name,
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Child SKUs')
  XLSX.writeFile(wb, fileName)
}
