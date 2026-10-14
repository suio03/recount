import { clickhouse } from '../db/clickhouse'
import type { Site } from '../db/schema'
import { type Filters, filterSql } from './filters'
import { type DateRange, rangeParams, withinMoments } from './range'

/** What every stats query is scoped to: one site, one date range, and the active filters. */
export interface Scope {
  site: Site
  range: DateRange
  filters: Filters
}

export const inRange = `site_id = {site:UUID} AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}
  AND ${withinMoments}`

/**
 * Per-session columns, aggregated over a session's events. Acquisition and environment come from
 * the session's first event; entry is its first pageview. A bounce is a session with one
 * pageview and no other events.
 */
export const SESSION_COLUMNS = `
    session_id,
    any(visitor_id) AS visitor_id,
    min(timestamp) AS started,
    toDate(started, {tz:String}) AS day,
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
    groupUniqArray(name) AS event_names`

/** One row per session, from its events in range. */
const SESSIONS = `
  SELECT ${SESSION_COLUMNS}
  FROM events
  WHERE ${inRange}
  GROUP BY session_id`

/** SQL for the sessions in scope, plus the parameters it needs. */
export function sessions(scope: Scope, range = scope.range) {
  const filter = filterSql(scope.filters)
  return {
    sql: `SELECT * FROM (${SESSIONS}) WHERE ${filter.where}`,
    params: {
      site: scope.site.id,
      tz: scope.site.timezone,
      ...rangeParams(range),
      ...filter.params,
    },
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
       round(ifNotFinite(avg(duration), 0)) AS avg_session_seconds
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

/**
 * Payments in scope: dated by when they were paid, filtered through the snapshot of the session
 * each one is attributed to. Unattributed payments count only when no filter is active.
 */
export function payments(scope: Scope, range = scope.range) {
  const filter = filterSql(scope.filters)
  return {
    sql: `SELECT * FROM payments FINAL
          WHERE site_id = {site:UUID} AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}
            AND ${withinMoments} AND ${filter.where}`,
    params: {
      site: scope.site.id,
      tz: scope.site.timezone,
      ...rangeParams(range),
      ...filter.params,
    },
  }
}

export interface Revenue {
  /** Minor units of the site's currency, net of refunds. */
  revenue: number
  /** Payments and renewals, not refunds. */
  payments: number
  /** Customers who paid for the first time. */
  customers: number
}

export function revenueOf(scope: Scope, range: DateRange) {
  const p = payments(scope, range)
  return rows<Revenue>(
    `SELECT sum(amount) AS revenue, countIf(kind != 'refund') AS payments,
            uniqExactIf(customer_id, kind = 'new') AS customers
     FROM (${p.sql})`,
    p.params,
  ).then((r) => r[0] as Revenue)
}
