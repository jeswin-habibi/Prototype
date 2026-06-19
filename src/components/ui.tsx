import { useState, type ReactNode } from 'react'
import type { JobStatus } from '../types'
import { IconChevron } from './icons'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Section({
  title,
  children,
  actions,
  collapsible,
  defaultOpen = true,
}: {
  title: string
  children: ReactNode
  actions?: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const heading = (
    <h2 className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
      <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-brand-light to-brand" />
      {title}
    </h2>
  )
  if (collapsible) {
    return (
      <section className="card mb-4">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
          {heading}
          <IconChevron className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="mt-4">
            {actions && <div className="mb-3 flex flex-wrap justify-end gap-2">{actions}</div>}
            {children}
          </div>
        )}
      </section>
    )
  }
  return (
    <section className="card mb-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        {heading}
        {actions}
      </div>
      {children}
    </section>
  )
}

const TONE_TEXT = {
  default: 'text-slate-900 dark:text-white',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
}
const TONE_CHIP = {
  default: 'bg-brand-50 text-brand-700',
  good: 'bg-emerald-50 text-emerald-600',
  warn: 'bg-amber-50 text-amber-600',
  bad: 'bg-rose-50 text-rose-600',
}

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  valueClassName = 'text-2xl',
  icon,
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
  valueClassName?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card transition hover:shadow-lift dark:border-ink-700/70 dark:bg-ink-800">
      {icon && <div className={`icon-chip ${TONE_CHIP[tone]}`}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
        <div className={`mt-0.5 font-extrabold leading-tight ${valueClassName} ${TONE_TEXT[tone]}`}>{value}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  )
}

export function StatusBadge({ status }: { status: JobStatus }) {
  const cls = {
    Created: 'bg-slate-100 text-slate-600',
    Processing: 'bg-amber-100 text-amber-800',
    'On Hold': 'bg-orange-100 text-orange-800',
    Completed: 'bg-emerald-100 text-emerald-700',
  }[status]
  const dot = {
    Created: 'bg-slate-400',
    Processing: 'bg-amber-500',
    'On Hold': 'bg-orange-500',
    Completed: 'bg-emerald-500',
  }[status]
  return (
    <span className={`badge ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500 dark:border-ink-700 dark:bg-ink-800/40 dark:text-slate-400">
      {children}
    </div>
  )
}

/** Dark totals strip (e.g. page-bottom summary). 2-up on mobile, 4-up on desktop. */
export function SummaryBar({ items }: { items: { icon?: ReactNode; label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink-800 shadow-card sm:grid-cols-4">
      {items.map((it, i) => (
        <div key={i} className="bg-ink-900 px-4 py-3.5">
          {it.icon && <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-sm text-brand-light">{it.icon}</div>}
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{it.label}</div>
          <div className="text-base font-extrabold leading-tight text-white sm:text-lg">{it.value}</div>
          {it.sub && <div className="mt-0.5 text-[10px] text-slate-500">{it.sub}</div>}
        </div>
      ))}
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12 text-slate-400">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-brand" />
    </div>
  )
}

export function Banner({ tone = 'warn', children }: { tone?: 'warn' | 'info' | 'error'; children: ReactNode }) {
  const cls = {
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
  }[tone]
  return <div className={`mb-4 rounded-xl border px-4 py-3 text-sm shadow-soft ${cls}`}>{children}</div>
}
