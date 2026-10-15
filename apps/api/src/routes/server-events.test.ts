import { describe, expect, it } from 'vitest'

Object.assign(process.env, { DATABASE_URL: 'postgres://unused', CLICKHOUSE_URL: 'http://unused' })
const { ServerEvent } = await import('./server-events')

const ids = { recount_vid: '0b7e3f5c-4c1a-4f7e-9a3d-2f1e0c9b8a76' }

describe('ServerEvent', () => {
  it('takes a custom event with the browser ids and simple properties', () => {
    const event = {
      site: 'example.com',
      name: 'Signup Completed',
      ids,
      props: { plan: 'pro', seats: 3 },
    }
    expect(ServerEvent.parse(event)).toEqual(event)
  })

  it('refuses built-in events, missing ids and nested properties', () => {
    expect(ServerEvent.safeParse({ site: 'example.com', name: 'pageview', ids }).success).toBe(
      false,
    )
    expect(ServerEvent.safeParse({ site: 'example.com', name: 'Paid' }).success).toBe(false)
    expect(
      ServerEvent.safeParse({ site: 'example.com', name: 'Paid', ids, props: { a: { b: 1 } } })
        .success,
    ).toBe(false)
  })
})
