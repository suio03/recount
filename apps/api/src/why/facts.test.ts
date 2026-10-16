import { describe, expect, it, vi } from 'vitest'
import { biggestDrop, laneFacts, personFacts } from './facts'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))

describe('biggestDrop', () => {
  it('is the step most people did not get past', () => {
    expect(biggestDrop([100, 90, 20, 15])).toBe(2)
    expect(biggestDrop([5, 5])).toBeNull()
    expect(biggestDrop([5])).toBeNull()
  })
})

describe('laneFacts', () => {
  const facts = laneFacts({
    lane: {
      name: 'Pay',
      source: 'funnel',
      steps: [
        { name: 'Pricing', kind: 'page', visitors: 200, previous: 180 },
        { name: 'Checkout', kind: 'event', visitors: 40, previous: 45 },
      ],
      side: [{ name: 'paddle_load_fail', visitors: 12 }],
    },
    splits: { device: [{ value: 'Mobile', steps: [120, 6] }] },
    props: [
      { name: 'paddle_load_fail', key: 'error_code', value: 'timeout', visitors: 9 },
      { name: 'paddle_load_fail', key: 'error_code', value: 'blocked', visitors: 3 },
      { name: 'paddle_load_fail', key: 'message', value: 'x'.repeat(200), visitors: 1 },
    ],
    stuck: {
      step: 1,
      visitors: 160,
      events: [{ name: 'faq_open', visitors: 30 }],
      exits: [{ page: '/pricing', visitors: 120 }],
    },
  })
  const text = (id: string) => facts.find((f) => f.id === id)?.text

  it('writes each step against the one before, now and before', () => {
    expect(text('s2')).toBe(
      'Step 2 "Checkout": 40 visitors (20% of the step before); the period before, 45 (25% of the step before)',
    )
  })

  it('splits, side events, their properties and where people stopped', () => {
    expect(text('d1')).toBe('Device Mobile: step 1 120, step 2 6 (5% of the step before)')
    expect(text('x1')).toBe(
      'paddle_load_fail was sent by 12 of the 200 visitors who reached step 1',
    )
    expect(text('p1')).toBe(
      'paddle_load_fail carried error_code: "timeout" for 9 visitors, "blocked" for 3 visitors',
    )
    expect(text('p2')?.length).toBeLessThan(140)
    expect(text('k1')).toBe(
      '160 visitors reached step 1 and not step 2 "Checkout"; custom events they sent in the range: faq_open 30; the last page they viewed: /pricing 120',
    )
  })
})

describe('personFacts', () => {
  const at = Date.UTC(2026, 9, 12, 14, 0)
  const event = (name: string, offset: number, extra = {}) => ({
    at: at + offset * 1000,
    name,
    path: '/pricing',
    session: '1',
    referrer: 'google.com',
    text: '',
    props: {},
    ...extra,
  })
  const facts = personFacts({
    profile: {
      country: 'JP',
      device: 'Desktop',
      browser: 'Safari',
      os: 'macOS',
      channel: 'Organic Search',
      referrer: 'google.com',
      entry: '/',
    },
    events: [
      event('pageview', 0),
      event('checkout_click', 30),
      event('checkout_click', 31),
      event('paddle_load_fail', 95, { props: { error_code: 'timeout' } }),
      event('pageview', 0, { session: '2', at: at + 86_400_000, referrer: '' }),
    ],
    ending: 'failed',
    amount: 0,
    currency: 'USD',
    timezone: 'UTC',
    faults: [{ name: 'paddle_load_fail', visitors: 12, previous: 2 }],
  })
  const text = (id: string) => facts.find((f) => f.id === id)?.text

  it('describes who they were and how it ended', () => {
    expect(text('a1')).toBe(
      'Visitor from JP on Desktop, Safari, macOS; first came from google.com, entered at /; 2 visits in range; ended with a payment failure',
    )
  })

  it('writes each visit in order with repeats folded and time since it started', () => {
    expect(text('e1')).toBe(
      'Visit 1 on Mon, Oct 12, 2:00 PM, from google.com: viewed /pricing → checkout_click ×2 at +30s → paddle_load_fail {error_code=timeout} at +1m 35s',
    )
    expect(text('e2')).toContain('Visit 2 on Tue, Oct 13, 2:00 PM, from direct: viewed /pricing')
    expect(text('c1')).toBe(
      'Across the site in this range, paddle_load_fail was sent by 12 visitors; the period before, 2',
    )
  })
})
