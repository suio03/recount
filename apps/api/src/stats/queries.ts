import { clickhouse } from '../db/clickhouse'
import type { Site } from '../db/schema'
import { type Filters, filterSql } from './filters'
import { type GoalDefinition, type GoalMatch, type Match, matchSql } from './goals'
import { type DateRange, rangeParams, withinMoments } from './range'

/**
 * What every stats query is scoped to: one site, one date range, and the active filters. The
 * site's defined goals come along, since a goal filter needs its rule.
 */
export interface Scope {
  site: Site
  range: DateRange
  filters: Filters
  goals: GoalDefinition[]
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
  const filter = filterSql(scope.filters, scope.goals, inRange)
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

/** How far back a visitor counts as on the site now. */
export const CURRENT_MINUTES = 5

/** Visitors with any event in the last few minutes, regardless of filters and range. */
export async function currentVisitors(site: Pick<Site, 'id'>): Promise<number> {
  const [row] = await rows<{ visitors: number }>(
    `SELECT uniqExact(visitor_id) AS visitors FROM events
     WHERE site_id = {site:UUID} AND timestamp >= now() - INTERVAL {minutes:UInt8} MINUTE
       AND timestamp <= now()`,
    { site: site.id, minutes: CURRENT_MINUTES },
  )
  return Number(row?.visitors ?? 0)
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
  /** A custom event, or what a defined goal matches. */
  kind: 'event' | GoalMatch['kind']
  visitors: number
  events: number
}

/**
 * Custom events and defined goals with the visitors who reached them among the sessions in
 * scope. A defined goal is listed even when nobody reached it, and wins over a custom event of
 * the same name.
 */
export async function goalsOf(scope: Scope, range: DateRange): Promise<GoalRow[]> {
  const s = sessions(scope, range)
  const inScope = `${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))`
  const matches = scope.goals.map((g, i) => matchSql(g.match, `g${i}`))
  const [events, defined] = await Promise.all([
    rows<{ name: string; visitors: number; events: number }>(
      `SELECT name, uniqExact(visitor_id) AS visitors, count() AS events
       FROM events
       WHERE ${inScope} AND name NOT IN ('pageview', 'click')
       GROUP BY name`,
      s.params,
    ),
    matches.length
      ? rows<Record<string, number>>(
          `SELECT ${matches
            .map((m, i) => `uniqExactIf(visitor_id, ${m.sql}) AS v${i}, countIf(${m.sql}) AS e${i}`)
            .join(', ')}
           FROM events WHERE ${inScope}`,
          Object.assign({}, s.params, ...matches.map((m) => m.params)),
        ).then((r) => r[0] ?? {})
      : ({} as Record<string, number>),
  ])
  const names = new Set(scope.goals.map((g) => g.name))
  return [
    ...scope.goals.map((g, i) => ({
      name: g.name,
      kind: g.match.kind,
      visitors: Number(defined[`v${i}`] ?? 0),
      events: Number(defined[`e${i}`] ?? 0),
    })),
    ...events.filter((e) => !names.has(e.name)).map((e) => ({ ...e, kind: 'event' as const })),
  ].sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name))
}

/** Funnels count visits: a session moves down a step once it reaches the next one, in order. */
const FUNNEL_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Visitors who reached each step of a funnel, in order, within one session in scope. Other
 * events may happen between steps. Each event moves a session at most one step, so a view of
 * `/products/pro` alone does not complete both `/products/*` and `/products/pro`, and a step
 * repeated needs the event twice. `visitors[i]` counts those who got at least to step i.
 */
export function funnelSql(scope: Scope, steps: Match[], range: DateRange) {
  const s = sessions(scope, range)
  const matches = steps.map((m, i) => matchSql(m, `s${i}`))
  return {
    sql: `SELECT ${steps.map((_, i) => `uniqExactIf(visitor_id, level >= ${i + 1}) AS s${i}`).join(', ')}
     FROM (
       SELECT any(visitor_id) AS visitor_id,
              windowFunnel(${FUNNEL_WINDOW_MS}, 'strict_once')(
                toUInt64(toUnixTimestamp64Milli(timestamp)), ${matches.map((m) => m.sql).join(', ')}
              ) AS level
       FROM events
       WHERE ${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
       GROUP BY session_id
     )`,
    params: Object.assign({}, s.params, ...matches.map((m) => m.params)),
  }
}

export async function funnelOf(scope: Scope, steps: Match[], range: DateRange) {
  const f = funnelSql(scope, steps, range)
  const [row] = await rows<Record<string, number>>(f.sql, f.params)
  return steps.map((_, i) => Number(row?.[`s${i}`] ?? 0))
}

/**
 * Payments in scope: dated by when they were paid, filtered through the snapshot of the session
 * each one is attributed to. Unattributed payments count only when no filter is active. Like the
 * snapshot, a defined goal looks at the whole session, whenever its events happened.
 */
export function payments(scope: Scope, range = scope.range) {
  const filter = filterSql(scope.filters, scope.goals)
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
