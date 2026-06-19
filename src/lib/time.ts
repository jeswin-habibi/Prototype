import type { JobTimeEvent } from '../types'

/**
 * Active processing seconds from a start/hold/resume/stop event log.
 * Sums only the running intervals — start→(hold|stop) and resume→(hold|stop) — so
 * On-Hold gaps are excluded. If the job is still running (no stop yet) and `nowIso`
 * is given, the open interval is counted up to now (for live display).
 */
export function activeSeconds(events: JobTimeEvent[], nowIso?: string): number {
  const sorted = [...events].sort((a, b) => a.at.localeCompare(b.at))
  let total = 0
  let runningSince: string | null = null
  for (const e of sorted) {
    if (e.event_type === 'start' || e.event_type === 'resume') {
      if (runningSince === null) runningSince = e.at
    } else if (e.event_type === 'hold' || e.event_type === 'stop') {
      if (runningSince !== null) {
        total += (new Date(e.at).getTime() - new Date(runningSince).getTime()) / 1000
        runningSince = null
      }
    }
  }
  if (runningSince !== null && nowIso) {
    total += (new Date(nowIso).getTime() - new Date(runningSince).getTime()) / 1000
  }
  return Math.max(0, total)
}

export function activeHours(events: JobTimeEvent[], nowIso?: string): number {
  return activeSeconds(events, nowIso) / 3600
}

/** "1h 23m 45s" style formatting of a second count. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}
