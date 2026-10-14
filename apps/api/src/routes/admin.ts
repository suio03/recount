import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { requireAdmin, signIn, signOut } from '../auth'
import { db } from '../db/postgres'
import { sites } from '../db/schema'
import { playable, recordingOf } from '../replay/sessions'
import { rows } from '../stats/queries'
import { statsRoutes } from './stats'

export const adminRoutes = new Hono()

adminRoutes.use('/api/sites/*', requireAdmin)
adminRoutes.use('/api/sites', requireAdmin)

/** Trades ADMIN_TOKEN for the dashboard's session cookie. */
adminRoutes.post(
  '/api/login',
  bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'too large' }, 413) }),
  async (c) => {
    const body = await c.req.json().catch(() => null)
    const token = typeof body?.token === 'string' ? body.token : ''
    const result = signIn(c, token)
    if (result === 'blocked') return c.json({ error: 'too many attempts' }, 429)
    return result === 'ok' ? c.json({ ok: true }) : c.json({ error: 'wrong token' }, 401)
  },
)

adminRoutes.post('/api/logout', (c) => {
  signOut(c)
  return c.json({ ok: true })
})

/** Every site, with when its first event happened (null before any), for the "All time" range. */
adminRoutes.get('/api/sites', async (c) => {
  const [all, firsts] = await Promise.all([
    db.select().from(sites).orderBy(sites.domain),
    rows<{ site: string; first: string }>(
      `SELECT toString(site_id) AS site,
              formatDateTime(min(timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS first
       FROM events GROUP BY site_id`,
      {},
    ),
  ])
  const firstBySite = new Map(firsts.map((f) => [f.site, f.first]))
  return c.json(all.map((s) => ({ ...s, firstEvent: firstBySite.get(s.id) ?? null })))
})

const NewSite = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((d) => d.toLowerCase().replace(/^www\./, '')),
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().default('UTC'),
  ai: z.boolean().default(false),
})

adminRoutes.post('/api/sites', async (c) => {
  const parsed = NewSite.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const { domain, name, timezone, ai } = parsed.data
  const [site] = await db
    .insert(sites)
    .values({ domain, name: name ?? domain, timezone, ai })
    .onConflictDoNothing()
    .returning()
  return site ? c.json(site, 201) : c.json({ error: 'site exists' }, 409)
})

const SiteChange = z.object({ ai: z.boolean() })

/** Turns the model's reading of a site on or off. */
adminRoutes.patch('/api/sites/:id', async (c) => {
  const parsed = SiteChange.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'invalid site' }, 400)
  const [site] = await db.update(sites).set(parsed.data).where(eq(sites.id, id)).returning()
  return site ? c.json(site) : c.json({ error: 'not found' }, 404)
})

adminRoutes.route('/api/sites/:id/stats', statsRoutes)

/** A session's recording, for the replay player. Offsets count from its first event. */
adminRoutes.get('/api/sites/:id/replays/:session', async (c) => {
  const session = c.req.param('session')
  if (!/^\d{1,20}$/.test(session)) return c.json({ error: 'invalid session' }, 400)
  const recording = await recordingOf(c.req.param('id'), session).catch(() => undefined)
  const events = recording && playable(recording.loads)
  if (!events?.length) return c.json({ error: 'not found' }, 404)
  return c.json({ events })
})
