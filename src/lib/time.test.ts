import { describe, expect, it } from 'vitest'
import { activeSeconds, formatDuration } from './time'
import type { JobTimeEvent } from '../types'

function ev(event_type: JobTimeEvent['event_type'], at: string): JobTimeEvent {
  return { id: at + event_type, job_id: 'j', event_type, at }
}

describe('activeSeconds', () => {
  it('counts a simple start→stop span', () => {
    const events = [ev('start', '2026-06-19T10:00:00Z'), ev('stop', '2026-06-19T11:00:00Z')]
    expect(activeSeconds(events)).toBe(3600)
  })

  it('excludes the On-Hold gap', () => {
    const events = [
      ev('start', '2026-06-19T10:00:00Z'),
      ev('hold', '2026-06-19T10:30:00Z'), // 30m active
      ev('resume', '2026-06-19T11:00:00Z'), // 30m paused (excluded)
      ev('stop', '2026-06-19T11:15:00Z'), // +15m active
    ]
    expect(activeSeconds(events)).toBe(45 * 60)
  })

  it('counts an open interval up to now when still running', () => {
    const events = [ev('start', '2026-06-19T10:00:00Z')]
    expect(activeSeconds(events, '2026-06-19T10:10:00Z')).toBe(600)
  })

  it('ignores ordering of events', () => {
    const events = [ev('stop', '2026-06-19T11:00:00Z'), ev('start', '2026-06-19T10:00:00Z')]
    expect(activeSeconds(events)).toBe(3600)
  })

  it('returns 0 with no events', () => {
    expect(activeSeconds([])).toBe(0)
  })
})

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(3600 + 23 * 60)).toBe('1h 23m')
  })
  it('formats minutes and seconds', () => {
    expect(formatDuration(5 * 60 + 9)).toBe('5m 9s')
  })
})
