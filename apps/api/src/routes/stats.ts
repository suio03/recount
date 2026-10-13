import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/postgres'
import { readingFor } from '../reading'
import { parseFilters, SESSION_DIMENSIONS } from '../stats/filters'
import {
  goalsOf,
  inRange,
  payments,
  revenueOf,
  rows,
  type Scope,
  sessions,
  totalsOf,
} from '../stats/queries'
import { previousRange, RangeQuery } from '../stats/range'

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

/**
 * Headline numbers for the range and the period before it, plus a daily series. Revenue is in
 * minor units of `currency`.
 */
statsRoutes.get('/main', async (c) => {
  const scope = c.get('scope')
  const before = previousRange(scope.range)
  const s = sessions(scope)
  const p = payments(scope)
  const [totals, previous, revenue, previousRevenue, series, daily] = await Promise.all([
    totalsOf(scope, scope.range),
    totalsOf(scope, before),
    revenueOf(scope, scope.range),
    revenueOf(scope, before),
    rows<{ day: string; visitors: number; pageviews: number }>(
      `SELECT day, uniqExact(visitor_id) AS visitors, sum(session_pageviews) AS pageviews
       FROM (${s.sql}) GROUP BY day ORDER BY day WITH FILL FROM {from:Date} TO {to:Date} + 1`,
      s.params,
    ),
    rows<{ day: string; revenue: number }>(
      `SELECT toDate(timestamp, {tz:String}) AS day, sum(amount) AS revenue
       FROM (${p.sql}) GROUP BY day`,
      p.params,
    ),
  ])
  const revenueByDay = new Map(daily.map((d) => [d.day, d.revenue]))
  return c.json({
    currency: scope.site.currency,
    totals: { ...totals, ...revenue },
    previous: { ...previous, ...previousRevenue },
    series: series.map((d) => ({ ...d, revenue: revenueByDay.get(d.day) ?? 0 })),
  })
})

const BreakdownQuery = z.object({
  dimension: z.enum([...SESSION_DIMENSIONS, 'page']),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

/**
 * Top values of one dimension, ranked by unique visitors. Empty values are left out. Pages are
 * counted from the pageviews of the sessions in scope. Session dimensions also carry the
 * revenue attributed to each value; pages do not, since one payment's session views many.
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
  const found = await rows<{ value: string; visitors: number }>(query, { ...s.params, limit })
  const scope = c.get('scope')
  if (dimension === 'page') return c.json({ dimension, currency: scope.site.currency, rows: found })
  const p = payments(scope)
  const revenue = await rows<{ value: string; revenue: number }>(
    `SELECT ${dimension} AS value, sum(amount) AS revenue
     FROM (${p.sql}) WHERE value IN {values:Array(String)} GROUP BY value`,
    { ...p.params, values: found.map((r) => r.value) },
  )
  const byValue = new Map(revenue.map((r) => [r.value, r.revenue]))
  return c.json({
    dimension,
    currency: scope.site.currency,
    rows: found.map((r) => ({ ...r, revenue: byValue.get(r.value) ?? 0 })),
  })
})

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

/**
 * What changed and why: detected findings plus the AI reading of them. `refresh=1` rewrites a
 * cached reading.
 */
statsRoutes.get('/reading', async (c) =>
  c.json(await readingFor(c.get('scope'), { refresh: c.req.query('refresh') === '1' })),
)
