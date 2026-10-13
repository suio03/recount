import { describe, expect, it } from 'vitest'
import type { ListedSession } from './list'
import { keepPatterns } from './patterns'

const session = (id: string, over: Partial<ListedSession['summary']> = {}): ListedSession => ({
  id,
  startedAt: '2026-10-12T10:00:00.000Z',
  reasons: ['rage_click'],
  summary: {
    headline: 'Clicked the pricing table three times.',
    intent: 'Compare editors.',
    outcome: 'stuck',
    moments: [
      { t: 4000, kind: 'intent', text: 'Opened the comparison.' },
      { t: 11000, kind: 'friction', text: 'Clicked a price that is not a link.' },
    ],
    ...over,
  },
  entry: '/compare',
  channel: 'AI Assistant',
  referrer: 'chatgpt.com',
  country: 'DE',
  device: 'Desktop',
  browser: 'Chrome',
  duration: 120,
  pages: 2,
  revenue: 0,
})

const sessions = [session('101'), session('202'), session('303')]
const pattern = {
  kind: 'friction' as const,
  title: 'Pricing table read as links',
  text: 'Visitors clicked prices on the comparison page as if they were links.',
}

describe('keepPatterns', () => {
  it('resolves labels to sessions and moments to times', () => {
    const digest = keepPatterns(
      {
        headline: 'Comparison visitors keep clicking prices.',
        patterns: [
          {
            ...pattern,
            evidence: [
              { session: 's1', moment: 2 },
              { session: '[s3]', moment: 0 },
            ],
          },
        ],
      },
      sessions,
      'Oct 7 to Oct 13 (7 days)',
    )
    expect(digest.headline).toBe('Comparison visitors keep clicking prices.')
    expect(digest.patterns).toEqual([
      {
        ...pattern,
        sessions: 2,
        evidence: [
          { session: '101', t: 11000 },
          { session: '303', t: null },
        ],
      },
    ])
  })

  it('drops patterns resting on one real session', () => {
    const digest = keepPatterns(
      {
        headline: '',
        patterns: [
          {
            ...pattern,
            evidence: [
              { session: 's1', moment: 1 },
              { session: 's1', moment: 2 },
              { session: 's9', moment: 1 },
            ],
          },
        ],
      },
      sessions,
      'Oct 7 to Oct 13 (7 days)',
    )
    expect(digest).toEqual({ headline: '', patterns: [] })
  })

  it('drops counts the summaries do not contain and orders by support', () => {
    const digest = keepPatterns(
      {
        headline: '12 visitors got stuck.',
        patterns: [
          {
            ...pattern,
            title: 'Small',
            evidence: [
              { session: 's1', moment: 1 },
              { session: 's2', moment: 1 },
            ],
          },
          {
            ...pattern,
            title: 'Counted',
            text: '14 visitors clicked prices.',
            evidence: [
              { session: 's1', moment: 1 },
              { session: 's2', moment: 1 },
            ],
          },
          {
            ...pattern,
            title: 'Broad',
            text: 'Clicked a price three times.',
            evidence: sessions.map((_, i) => ({ session: `s${i + 1}`, moment: 2 })),
          },
        ],
      },
      sessions,
      'Oct 7 to Oct 13 (7 days)',
    )
    expect(digest.patterns.map((p) => p.title)).toEqual(['Broad', 'Small'])
    expect(digest.headline).toBe('Broad')
  })
})
