import { describe, expect, it } from 'vitest'
import { filterSql, parseFilters } from './filters'

describe('parseFilters', () => {
  it('keeps known, non-empty keys only', () => {
    expect(
      parseFilters({ channel: 'AI Assistant', page: '', from: '2026-10-01', bogus: 'x' }),
    ).toEqual({
      channel: 'AI Assistant',
    })
  })
})

describe('filterSql', () => {
  it('passes values as parameters, never inline', () => {
    const { where, params } = filterSql({
      channel: "x' OR 1=1",
      page: '/tools/cursor',
      goal: 'Search',
    })
    expect(where).toBe(
      'channel = {f_channel:String} AND has(pages, {f_page:String}) AND has(event_names, {f_goal:String})',
    )
    expect(params).toEqual({ f_channel: "x' OR 1=1", f_page: '/tools/cursor', f_goal: 'Search' })
  })

  it('matches everything without filters', () => {
    expect(filterSql({})).toEqual({ where: '1', params: {} })
  })
})
