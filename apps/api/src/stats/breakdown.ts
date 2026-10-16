import { SESSION_DIMENSIONS } from './filters'
import { inRange, payments, rows, type Scope, sessions } from './queries'
import type { DateRange } from './range'

export const DIMENSIONS = [...SESSION_DIMENSIONS, 'page'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export interface BreakdownRow {
  value: string
  visitors: number
  /** Attributed revenue in minor units, for session dimensions. */
  revenue?: number
}

/**
 * Top values of one dimension, ranked by unique visitors. Empty values are left out. Pages are
 * counted from the pageviews of the sessions in scope. Session dimensions also carry the
 * revenue attributed to each value; pages do not, since one payment's session views many.
 * `only` counts just those values, to compare them with another range.
 */
export async function breakdownOf(
  scope: Scope,
  dimension: Dimension,
  limit: number,
  range: DateRange = scope.range,
  only?: string[],
): Promise<BreakdownRow[]> {
  const s = sessions(scope, range)
  const values = only ? 'AND value IN {only:Array(String)}' : ''
  const query =
    dimension === 'page'
      ? `SELECT pathname AS value, uniqExact(visitor_id) AS visitors, count() AS pageviews
         FROM events
         WHERE ${inRange} AND name = 'pageview' AND session_id IN (SELECT session_id FROM (${s.sql}))
           ${values}
         GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`
      : `SELECT ${dimension} AS value, uniqExact(visitor_id) AS visitors, count() AS sessions
         FROM (${s.sql}) WHERE value != '' ${values}
         GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`
  const found = (await rows<BreakdownRow>(query, { ...s.params, limit, only: only ?? [] })).map(
    (r) => ({ ...r, visitors: Number(r.visitors) }),
  )
  if (dimension === 'page' || !found.length) return found
  const p = payments(scope, range)
  const revenue = await rows<{ value: string; revenue: number }>(
    `SELECT ${dimension} AS value, sum(amount) AS revenue
     FROM (${p.sql}) WHERE value IN {values:Array(String)} GROUP BY value`,
    { ...p.params, values: found.map((r) => r.value) },
  )
  const byValue = new Map(revenue.map((r) => [r.value, Number(r.revenue)]))
  return found.map((r) => ({ ...r, revenue: byValue.get(r.value) ?? 0 }))
}
