import { describe, expect, it } from 'vitest'
import { GoalMatch, matchSql, pathPattern } from './goals'

describe('pathPattern', () => {
  it('anchors the path and lets * stand for anything', () => {
    expect(pathPattern('/blog/*')).toBe('^/blog/.*$')
    expect(new RegExp(pathPattern('/blog/*')).test('/blog/a/b')).toBe(true)
    expect(new RegExp(pathPattern('/blog/*')).test('/blogs')).toBe(false)
  })

  it('escapes other pattern characters', () => {
    const re = new RegExp(pathPattern('/a.b+(c)?'))
    expect(re.test('/a.b+(c)?')).toBe(true)
    expect(re.test('/axbb')).toBe(false)
  })
})

describe('matchSql', () => {
  it('matches a page by pattern, passed as a parameter', () => {
    expect(matchSql({ kind: 'page', path: '/pricing' }, 'g0')).toEqual({
      sql: "(name = 'pageview' AND match(pathname, {g0_path:String}))",
      params: { g0_path: '^/pricing$' },
    })
  })

  it('matches a click only on the fields that are set', () => {
    const { sql, params } = matchSql(
      { kind: 'click', text: "Start' OR 1=1", section: 'hero' },
      'g1',
    )
    expect(sql).toBe(
      "(element_tag != '' AND (positionCaseInsensitiveUTF8(element_text, {g1_text:String}) > 0 OR positionCaseInsensitiveUTF8(element_label, {g1_text:String}) > 0) AND lowerUTF8(element_section) = lowerUTF8({g1_section:String}))",
    )
    expect(params).toEqual({ g1_text: "Start' OR 1=1", g1_section: 'hero' })
  })
})

describe('GoalMatch', () => {
  it('needs a click to say what was clicked', () => {
    expect(GoalMatch.safeParse({ kind: 'click', page: '/pricing' }).success).toBe(false)
    expect(GoalMatch.safeParse({ kind: 'click', text: 'Buy' }).success).toBe(true)
  })

  it('needs a page path to start with /', () => {
    expect(GoalMatch.safeParse({ kind: 'page', path: 'pricing' }).success).toBe(false)
  })
})
