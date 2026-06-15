/** Currency-ish number formatting (no symbol — owner's locale agnostic). */
export function money(n: number, dp = 2): string {
  if (n == null || Number.isNaN(n)) return '0.00'
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export function pct(n: number, dp = 1): string {
  if (n == null || Number.isNaN(n)) return '0%'
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: dp })}%`
}

export function num(n: number): string {
  return (n ?? 0).toLocaleString()
}

/** Format an ISO timestamp for display. */
export function dateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export function dateOnly(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString()
}

/** Morning / Afternoon / Night from an ISO timestamp's local hour. */
export function shiftFromIso(iso: string): string {
  const h = new Date(iso).getHours()
  if (h >= 6 && h < 14) return 'Morning'
  if (h >= 14 && h < 22) return 'Afternoon'
  return 'Night'
}
