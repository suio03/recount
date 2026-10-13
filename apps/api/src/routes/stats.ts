import { Hono } from 'hono'
import { z } from 'zod'
import { clickhouse } from '../db/clickhouse'
import { db } from '../db/postgres'
import type { Site } from '../db/schema'
import { type Filters, filterSql, parseFilters, SESSION_DIMENSIONS } from '../stats/filters'
import { type DateRange, previousRange, RangeQuery } from '../stats/range'

/** What every stats query is scoped to: one site, one date range, and the active filters. */
interface Scope {
  site: Site
  range: DateRange
  filters: Filters
}

/** Mounted under /api/sites/:id/stats behind the admin bearer token. */
export const statsRoutes = new Hono<{ Variables: { scope: Scope } }>()

statsRoutes.use('*', async (c, next) => {
  const site = await db.query.sites.findFirst({
    where: (s, { eq }) => eq(s.id, c.req.param('id') ?? ''),
  })
  if (!site) return c.json({ error: 'not found' }, 404)
  const range = RangeQuery.safeParse(c.req.query())
  if (!range.success) return c.json({ error: z.prettifyError(range.error) }, 400)
  c.set('scope', { site, range: range.data, filters: parseFilters(c.req.query()) })
  await next()
})

const inRange = `site_id = {site:UUID} AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}`

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
function sessions(scope: Scope, range = scope.range) {
  const filter = filterSql(scope.filters)
  return {
    sql: `SELECT * FROM (${SESSIONS}) WHERE ${filter.where}`,
    params: { site: scope.site.id, tz: scope.site.timezone, ...range, ...filter.params },
  }
}

async function rows<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await clickhouse.query({ query, query_params: params, format: 'JSONEachRow' })
  return result.json<T>()
}

interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounce_rate: number
  avg_session_seconds: number
}

function totalsOf(scope: Scope, range: DateRange) {
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

/** Headline numbers for the range and the period before it, plus a daily series. */
statsRoutes.get('/main', async (c) => {
  const scope = c.get('scope')
  const s = sessions(scope)
  const [totals, previous, series] = await Promise.all([
    totalsOf(scope, scope.range),
    totalsOf(scope, previousRange(scope.range)),
    rows(
      `SELECT day, uniqExact(visitor_id) AS visitors, sum(session_pageviews) AS pageviews
       FROM (${s.sql}) GROUP BY day ORDER BY day WITH FILL FROM {from:Date} TO {to:Date} + 1`,
      s.params,
    ),
  ])
  return c.json({ totals, previous, series })
})

const BreakdownQuery = z.object({
  dimension: z.enum([...SESSION_DIMENSIONS, 'page']),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

/**
 * Top values of one dimension, ranked by unique visitors. Empty values are left out. Pages are
 * counted from the pageviews of the sessions in scope.
 */
statsRoutes.get('/breakdown', async (c) => {
  const q = BreakdownQuery.safeParse(c.req.query())
  if (!q.success) return c.json({ error: z.prettifyError(q.error) }, 400)
  const { dimension, limit } = q.data
  const s = sessions(c.get('scope'))
  const query =
    dimension === 'page'
      ? `SELECT pathname AS value, uniqExact(visitor_id) AS visitors, count() AS pageviews
         FROM events
         WHERE ${inRange} AND name = 'pageview' AND session_id IN (SELECT session_id FROM (${s.sql}))
         GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`
      : `SELECT ${dimension} AS value, uniqExact(visitor_id) AS visitors, count() AS sessions
         FROM (${s.sql}) WHERE value != ''
         GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`
  return c.json({ dimension, rows: await rows(query, { ...s.params, limit }) })
})

interface GoalRow {
  name: string
  visitors: number
  events: number
}

function goalsOf(scope: Scope, range: DateRange) {
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

/** Custom events with the visitors who triggered them, for this range and the one before. */
statsRoutes.get('/goals', async (c) => {
  const scope = c.get('scope')
  const [current, before] = await Promise.all([
    goalsOf(scope, scope.range),
    goalsOf(scope, previousRange(scope.range)),
  ])
  const previous = new Map(before.map((g) => [g.name, g.visitors]))
  return c.json({
    goals: current.map((g) => ({ ...g, previous_visitors: previous.get(g.name) ?? 0 })),
  })
})
