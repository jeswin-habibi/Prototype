import type { ReactNode } from 'react'
import type { JobStatus } from '../types'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card mb-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 text-sm font-bold uppercase tracking-wide text-slate-700">
          <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-brand-light to-brand" />
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const TONE_TEXT = {
  default: 'text-slate-900',
  good: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-rose-600',
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
    <div className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-card transition hover:shadow-lift">
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
    Completed: 'bg-emerald-100 text-emerald-700',
  }[status]
  const dot = {
    Created: 'bg-slate-400',
    Processing: 'bg-amber-500',
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
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-10 text-center text-sm text-slate-500">
      {children}
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
