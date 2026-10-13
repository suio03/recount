/**
 * Dashboard filters. Every filter narrows the set of sessions the stats are computed from, so
 * all panels agree: a session-level filter matches the session's first-touch value, `page`
 * keeps sessions that viewed the page, and `goal` keeps sessions that triggered the event.
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

export const FILTER_KEYS = [...SESSION_DIMENSIONS, 'page', 'goal'] as const

export type FilterKey = (typeof FILTER_KEYS)[number]
export type Filters = Partial<Record<FilterKey, string>>

const MAX_LENGTH = 500

/** Reads filters from query-string values. Unknown keys and empty values are ignored. */
export function parseFilters(query: Record<string, string | undefined>): Filters {
  const filters: Filters = {}
  for (const key of FILTER_KEYS) {
    const value = query[key]
    if (value) filters[key] = value.slice(0, MAX_LENGTH)
  }
  return filters
}

/**
 * A WHERE condition over the SESSIONS columns, with values passed as query parameters named
 * `f_<key>`. Returns `1` when there are no filters.
 */
export function filterSql(filters: Filters): { where: string; params: Record<string, string> } {
  const conditions: string[] = []
  const params: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const value = filters[key]
    if (value === undefined) continue
    const param = `{f_${key}:String}`
    params[`f_${key}`] = value
    if (key === 'page') conditions.push(`has(pages, ${param})`)
    else if (key === 'goal') conditions.push(`has(event_names, ${param})`)
    else conditions.push(`${key} = ${param}`)
  }
  return { where: conditions.length ? conditions.join(' AND ') : '1', params }
}
