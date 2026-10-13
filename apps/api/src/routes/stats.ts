import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db/postgres'
import { readingFor } from '../reading'
import { parseFilters, SESSION_DIMENSIONS } from '../stats/filters'
import { goalsOf, inRange, rows, type Scope, sessions, totalsOf } from '../stats/queries'
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
