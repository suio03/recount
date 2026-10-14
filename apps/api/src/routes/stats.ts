import { Hono } from 'hono'
import { z } from 'zod'
import type { Site } from '../db/schema'
import { readingFor } from '../reading'
import { digestFor } from '../replay/digest'
import { replaysFor } from '../replay/list'
import { bucketSql, bucketsOf } from '../stats/buckets'
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
import { intervalOf, previousRange, RangeQuery } from '../stats/range'

/** Mounted under /api/sites/:id/stats, after the site and the caller's access are checked. */
export const statsRoutes = new Hono<{ Variables: { scope: Scope; site: Site } }>()

statsRoutes.use('*', async (c, next) => {
  const site = c.get('site')
  const range = RangeQuery.safeParse(c.req.query())
  if (!range.success) return c.json({ error: z.prettifyError(range.error) }, 400)
  c.set('scope', { site, range: range.data, filters: parseFilters(c.req.query()) })
  await next()
})

/**
 * Headline numbers for the range and the period before it, plus a series bucketed by
 * `interval`: minutes for the realtime view, hours for one day, months past a quarter, days
 * otherwise. Sessions count in the bucket they started in. Revenue is in minor units of `currency`.
 */
statsRoutes.get('/main', async (c) => {
  const scope = c.get('scope')
  const before = previousRange(scope.range)
  const interval = intervalOf(scope.range)
  const s = sessions(scope)
  const p = payments(scope)
  const [totals, previous, revenue, previousRevenue, counts, paid] = await Promise.all([
    totalsOf(scope, scope.range),
    totalsOf(scope, before),
    revenueOf(scope, scope.range),
    revenueOf(scope, before),
    rows<{ t: string; visitors: number; pageviews: number }>(
      `SELECT ${bucketSql(interval, 'started')} AS t, uniqExact(visitor_id) AS visitors,
              sum(session_pageviews) AS pageviews
       FROM (${s.sql}) GROUP BY t`,
      s.params,
    ),
    rows<{ t: string; revenue: number }>(
      `SELECT ${bucketSql(interval, 'timestamp')} AS t, sum(amount) AS revenue
       FROM (${p.sql}) GROUP BY t`,
      p.params,
    ),
  ])
  const byBucket = new Map(counts.map((d) => [d.t, d]))
  const revenueByBucket = new Map(paid.map((d) => [d.t, d.revenue]))
  return c.json({
    currency: scope.site.currency,
    interval,
    totals: { ...totals, ...revenue },
    previous: { ...previous, ...previousRevenue },
    series: bucketsOf(scope.range, scope.site.timezone).map((t) => ({
      t,
      visitors: byBucket.get(t)?.visitors ?? 0,
      pageviews: byBucket.get(t)?.pageviews ?? 0,
      revenue: revenueByBucket.get(t) ?? 0,
    })),
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
 * cached reading. The realtime view moves every minute, so it gets neither.
 */
statsRoutes.get('/reading', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ findings: [], reading: null, status: 'off' })
  return c.json(await readingFor(scope, { refresh: c.req.query('refresh') === '1' }))
})

/** Recorded sessions in scope with their AI summaries, newest first. */
statsRoutes.get('/replays', async (c) => c.json(await replaysFor(c.get('scope'))))

/**
 * What the range's summarized sessions have in common, each pattern citing its sessions.
 * `refresh=1` rewrites a cached digest. Not for the realtime view, which moves every minute.
 */
statsRoutes.get('/replays/digest', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ digest: null, sessions: 0, status: 'off' })
  return c.json(await digestFor(scope, { refresh: c.req.query('refresh') === '1' }))
})
