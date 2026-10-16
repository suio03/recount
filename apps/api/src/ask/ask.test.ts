import { describe, expect, it, vi } from 'vitest'
import { normalizeQuestion, vetLines } from './index'
import { QueryError, runTool, toolSpecs } from './tools'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))
vi.mock('../env', () => ({ env: { READING_MODEL: 'test' } }))

describe('normalizeQuestion', () => {
  it('is the same question however it is spaced', () => {
    expect(normalizeQuestion('  why   did\n nobody pay? ')).toBe('why did nobody pay?')
    expect(normalizeQuestion('x'.repeat(400))).toHaveLength(300)
  })
})

describe('vetLines', () => {
  const results = new Map([
    ['r1', 'Visitors 1,204 (before 980)'],
    ['r2', 'checkout_start: 7 visitors'],
  ])
  const context = ['14 days Oct 3 Oct 16 2026-10-03 2026-10-16', 'Why?']

  it('keeps a line whose numbers its cited results hold', () => {
    const lines = vetLines(
      [{ kind: 'fact', text: '1,204 visitors, up from 980.', evidence: ['r1'] }],
      results,
      context,
    )
    expect(lines).toEqual([
      { kind: 'fact', text: '1,204 visitors, up from 980.', evidence: ['r1'] },
    ])
  })

  it('drops a line quoting a number only an uncited result holds', () => {
    const lines = vetLines(
      [{ kind: 'fact', text: '7 people started checkout.', evidence: ['r1'] }],
      results,
      context,
    )
    expect(lines).toEqual([])
  })

  it('drops evidence naming no result, and a line with nothing to say', () => {
    const lines = vetLines(
      [
        { kind: 'guess', text: 'The numbers are too small to tell.', evidence: ['r9'] },
        { kind: 'fact', text: '  ', evidence: [] },
      ],
      results,
      context,
    )
    expect(lines).toEqual([
      { kind: 'guess', text: 'The numbers are too small to tell.', evidence: [] },
    ])
  })

  it('lets a line name the range', () => {
    const lines = vetLines(
      [{ kind: 'fact', text: 'From Oct 3 to Oct 16, 7 started checkout.', evidence: ['r2'] }],
      results,
      context,
    )
    expect(lines).toHaveLength(1)
  })
})

describe('runTool', () => {
  const ctx = {
    site: { id: 's', timezone: 'UTC' } as never,
    goals: [],
    range: { from: '2026-10-01', to: '2026-10-16' },
  }

  it('refuses a tool it does not have', async () => {
    await expect(runTool(ctx, 'get_json', {})).rejects.toBeInstanceOf(QueryError)
  })

  it('refuses input outside the schema before querying', async () => {
    await expect(runTool(ctx, 'get_breakdown', { dimension: 'shoe size' })).rejects.toBeInstanceOf(
      QueryError,
    )
    await expect(
      runTool(ctx, 'get_traffic', { from: '2026-10-16', to: '2026-10-01' }),
    ).rejects.toBeInstanceOf(QueryError)
    await expect(
      runTool(ctx, 'get_traffic', { from: '2024-01-01', to: '2026-10-01' }),
    ).rejects.toBeInstanceOf(QueryError)
  })

  it('describes every tool with an object schema', () => {
    for (const t of toolSpecs()) {
      expect(t.input_schema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(20)
    }
  })
})
