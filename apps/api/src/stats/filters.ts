import { type GoalDefinition, matchSql } from './goals'

/**
 * Dashboard filters. Every filter narrows the set of sessions the stats are computed from, so
 * all panels agree: a session-level filter matches the session's first-touch value, `page`
 * keeps sessions that viewed the page, `goal` keeps sessions that reached the goal: a defined
 * goal by its rule, otherwise the custom event of that name, and `prop` (`<key>=<value>`) keeps
 * sessions with an event carrying that property value.
 */

export const SESSION_DIMENSIONS = [
  'channel',
  'referrer',
  'campaign',
  'entry',
  'country',
  'device',
  'browser',
  'os',
] as const

export const FILTER_KEYS = [...SESSION_DIMENSIONS, 'page', 'goal', 'prop'] as const

export type FilterKey = (typeof FILTER_KEYS)[number]
export type Filters = Partial<Record<FilterKey, string>>

const MAX_LENGTH = 500

/** A `prop` filter's key and value, split at the first `=`; a key cannot contain one. */
export function propertyFilter(value: string): { key: string; value: string } | undefined {
  const at = value.indexOf('=')
  return at > 0 ? { key: value.slice(0, at), value: value.slice(at + 1) } : undefined
}

/** Reads filters from query-string values. Unknown keys and empty values are ignored. */
export function parseFilters(query: Record<string, string | undefined>): Filters {
  const filters: Filters = {}
  for (const key of FILTER_KEYS) {
    const value = query[key]
    if (value && (key !== 'prop' || propertyFilter(value)))
      filters[key] = value.slice(0, MAX_LENGTH)
  }
  return filters
}

/**
 * A WHERE condition over the SESSIONS columns, with values passed as query parameters named
 * `f_<key>`. Returns `1` when there are no filters. A defined goal looks up its sessions among
 * the events matching `events`, which should be the ones the session columns were built from,
 * so the goal is reached within the same range as `event_names` and `pages`.
 */
export function filterSql(
  filters: Filters,
  goals: GoalDefinition[] = [],
  events = 'site_id = {site:UUID}',
): { where: string; params: Record<string, string> } {
  const conditions: string[] = []
  const params: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value === undefined) continue
    const defined = key === 'goal' ? goals.find((g) => g.name === value) : undefined
    if (defined) {
      const match = matchSql(defined.match, 'f_goal')
      Object.assign(params, match.params)
      conditions.push(
        `session_id IN (SELECT session_id FROM events WHERE ${events} AND ${match.sql})`,
      )
      continue
    }
    if (key === 'prop') {
      const property = propertyFilter(value)
      if (!property) continue
      params.f_prop_key = property.key
      params.f_prop_value = property.value
      conditions.push(
        `session_id IN (SELECT session_id FROM events WHERE ${events} AND mapContains(props, {f_prop_key:String}) AND props[{f_prop_key:String}] = {f_prop_value:String})`,
      )
      continue
    }
    const param = `{f_${key}:String}`
    params[`f_${key}`] = value
    if (key === 'page') conditions.push(`has(pages, ${param})`)
    else if (key === 'goal') conditions.push(`has(event_names, ${param})`)
    else conditions.push(`${key} = ${param}`)
  }
  return { where: conditions.length ? conditions.join(' AND ') : '1', params }
}
