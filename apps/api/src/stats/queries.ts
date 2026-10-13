import { clickhouse } from '../db/clickhouse'
import type { Site } from '../db/schema'
import { type Filters, filterSql } from './filters'
import type { DateRange } from './range'

/** What every stats query is scoped to: one site, one date range, and the active filters. */
export interface Scope {
  site: Site
  range: DateRange
  filters: Filters
}

export const inRange = `site_id = {site:UUID} AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}`

/**
 * One row per session. Acquisition and environment come from the session's first event; entry
 * is its first pageview. A bounce is a session with one pageview and no other events.
 */
const SESSIONS = `
  SELECT
    session_id,
    any(visitor_id) AS visitor_id,
    toDate(min(timestamp), {tz:String}) AS day,
    countIf(name = 'pageview') AS session_pageviews,
    count() AS session_events,
    dateDiff('second', min(timestamp), max(timestamp)) AS duration,
    argMin(channel, timestamp) AS channel,
    argMin(referrer_source, timestamp) AS referrer,
    argMin(utm_campaign, timestamp) AS campaign,
    argMinIf(pathname, timestamp, name = 'pageview') AS entry,
    argMin(replaceAll(toString(country_code), '\\0', ''), timestamp) AS country,
    argMin(device, timestamp) AS device,
    argMin(browser, timestamp) AS browser,
    argMin(os, timestamp) AS os,
    groupUniqArrayIf(pathname, name = 'pageview') AS pages,
    groupUniqArray(name) AS event_names
  FROM events
  WHERE ${inRange}
  GROUP BY session_id`

/** SQL for the sessions in scope, plus the parameters it needs. */
export function sessions(scope: Scope, range = scope.range) {
  const filter = filterSql(scope.filters)
  return {
    sql: `SELECT * FROM (${SESSIONS}) WHERE ${filter.where}`,
    params: { site: scope.site.id, tz: scope.site.timezone, ...range, ...filter.params },
  }
}

export async function rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' })
  return result.json<T>()
}

export interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounce_rate: number
  avg_session_seconds: number
}

export function totalsOf(scope: Scope, range: DateRange) {
  const s = sessions(scope, range)
  return rows<Totals>(
    `SELECT
       uniqExact(visitor_id) AS visitors,
       count() AS sessions,
       sum(session_pageviews) AS pageviews,
       round(countIf(session_pageviews <= 1 AND session_events = session_pageviews) / greatest(count(), 1), 4) AS bounce_rate,
       round(avg(duration)) AS avg_session_seconds
     FROM (${s.sql})`,
    s.params,
  ).then((r) => r[0] as Totals)
}

export interface GoalRow {
  name: string
  visitors: number
  events: number
}

export function goalsOf(scope: Scope, range: DateRange) {
  const s = sessions(scope, range)
  return rows<GoalRow>(
    `SELECT name, uniqExact(visitor_id) AS visitors, count() AS events
     FROM events
     WHERE ${inRange} AND name NOT IN ('pageview', 'click')
       AND session_id IN (SELECT session_id FROM (${s.sql}))
     GROUP BY name ORDER BY visitors DESC, name`,
    s.params,
  )
}
