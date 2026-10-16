import { and, eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { askOf, MAX_QUESTION, recentAsks, writeAsk } from '../ask'
import { atLeast } from '../auth'
import { briefOf, writeBrief } from '../brief'
import { db } from '../db/postgres'
import { funnels, goals, type Role, type Site } from '../db/schema'
import { answerFor, QUESTIONS, type Question } from '../questions'
import { digestFor } from '../replay/digest'
import { replaysFor } from '../replay/list'
import { breakdownOf, DIMENSIONS } from '../stats/breakdown'
import { bucketSql, bucketsOf } from '../stats/buckets'
import { parseFilters } from '../stats/filters'
import { intentOf } from '../stats/intent'
import { pathsFor } from '../stats/lanes'
import { visitorFunnelOf } from '../stats/paths'
import { propertiesOf, propertyOf } from '../stats/properties'
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
import { intervalOf, isOpen, previousRange, RangeQuery } from '../stats/range'
import { usualVisitors } from '../stats/usual'
import { type Subject, WhyMissing, whyOf, writeWhy } from '../why'

/** Mounted under /api/sites/:id/stats, after the site and the caller's access are checked. */
type StatsEnv = { Variables: { scope: Scope; site: Site; role?: Role } }
export const statsRoutes = new Hono<StatsEnv>()

/** Rewriting a cached reading or digest costs a model call, so only admins may ask for one. */
const refreshOf = (c: Context<StatsEnv>) => {
  if (c.req.query('refresh') !== '1') return false
  return atLeast(c.get('role'), 'admin') ? true : null
}

statsRoutes.use('*', async (c, next) => {
  const site = c.get('site')
  const range = RangeQuery.safeParse(c.req.query())
  if (!range.success) return c.json({ error: z.prettifyError(range.error) }, 400)
  const defined = await db
    .select({ name: goals.name, match: goals.match })
    .from(goals)
    .where(eq(goals.siteId, site.id))
  c.set('scope', { site, range: range.data, filters: parseFilters(c.req.query()), goals: defined })
  await next()
})

/**
 * Headline numbers for the range and the period before it, plus a series bucketed by
 * `interval`: minutes for the realtime view, hours for one day, months past a quarter, days
 * otherwise. Sessions count in the bucket they started in. Revenue is in minor units of `currency`.
 * Outside the realtime view it also carries `usual`, the median day's visitors over the 28 days
 * before the range, and `today`, today's visitors so far when the range reaches today.
 */
statsRoutes.get('/main', async (c) => {
  const scope = c.get('scope')
  const before = previousRange(scope.range)
  const interval = intervalOf(scope.range)
  const s = sessions(scope)
  const p = payments(scope)
  const realtime = scope.range.since !== undefined
  const today = new Date().toLocaleDateString('en-CA', { timeZone: scope.site.timezone })
  const open = !realtime && isOpen(scope.range, scope.site.timezone)
  const [totals, previous, revenue, previousRevenue, counts, paid, usual, todays] =
    await Promise.all([
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
      realtime ? null : usualVisitors(scope),
      open ? totalsOf(scope, { from: today, to: today }).then((t) => t.visitors) : null,
    ])
  const byBucket = new Map(counts.map((d) => [d.t, d]))
  const revenueByBucket = new Map(paid.map((d) => [d.t, d.revenue]))
  return c.json({
    currency: scope.site.currency,
    interval,
    totals: { ...totals, ...revenue },
    previous: { ...previous, ...previousRevenue },
    usual,
    today: todays === null ? null : Number(todays),
    series: bucketsOf(scope.range, scope.site.timezone).map((t) => ({
      t,
      visitors: byBucket.get(t)?.visitors ?? 0,
      pageviews: byBucket.get(t)?.pageviews ?? 0,
      revenue: revenueByBucket.get(t) ?? 0,
    })),
  })
})

const BreakdownQuery = z.object({
  dimension: z.enum(DIMENSIONS),
  limit: z.coerce.number().int().min(1).max(100).default(10),
})

/** Top values of one dimension, ranked by unique visitors; see `breakdownOf`. */
statsRoutes.get('/breakdown', async (c) => {
  const q = BreakdownQuery.safeParse(c.req.query())
  if (!q.success) return c.json({ error: z.prettifyError(q.error) }, 400)
  const { dimension, limit } = q.data
  const scope = c.get('scope')
  return c.json({
    dimension,
    currency: scope.site.currency,
    rows: await breakdownOf(scope, dimension, limit),
  })
})

/**
 * Custom events and defined goals with the visitors who reached them, for this range and the one
 * before.
 */
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

const EventName = z.string().trim().min(1).max(120)

/** The property names one custom event carries in scope. */
statsRoutes.get('/properties', async (c) => {
  const event = EventName.safeParse(c.req.query('event'))
  if (!event.success) return c.json({ error: 'event: give an event name' }, 400)
  return c.json(await propertiesOf(c.get('scope'), event.data))
})

const PropertyQuery = z.object({
  event: EventName,
  key: z.string().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

/**
 * One property of a custom event: its top values by visitors, and when every value is a number,
 * its distribution over events (quartiles and equal-width bins).
 */
statsRoutes.get('/property', async (c) => {
  const q = PropertyQuery.safeParse(c.req.query())
  if (!q.success) return c.json({ error: z.prettifyError(q.error) }, 400)
  return c.json(await propertyOf(c.get('scope'), q.data.event, q.data.key, q.data.limit))
})

/** The site's funnels, to pick one for the dashboard. */
statsRoutes.get('/funnels', async (c) =>
  c.json({
    funnels: await db
      .select({ id: funnels.id, name: funnels.name })
      .from(funnels)
      .where(eq(funnels.siteId, c.get('site').id))
      .orderBy(funnels.createdAt),
  }),
)

/**
 * One funnel's steps with the visitors who reached each, in order and on any of their visits in
 * the range, for this range and the one before.
 */
statsRoutes.get('/funnel', async (c) => {
  const id = c.req.query('id') ?? ''
  const scope = c.get('scope')
  const funnel =
    z.uuid().safeParse(id).success &&
    (await db.query.funnels.findFirst({
      where: and(eq(funnels.id, id), eq(funnels.siteId, scope.site.id)),
    }))
  if (!funnel) return c.json({ error: 'not found' }, 404)
  const matches = funnel.steps.map((s) => s.match)
  const [current, before] = await Promise.all([
    visitorFunnelOf(scope, matches, scope.range),
    visitorFunnelOf(scope, matches, previousRange(scope.range)),
  ])
  return c.json({
    id: funnel.id,
    name: funnel.name,
    steps: funnel.steps.map((s, i) => ({
      name: s.name,
      kind: s.match.kind,
      visitors: current[i] ?? 0,
      previous_visitors: before[i] ?? 0,
    })),
  })
})

/**
 * Who tried to pay: activation and payment counts for this range and the one before, the
 * buckets holding a try, and the latest people who tried, each with their events in order.
 */
statsRoutes.get('/intent', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  return c.json(await intentOf(scope))
})

/**
 * How far people got: up to 4 lanes, from the site's funnels and then the latest draft's new
 * ones, each counted per visitor across the range with its failures and give-ups beside it.
 * Without lanes, the custom events instead. Also the events that went quiet.
 */
statsRoutes.get('/paths', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  return c.json(await pathsFor(scope))
})

/** The brief last written for this range. Opening the dashboard never writes one. */
statsRoutes.get('/brief', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  return c.json(await briefOf(scope))
})

