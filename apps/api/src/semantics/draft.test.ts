import { describe, expect, it } from 'vitest'

Object.assign(process.env, { DATABASE_URL: 'postgres://unused', CLICKHOUSE_URL: 'http://unused' })
const { checkDraft, withoutIds } = await import('./draft')
const { describeSignal } = await import('./signals')

describe('withoutIds', () => {
  it('drops cited inventory ids, alone or in a list, and keeps other text', () => {
    expect(withoutIds('The thanks page is reached by most paying sessions (P10, R2).')).toBe(
      'The thanks page is reached by most paying sessions.',
    )
    expect(withoutIds('The Choose Pro button C22 commits a visitor')).toBe(
      'The Choose Pro button commits a visitor',
    )
    expect(withoutIds('Visitors play for minutes with nothing tracked (S1).')).toBe(
      'Visitors play for minutes with nothing tracked.',
    )
    expect(withoutIds('Sells the GPT4 plan for $49 at P2P rates')).toBe(
      'Sells the GPT4 plan for $49 at P2P rates',
    )
  })
})

describe('checkDraft gaps', () => {
  const site = { id: '00000000-0000-0000-0000-000000000000', timezone: 'UTC' } as never
  const inventory = {
    domain: 'example.com',
    range: { from: '2026-09-01', to: '2026-09-30' },
    visitors: 500,
    sessions: 600,
    items: [],
    signals: [
      {
        id: 'S1',
        text: '',
        kind: 'long_stay' as const,
        path: '/play',
        visitors: 120,
        seconds: 300,
        siteSeconds: 40,
        clicksPerView: 0.2,
      },
      {
        id: 'S2',
        text: '',
        kind: 'unlabeled_click' as const,
        tag: 'button',
        section: 'toolbar',
        href: '',
        pages: ['/play'],
        visitors: 80,
        clicks: 200,
      },
    ],
  }
  const gap = (title: string, signal: string | null, why = 'Visitors do something unseen.') => ({
    title,
    why,
    code: `recount('${title}')`,
    signal,
  })
  const check = (gaps: ReturnType<typeof gap>[]) =>
    checkDraft(site, inventory, { about: '', conversions: [], funnels: [], gaps })

  it('keeps one gap per signal, signals first, and marks the rest as guesses', async () => {
    const draft = await check([
      gap('Signup confirmed', null),
      gap('Icon clicked', 'S2'),
      gap('Game started', 'S1'),
      gap('Game started again', 'S1'),
    ])
    expect(draft.gaps.map((g) => [g.title, g.signal])).toEqual([
      ['Game started', 'S1'],
      ['Icon clicked', 'S2'],
      ['Signup confirmed', null],
    ])
    expect(draft.dropped).toEqual(['Gap "Game started again": a second gap for S1'])
    expect(draft.signals).toHaveLength(2)
  })

  it('turns a gap citing an unknown signal into a guess and caps the guesses', async () => {
    const draft = await check([
      gap('A', 'S9'),
      gap('B', null),
      gap('C', null),
      gap('D', 'S1', 'Visitors stay 300 seconds, 7 times the site.'),
    ])
    expect(draft.gaps.map((g) => [g.title, g.signal])).toEqual([
      ['A', null],
      ['B', null],
    ])
    expect(draft.dropped).toEqual([
      'Gap "A": no signal S9, so it is a guess',
      'Gap "C": more than 2 guesses',
      'Gap "D": quotes 7 not in its evidence',
    ])
  })
})

describe('describeSignal', () => {
  it('writes a form with nothing after it with its pages and follow-ups', () => {
    expect(
      describeSignal({
        id: 'S3',
        text: '',
        kind: 'form_no_confirmation',
        pages: ['/', '/blog'],
        tag: 'button',
        button: 'Subscribe',
        section: 'footer',
        sessions: 40,
        followed: 2,
      }),
    ).toBe(
      'S3 form sent with nothing after it: <button> "Subscribe" in section "footer", on /, /blog: clicked in 40 sessions; a page or custom event followed within 2 minutes in 2',
    )
  })
})
