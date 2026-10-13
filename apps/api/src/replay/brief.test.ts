import { describe, expect, it } from 'vitest'
import { type Candidate, keepMoments, numbered, reasonsOf } from './brief'
import type { Interaction } from './extract'

const visit = (over: Partial<Candidate> = {}): Candidate => ({
  session_id: '1',
  started_at: '2026-10-13 10:00:00.000',
  ended_at: '2026-10-13 10:02:00.000',
  pages: 2,
  rage_clicks: 0,
  dead_clicks: 0,
  errors: 0,
  abandoned_forms: 0,
  timeline: '[]',
  revenue: 0,
  event_names: [],
  channel: 'Direct',
  referrer: '',
  campaign: '',
  country: 'US',
  device: 'Desktop',
  browser: 'Chrome',
  ...over,
})

const pageAt = (t: number, path = '/'): Interaction => ({ t, kind: 'page', path })

describe('reasonsOf', () => {
  it('picks nothing in an ordinary visit', () => {
    expect(reasonsOf(visit({ dead_clicks: 1, event_names: ['Signup'] }), new Set())).toEqual([])
  })

  it('lists every reason, most notable first', () => {
    const keys = new Set(['Signup'])
    expect(
      reasonsOf(
        visit({
          event_names: ['Signup'],
          dead_clicks: 2,
          rage_clicks: 1,
          errors: 1,
          abandoned_forms: 1,
          revenue: 1900,
        }),
        keys,
      ),
    ).toEqual(['paid', 'abandoned_form', 'error', 'rage_click', 'dead_clicks', 'key_event'])
  })
})

describe('keepMoments', () => {
  const timeline = [pageAt(0), pageAt(5000, '/pricing'), pageAt(9000, '/checkout')]

  it('drops moments citing missing, repeated or fractional lines and orders the rest by time', () => {
    expect(
      keepMoments(
        [
          { line: 2, kind: 'friction', text: ' Left at checkout. ' },
          { line: 7, kind: 'intent', text: 'Made up.' },
          { line: 1.5, kind: 'intent', text: 'Between lines.' },
          { line: 2, kind: 'progress', text: 'Again.' },
          { line: 1, kind: 'intent', text: 'Opened pricing.' },
          { line: 0, kind: 'intent', text: '' },
        ],
        timeline,
      ),
    ).toEqual([
      { t: 5000, kind: 'intent', text: 'Opened pricing.' },
      { t: 9000, kind: 'friction', text: 'Left at checkout.' },
    ])
  })

  it('keeps at most four', () => {
    const long = Array.from({ length: 8 }, (_, i) => pageAt(i * 1000))
    const many = long.map((_, line) => ({ line, kind: 'intent' as const, text: 'x' }))
    expect(keepMoments(many, long)).toHaveLength(4)
  })
})

describe('numbered', () => {
  it('numbers lines by their place in the timeline, even after cutting the middle', () => {
    const long = Array.from({ length: 400 }, (_, i) => pageAt(i * 1000, `/p${i}`))
    const lines = numbered(long).split('\n')
    expect(lines).toHaveLength(301)
    expect(lines[0]).toBe('[0] 00:00  page /p0')
    expect(lines[150]).toBe('… 100 lines omitted …')
    expect(lines[151]).toMatch(/^\[250\] .* page \/p250$/)
    expect(lines.at(-1)).toMatch(/^\[399\] /)
  })
})
