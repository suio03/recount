import { describe, expect, it } from 'vitest'
import { z } from 'zod'

Object.assign(process.env, { DATABASE_URL: 'postgres://unused', CLICKHOUSE_URL: 'http://unused' })
const { EventDefinitionInput } = await import('./definitions')

describe('EventDefinitionInput', () => {
  it('names a property that holds personal data', () => {
    const parsed = EventDefinitionInput.safeParse({
      name: 'Signup Completed',
      description: 'A visitor confirmed their account.',
      properties: {
        plan: { type: 'string', description: 'Plan chosen' },
        userEmail: { type: 'string', description: 'Who' },
      },
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success)
      expect(z.prettifyError(parsed.error)).toContain('"userEmail" names personal data')
  })

  it('refuses the built-in events and fills defaults', () => {
    expect(EventDefinitionInput.safeParse({ name: 'click', description: 'x' }).success).toBe(false)
    expect(EventDefinitionInput.parse({ name: 'Video Played', description: 'x' })).toEqual({
      name: 'Video Played',
      description: 'x',
      key: false,
      properties: {},
    })
  })
})
