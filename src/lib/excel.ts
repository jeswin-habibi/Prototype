import * as XLSX from 'xlsx'
import type { ChildSku, Unit } from '../types'

// ───────────────────────── shared helpers ─────────────────────────
function readRows(buf: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

function normUnit(v: unknown): Unit {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'kg' || s === 'kgs' || s === 'kilogram' || s === 'kilograms') return 'kg'
  return 'g'
}

export function toIsoDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const ssf = (XLSX as unknown as { SSF?: { parse_date_code: (n: number) => { y: number; m: number; d: number } | null } }).SSF
    const d = ssf ? ssf.parse_date_code(v) : null
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const parsed = new Date(String(v))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/** Generic alias-based row parser: maps flexible headers → canonical fields, coercing per field. */
function parseRows<T extends Record<string, unknown>>(
  rows: Record<string, unknown>[],
  aliases: Record<string, keyof T>,
  coerce: (field: keyof T, value: unknown) => unknown,
  keep: (out: Partial<T>) => boolean,
  fill: (out: Partial<T>) => T,
): T[] {
  return rows
    .map((row): T | null => {
      const out: Partial<T> = {}
      for (const [header, value] of Object.entries(row)) {
        const field = aliases[String(header).trim().toLowerCase()]
        if (!field) continue
        out[field] = coerce(field, value) as T[keyof T]
      }
      if (!keep(out)) return null
      return fill(out)
    })
    .filter((r): r is T => r !== null)
}

// ───────────────────────── Parent receipt import ─────────────────────────
export type ParsedParent = {
  item_code: string
  description: string
  category: string
  batch_id: string
  qty: number
  weight_per_unit: number
  weight_unit: Unit
  expiry_date: string | null
  total_cost: number
  warehouse_name: string
}

const PARENT_ALIASES: Record<string, keyof ParsedParent> = {
  'item code': 'item_code', itemcode: 'item_code', 'parent id': 'item_code', 'parent code': 'item_code',
  parentid: 'item_code', 'parent item code': 'item_code', code: 'item_code',
  description: 'description', desc: 'description', 'parent description': 'description',
  category: 'category', cat: 'category',
  'batch id': 'batch_id', batchid: 'batch_id', batch: 'batch_id', 'batch number': 'batch_id', 'batch no': 'batch_id', lot: 'batch_id',
  qty: 'qty', quantity: 'qty', units: 'qty', 'unit count': 'qty', count: 'qty', 'no of units': 'qty',
  'weight per unit': 'weight_per_unit', 'unit weight': 'weight_per_unit', weight: 'weight_per_unit', wt: 'weight_per_unit',
  'weight unit': 'weight_unit', uom: 'weight_unit',
  'expiry date': 'expiry_date', expiry: 'expiry_date', expiry_date: 'expiry_date', 'best before': 'expiry_date',
  'total cost': 'total_cost', 'parent cost': 'total_cost', cost: 'total_cost', value: 'total_cost', 'total value': 'total_cost',
  'warehouse name': 'warehouse_name', warehouse: 'warehouse_name', location: 'warehouse_name', wh: 'warehouse_name',
}

export async function parseParentWorkbook(file: File): Promise<ParsedParent[]> {
  const rows = readRows(await file.arrayBuffer())
  return parseRows<ParsedParent>(
    rows,
    PARENT_ALIASES,
    (field, value) => {
      if (field === 'weight_unit') return normUnit(value)
      if (field === 'expiry_date') return toIsoDate(value)
      if (field === 'qty' || field === 'weight_per_unit' || field === 'total_cost') return Number(value) || 0
      return String(value ?? '').trim()
    },
    (o) => Boolean(o.item_code || o.batch_id),
    (o) => ({
      item_code: o.item_code ?? '',
      description: o.description ?? '',
      category: o.category ?? '',
      batch_id: o.batch_id ?? '',
      qty: o.qty ?? 0,
      weight_per_unit: o.weight_per_unit ?? 0,
      weight_unit: o.weight_unit ?? 'kg',
      expiry_date: o.expiry_date ?? null,
      total_cost: o.total_cost ?? 0,
      warehouse_name: o.warehouse_name ?? '',
    }),
  )
}

// ───────────────────────── Parent-Child Master import ─────────────────────────
export type ParsedMap = {
  parent_code: string
  parent_description: string
  category: string
  pack_size_g: number
  child_code: string
  child_description: string
  child_barcode: string
}

const MAP_ALIASES: Record<string, keyof ParsedMap> = {
  'parent id': 'parent_code', 'parent code': 'parent_code', parentid: 'parent_code', parent: 'parent_code', 'parent item code': 'parent_code',
  'parent description': 'parent_description', 'parent desc': 'parent_description', description: 'parent_description',
  category: 'category', cat: 'category',
  size: 'pack_size_g', 'pack size': 'pack_size_g', 'pack size (g)': 'pack_size_g', grams: 'pack_size_g', 'size (g)': 'pack_size_g', pack_size_g: 'pack_size_g',
  'child id': 'child_code', 'child code': 'child_code', childid: 'child_code', 'child item code': 'child_code',
  'child description': 'child_description', 'child desc': 'child_description',
  'child barcode': 'child_barcode', barcode: 'child_barcode', ean: 'child_barcode',
}

export async function parseParentChildMap(file: File): Promise<ParsedMap[]> {
  const rows = readRows(await file.arrayBuffer())
  return parseRows<ParsedMap>(
    rows,
    MAP_ALIASES,
    (field, value) => (field === 'pack_size_g' ? Number(value) || 0 : String(value ?? '').trim()),
    (o) => Boolean(o.parent_code || o.child_code),
    (o) => ({
      parent_code: o.parent_code ?? '',
      parent_description: o.parent_description ?? '',
      category: o.category ?? '',
      pack_size_g: o.pack_size_g ?? 0,
      child_code: o.child_code ?? '',
      child_description: o.child_description ?? '',
      child_barcode: o.child_barcode ?? '',
    }),
  )
}

// ───────────────────────── Generic export / template ─────────────────────────
/** Write an array of plain {Header: value} objects to an .xlsx download. */
export function exportRows(rows: Record<string, unknown>[], fileName: string, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

/** Download an empty workbook containing only a header row (an import template). */
export function downloadTemplate(headers: string[], fileName: string, sheetName = 'Template') {
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, fileName)
}

/** Export child SKU records to an .xlsx file (ERP-import friendly columns). */
export function exportChildRecords(records: ChildSku[], fileName = 'child-sku-records.xlsx') {
  const data = records.map((r) => ({
    'Child Item Code': r.child_item_code,
    Description: r.description,
    Category: r.category,
    Barcode: r.child_barcode,
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
