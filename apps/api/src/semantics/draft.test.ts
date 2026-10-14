import { describe, expect, it } from 'vitest'

Object.assign(process.env, { DATABASE_URL: 'postgres://unused', CLICKHOUSE_URL: 'http://unused' })
const { withoutIds } = await import('./draft')

describe('withoutIds', () => {
  it('drops cited inventory ids, alone or in a list, and keeps other text', () => {
    expect(withoutIds('The thanks page is reached by most paying sessions (P10, R2).')).toBe(
      'The thanks page is reached by most paying sessions.',
    )
    expect(withoutIds('The Choose Pro button C22 commits a visitor')).toBe(
      'The Choose Pro button commits a visitor',
    )
    expect(withoutIds('Sells the GPT4 plan for $49 at P2P rates')).toBe(
      'Sells the GPT4 plan for $49 at P2P rates',
    )
  })
})
