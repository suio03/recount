import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db/postgres'
import { type Site, sites } from '../db/schema'
import { rows } from '../stats/queries'
import { statsRoutes } from './stats'

/**
 * A site's public read-only dashboard, opened by its share link without signing in. It has the
 * numbers only: no AI reading (each one costs a model call) and no recordings.
 */
export const shareRoutes = new Hono<{ Variables: { site: Site } }>()

const SHARED = new Set(['main', 'breakdown', 'goals'])

shareRoutes.use('/api/share/:token/*', async (c, next) => {
  const token = c.req.param('token') ?? ''
  const site =
    token.length >= 20 && (await db.query.sites.findFirst({ where: eq(sites.shareToken, token) }))
  if (!site) return c.json({ error: 'not found' }, 404)
  c.set('site', site)
  await next()
})

/** What the dashboard needs to show the site, with its first event for the "All time" range. */
shareRoutes.get('/api/share/:token/site', async (c) => {
  const { id, domain, name, timezone, currency } = c.get('site')
  const [first] = await rows<{ first: string }>(
    `SELECT formatDateTime(min(timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS first
     FROM events WHERE site_id = {id:UUID} HAVING count() > 0`,
    { id },
  )
  return c.json({ domain, name, timezone, currency, firstEvent: first?.first ?? null })
})

shareRoutes.use('/api/share/:token/stats/:part', async (c, next) => {
  if (!SHARED.has(c.req.param('part') ?? '')) return c.json({ error: 'not found' }, 404)
  await next()
})
shareRoutes.use('/api/share/:token/stats/*', async (c, next) => {
  if (c.req.path.split('/').length !== 6) return c.json({ error: 'not found' }, 404)
  await next()
})
shareRoutes.route('/api/share/:token/stats', statsRoutes)
