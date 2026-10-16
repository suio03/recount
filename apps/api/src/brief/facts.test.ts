import { describe, expect, it, vi } from 'vitest'
import type { Finding } from '../reading/changes'
import { type BriefInputs, factsOf, vettedLines } from './facts'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))

const range = { from: '2026-10-10', to: '2026-10-16' }
const totals = {
  visitors: 192,
  sessions: 230,
  pageviews: 600,
  bounce_rate: 0.25,
  avg_session_seconds: 155,
  revenue: 0,
  payments: 0,
  customers: 0,
}
const finding: Finding = {
  id: 'f1',
  subject: { kind: 'segment', dimension: 'referrer', value: 'google.com' },
  metric: 'visitors',
  current: 120,
  previous: 80,
  change: 0.5,
  filters: { referrer: 'google.com' },
}

const inputs: BriefInputs = {
  currency: 'USD',
  traffic: {
    totals,
    previous: { ...totals, visitors: 243 },
    usual: 32,
    today: 23,
  },
  findings: [finding],
  intent: {
    events: {
      activation: ['signin_success'],
      start: ['checkout_click'],
      paid: [],
      failed: ['paddle_load_fail'],
      closed: [],
    },
    provider: false,
    totals: { activated: 39, tried: 3, paid: 0 },
    previous: { activated: 40, tried: 0, paid: 0 },
    people: [
      {
        visitor: '1',
        last: 0,
        channel: 'Organic Search',
        referrer: 'google.com',
        entry: '/',
        country: 'JP',
        device: 'Desktop',
        browser: 'Chrome',
        visits: 2,
        pageviews: 9,
        amount: 0,
        ending: 'failed',
        trail: [
          { name: 'checkout_click', at: 0, n: 2, role: 'start', fault: false },
          { name: 'paddle_load_fail', at: 0, n: 1, role: 'failed', fault: true },
        ],
      },
    ],
  },
  paths: {
    lanes: [
      {
        name: 'Pay',
        source: 'funnel',
        steps: [
          { name: 'Sign in', kind: 'event', visitors: 39, previous: 40 },
          { name: 'Checkout', kind: 'event', visitors: 3, previous: 0 },
        ],
        side: [{ name: 'paddle_load_fail', visitors: 1 }],
      },
    ],
    events: null,
    ai: true,
    quiet: [
      {
        name: 'video_render_requested',
        days: 4,
        last: '2026-10-11',
        active: 12,
        perDay: 2.5,
        recent: [2, 1, 0, 0, 0, 0, 0],
      },
    ],
  },
}

describe('factsOf', () => {
  const facts = factsOf(inputs)
  const byId = new Map(facts.map((f) => [f.id, f]))

  it('writes each section with its own ids', () => {
    expect(byId.get('t1')?.text).toBe('Visitors: now 192, before 243, change -21%')
    expect(byId.get('t5')?.text).toBe('Visitors so far today: 23; a usual day has about 32')
    expect(byId.get('i2')).toMatchObject({ section: 'tried' })
    expect(byId.get('v1')?.text).toContain(
      'events in order: checkout_click ×2 → paddle_load_fail; ended with a payment failure',
    )
    expect(byId.get('l1')?.text).toContain('step 2 "Checkout" 3 visitors, 8% of step 1 (before 0)')
    expect(byId.get('l1')?.text).toContain('paddle_load_fail 1 visitors')
    expect(byId.get('q1')).toMatchObject({ section: 'quiet' })
  })

  it('leaves revenue out when there was none', () => {
    expect(facts.some((f) => f.text.startsWith('Revenue'))).toBe(false)
  })

  it('keeps a detected change with its filters', () => {
    expect(byId.get('f1')).toMatchObject({
      section: 'traffic',
      filters: { referrer: 'google.com' },
    })
    expect(byId.get('f1')?.text).not.toMatch(/^\[f1\]/)
  })
})

describe('vettedLines', () => {
  const facts = factsOf(inputs)

  it('links a line to the section of its first fact and the filters it cites', () => {
    const [quiet, traffic] = vettedLines(
      {
        lines: [
          { kind: 'guess', text: 'video_render_requested stopped 4 days ago.', evidence: ['q1'] },
          { kind: 'fact', text: 'Google brought 120 visitors.', evidence: ['t1', 'f1'] },
        ],
      },
      facts,
      range,
    )
    expect(quiet).toMatchObject({ kind: 'guess', section: 'quiet', filters: undefined })
    expect(traffic).toMatchObject({ section: 'traffic', filters: { referrer: 'google.com' } })
  })

  it('drops lines citing nothing known or quoting numbers their facts lack', () => {
    expect(
      vettedLines(
        {
          lines: [
            { kind: 'fact', text: 'Something happened.', evidence: ['x9'] },
            { kind: 'fact', text: '5 people tried to pay.', evidence: ['i2'] },
          ],
        },
        facts,
        range,
      ),
    ).toEqual([])
  })
})
