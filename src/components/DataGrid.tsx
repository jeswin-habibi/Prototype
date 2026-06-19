import { useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { downloadTemplate, exportRows } from '../lib/excel'
import { Banner, Empty, Section, Spinner } from './ui'

export type GridColType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'computed'

export interface GridCol {
  field: string
  label: string
  type: GridColType
  /** select options (type='select') */
  options?: string[]
  /** read-only display (type='computed') */
  compute?: (row: Record<string, unknown>) => ReactNode
  /** max-width utility class for the cell input */
  width?: string
}

export interface DataGridProps {
  title: string
  table: string
  cols: GridCol[]
  orderBy: string
  ascending?: boolean
  defaultRow: Record<string, unknown>
  /** transform a row before insert/update (e.g. derive mirror/computed columns) */
  deriveRow?: (row: Record<string, unknown>) => Record<string, unknown>
  /** parse an uploaded file into rows ready to persist (already derived) */
  onImport?: (file: File) => Promise<Record<string, unknown>[]>
  /** upsert conflict target for import (e.g. 'parent_code,pack_size_g'); omit → plain insert (append) */
  importConflict?: string
  /** template/export header list (defaults to col labels) */
  templateHeaders?: string[]
  /** export mapping; omit to skip the Export button */
  exportColumns?: { header: string; field: string }[]
  fileBaseName?: string
  subtitle?: ReactNode
}

function coerce(type: GridColType, raw: string): unknown {
  if (type === 'number') return raw === '' ? null : Number(raw)
  if (type === 'date') return raw === '' ? null : raw
  return raw
}

export default function DataGrid({
  title,
  table,
  cols,
  orderBy,
  ascending = true,
  defaultRow,
  deriveRow,
  onImport,
  importConflict,
  templateHeaders,
  exportColumns,
  fileBaseName = table,
  subtitle,
}: DataGridProps) {
  const { data, loading, error, refresh } = useData<Record<string, unknown>[]>(async () => {
    const { data, error } = await supabase.from(table).select('*').order(orderBy, { ascending })
    if (error) throw error
    return data ?? []
  }, [table])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function persist(row: Record<string, unknown>, field: string, value: unknown) {
    setBusy(true)
    const next = { ...row, [field]: value }
    const patch = deriveRow ? deriveRow(next) : { [field]: value }
    delete (patch as Record<string, unknown>).id
    const { error } = await supabase.from(table).update(patch).eq('id', String(row.id))
    setBusy(false)
    if (error) setMsg(error.message)
    else void refresh()
  }

  async function add() {
    setBusy(true)
    const payload = deriveRow ? deriveRow({ ...defaultRow }) : defaultRow
    const { error } = await supabase.from(table).insert(payload)
    setBusy(false)
    if (error) setMsg(error.message)
    else void refresh()
  }

  async function remove(id: string) {
    if (!confirm('Delete this row?')) return
    setBusy(true)
    const { error } = await supabase.from(table).delete().eq('id', id)
    setBusy(false)
    if (error) setMsg(error.message)
    else void refresh()
  }

  async function onFile(file: File) {
    if (!onImport) return
    setMsg(null)
    setBusy(true)
    try {
      const rows = await onImport(file)
      if (rows.length === 0) {
        setMsg('No rows found. Check the column headers (use the template).')
      } else {
        const q = importConflict
          ? supabase.from(table).upsert(rows, { onConflict: importConflict })
          : supabase.from(table).insert(rows)
        const { error } = await q
        if (error) setMsg(error.message)
        else setMsg(`Imported ${rows.length} row(s).`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      void refresh()
    }
  }

  const headers = templateHeaders ?? cols.filter((c) => c.type !== 'computed').map((c) => c.label)

  return (
    <Section
      title={title}
      actions={
        <div className="flex flex-wrap gap-2">
          {onImport && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => e.target.files && onFile(e.target.files[0])}
              />
              <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                ⬆ Import
              </button>
              <button className="btn-secondary" onClick={() => downloadTemplate(headers, `${fileBaseName}-template.xlsx`)}>
                ⬇ Template
              </button>
            </>
          )}
          {exportColumns && data && data.length > 0 && (
            <button
              className="btn-secondary"
              onClick={() =>
                exportRows(
                  data.map((r) => Object.fromEntries(exportColumns.map((c) => [c.header, r[c.field] ?? '']))),
                  `${fileBaseName}.xlsx`,
                )
              }
            >
              ⬇ Export
            </button>
          )}
          <button className="btn-secondary" onClick={add} disabled={busy}>
            + Add
          </button>
        </div>
      }
    >
      {subtitle && <p className="mb-3 text-sm text-slate-500">{subtitle}</p>}
      {error && <Banner tone="error">{error}</Banner>}
      {msg && <Banner tone="info">{msg}</Banner>}
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
                      <Cell col={c} row={row} onSave={(v) => persist(row, c.field, v)} />
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

function Cell({
  col,
  row,
  onSave,
}: {
  col: GridCol
  row: Record<string, unknown>
  onSave: (value: unknown) => void
}) {
  const raw = row[col.field]
  if (col.type === 'computed') return <span className="text-slate-600">{col.compute ? col.compute(row) : ''}</span>
  if (col.type === 'boolean')
    return <input type="checkbox" checked={Boolean(raw)} onChange={(e) => onSave(e.target.checked)} />
  if (col.type === 'select')
    return (
      <select
        className={`input ${col.width ?? 'max-w-[150px]'}`}
        defaultValue={raw == null ? '' : String(raw)}
        onChange={(e) => onSave(e.target.value)}
      >
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  return (
    <input
      className={`input ${col.width ?? 'max-w-[180px]'}`}
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      defaultValue={
        raw == null ? '' : col.type === 'date' ? String(raw).slice(0, 10) : String(raw)
      }
      onBlur={(e) => onSave(coerce(col.type, e.target.value))}
    />
  )
}