/** Writes the brief for this range, replacing the last one. A model call, so admins only. */
statsRoutes.post('/brief', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  if (!atLeast(c.get('role'), 'admin'))
    return c.json({ error: 'only admins can write the brief' }, 403)
  return c.json(await writeBrief(scope))
})

/** What "Why?" is asked about: `lane=<path name>` or `visitor=<visitor id>`. */
function subjectOf(c: Context<StatsEnv>): Subject | string {
  const lane = c.req.query('lane')
  const visitor = c.req.query('visitor')
  if (lane && !visitor) return { kind: 'lane', name: lane }
  if (visitor && !lane && /^\d{1,20}$/.test(visitor)) return { kind: 'visitor', visitor }
  return 'one of lane=<path name> or visitor=<visitor id>'
}

/** The answer last written to "Why?" for a lane or a visitor in this range. */
statsRoutes.get('/why', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  const subject = subjectOf(c)
  if (typeof subject === 'string') return c.json({ error: subject }, 400)
  return c.json(await whyOf(scope, subject))
})

/** Writes the answer to "Why?" for a lane or a visitor, replacing the last one. Admins only. */
statsRoutes.post('/why', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  if (!atLeast(c.get('role'), 'admin')) return c.json({ error: 'only admins can ask why' }, 403)
  const subject = subjectOf(c)
  if (typeof subject === 'string') return c.json({ error: subject }, 400)
  try {
    return c.json(await writeWhy(scope, subject))
  } catch (err) {
    if (err instanceof WhyMissing) return c.json({ error: err.message }, 404)
    throw err
  }
})

const AskBody = z.object({ question: z.string().trim().min(3).max(MAX_QUESTION) })

/** The questions last answered for this range, newest first, for everyone who can see the site. */
statsRoutes.get('/asks', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  return c.json({ asks: await recentAsks(scope), status: (await askOf(scope, '')).status })
})

/**
 * Answers a free question for this range, replacing the last answer to it. The model reads the
 * numbers through the read-only query tools, so admins only, as for the brief.
 */
statsRoutes.post('/ask', async (c) => {
  const scope = c.get('scope')
  if (scope.range.since !== undefined) return c.json({ error: 'not for the realtime view' }, 400)
  if (!atLeast(c.get('role'), 'admin')) return c.json({ error: 'only admins can ask' }, 403)
  const body = AskBody.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return c.json({ error: z.prettifyError(body.error) }, 400)
  return c.json(await writeAsk(scope, body.data.question))
})

/**
 * One built-in question answered: fixed queries, the definition they use, and the AI explanation
 * of their figures. `refresh=1` rewrites a cached answer. Not for the realtime view.
 */
statsRoutes.get('/question', async (c) => {
  const q = c.req.query('q') ?? ''
  if (!Object.hasOwn(QUESTIONS, q))
    return c.json({ error: `q: one of ${Object.keys(QUESTIONS).join(', ')}` }, 400)
  const scope = c.get('scope')
  if (scope.range.since !== undefined)
    return c.json({ error: 'questions are not answered for the realtime view' }, 400)
  const refresh = refreshOf(c)
  if (refresh === null) return c.json({ error: 'only admins can refresh' }, 403)
  return c.json(await answerFor(q as Question, scope, { refresh }))
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
  const refresh = refreshOf(c)
  if (refresh === null) return c.json({ error: 'only admins can refresh' }, 403)
  return c.json(await digestFor(scope, { refresh }))
})
