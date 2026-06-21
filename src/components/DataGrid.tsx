import { useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { useData } from '../lib/useData'
import { downloadTemplate, exportRows } from '../lib/excel'
import { Banner, Empty, Section, Spinner } from './ui'
import { IconDownload, IconUpload } from './icons'

export type GridColType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'computed'

export interface GridCol {
  field: string
  label: string
  type: GridColType
  /** select options (type='select') */
  options?: string[]
  /** read-only display (type='computed') */
  compute?: (row: Record<string, unknown>) => ReactNode
  /** max-width utility class for the cell input (desktop) */
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
  collapsible?: boolean
  defaultOpen?: boolean
  icon?: ReactNode
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
  collapsible,
  defaultOpen,
  icon,
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
  const canExport = Boolean(exportColumns && data && data.length > 0)
  const exportFile = () =>
    exportRows(
      (data ?? []).map((r) => Object.fromEntries(exportColumns!.map((c) => [c.header, r[c.field] ?? '']))),
      `${fileBaseName}.xlsx`,
    )

  const rich = Boolean(icon)
  const [titleFirst, ...titleRest] = title.split(' ')

  const fileInput = onImport && (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      className="hidden"
      onChange={(e) => e.target.files && onFile(e.target.files[0])}
    />
  )

  // Default action row — used by the Config master grids (passed to <Section> on the right).
  const plainActions = (
    <div className="flex flex-wrap gap-2">
      {onImport && (
        <>
          {fileInput}
          <button className="btn-secondary text-xs sm:text-sm" onClick={() => fileRef.current?.click()} disabled={busy}>⬆ Import</button>
          <button className="btn-secondary text-xs sm:text-sm" onClick={() => downloadTemplate(headers, `${fileBaseName}-template.xlsx`)}>⬇ Template</button>
        </>
      )}
      {canExport && (
        <button className="btn-secondary text-xs sm:text-sm" onClick={exportFile}>⬇ Export</button>
      )}
      <button className="btn-primary text-xs sm:text-sm" onClick={add} disabled={busy}>+ Add</button>
    </div>
  )

  // Rich toolbar (opt-in via `icon`): icon badge + two-tone heading, with a button grid that
  // stacks below the heading on phones (2×2, full width) and sits beside it on sm+ screens —
  // so the buttons always fit the viewport instead of overflowing off-screen.
  const richToolbar = (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center gap-2.5 sm:shrink-0">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand-light ring-1 ring-brand/25">{icon}</span>
        <div className="text-[15px] font-extrabold uppercase leading-tight tracking-wide">
          <div className="text-brand-light">{titleFirst}</div>
          {titleRest.length > 0 && <div className="text-slate-900 dark:text-white">{titleRest.join(' ')}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 border-slate-200 dark:border-ink-700 sm:ml-auto sm:border-l sm:pl-4">
        {fileInput}
        {onImport && (
          <>
            <ToolbarButton icon={<IconUpload className="h-4 w-4" />} label="Import" onClick={() => fileRef.current?.click()} disabled={busy} />
            <ToolbarButton icon={<IconDownload className="h-4 w-4" />} label="Template" onClick={() => downloadTemplate(headers, `${fileBaseName}-template.xlsx`)} />
          </>
        )}
        {canExport && <ToolbarButton icon={<IconDownload className="h-4 w-4" />} label="Export" onClick={exportFile} />}
        <button className="btn-primary w-full justify-center text-sm" onClick={add} disabled={busy}>+ Add</button>
      </div>
    </div>
  )

  const body = (
    <>
      {subtitle && <p className="mb-3 text-sm text-slate-500">{subtitle}</p>}
      {error && <Banner tone="error">{error}</Banner>}
      {msg && <Banner tone="info">{msg}</Banner>}
      {loading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <Empty>No entries yet.</Empty>
      ) : (
        <>
          {/* Mobile: each row is a card with labelled fields */}
          <div className="space-y-3 md:hidden">
            {data.map((row) => (
              <div key={String(row.id)} className="rounded-xl border border-slate-200 bg-white p-3 shadow-soft dark:border-ink-700 dark:bg-ink-900">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  {cols.map((c) => (
                    <div key={c.field} className={c.type === 'boolean' ? 'col-span-2 flex items-center justify-between' : ''}>
                      <label className="label mb-0.5">{c.label}</label>
                      <Cell col={c} row={row} mobile onSave={(v) => persist(row, c.field, v)} />
                    </div>
                  ))}
                </div>
                <div className="mt-2.5 flex justify-end border-t border-slate-100 pt-2">
                  <button className="text-sm font-medium text-rose-600" onClick={() => remove(String(row.id))}>Delete</button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-ink-700">
                  {cols.map((c) => (
                    <th key={c.field} className="th">{c.label}</th>
                  ))}
                  <th className="th" />
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={String(row.id)} className="border-b border-slate-100 dark:border-ink-800">
                    {cols.map((c) => (
                      <td key={c.field} className="td">
                        <Cell col={c} row={row} onSave={(v) => persist(row, c.field, v)} />
                      </td>
                    ))}
                    <td className="td text-right">
                      <button className="text-rose-600 hover:underline" onClick={() => remove(String(row.id))}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )

  if (rich) {
    return (
      <section className="card mb-4">
        {richToolbar}
        {body}
      </section>
    )
  }

  return (
    <Section title={title} collapsible={collapsible} defaultOpen={defaultOpen} actions={plainActions}>
      {body}
    </Section>
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-soft transition hover:bg-slate-50 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-ink-700 dark:bg-ink-900 dark:text-slate-200 dark:hover:bg-ink-800"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-light">{icon}</span>
      {label}
    </button>
  )
}

function Cell({
  col,
  row,
  onSave,
  mobile,
}: {
  col: GridCol
  row: Record<string, unknown>
  onSave: (value: unknown) => void
  mobile?: boolean
}) {
  const raw = row[col.field]
  const cls = mobile ? 'input w-full' : `input ${col.width ?? 'max-w-[180px]'}`
  if (col.type === 'computed') {
    const content = col.compute ? col.compute(row) : ''
    return mobile ? (
      <span className="flex min-h-[38px] items-center rounded-lg bg-slate-100/70 px-3 text-sm font-medium text-slate-700 dark:bg-ink-900/50 dark:text-slate-200">{content}</span>
    ) : (
      <span className="text-sm text-slate-700 dark:text-slate-200">{content}</span>
    )
  }
  if (col.type === 'boolean')
    return <input type="checkbox" className="h-4 w-4" checked={Boolean(raw)} onChange={(e) => onSave(e.target.checked)} />
  if (col.type === 'select')
    return (
      <select className={cls} defaultValue={raw == null ? '' : String(raw)} onChange={(e) => onSave(e.target.value)}>
        {(col.options ?? []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  return (
    <input
      className={cls}
      type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
      defaultValue={raw == null ? '' : col.type === 'date' ? String(raw).slice(0, 10) : String(raw)}
      onBlur={(e) => onSave(coerce(col.type, e.target.value))}
    />
  )
}
