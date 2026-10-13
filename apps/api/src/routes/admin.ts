import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { z } from 'zod'
import { db } from '../db/postgres'
import { sites } from '../db/schema'
import { env } from '../env'
import { playable, recordingOf } from '../replay/sessions'
import { statsRoutes } from './stats'

export const adminRoutes = new Hono()

adminRoutes.use('/api/sites/*', bearerAuth({ token: env.ADMIN_TOKEN }))
adminRoutes.use('/api/sites', bearerAuth({ token: env.ADMIN_TOKEN }))

adminRoutes.get('/api/sites', async (c) =>
  c.json(await db.select().from(sites).orderBy(sites.domain)),
)

const NewSite = z.object({
  domain: z
    .string()
    .min(3)
    .max(253)
    .transform((d) => d.toLowerCase().replace(/^www\./, '')),
  name: z.string().min(1).max(100).optional(),
  timezone: z.string().default('UTC'),
})

adminRoutes.post('/api/sites', async (c) => {
  const parsed = NewSite.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const { domain, name, timezone } = parsed.data
  const [site] = await db
    .insert(sites)
    .values({ domain, name: name ?? domain, timezone })
    .onConflictDoNothing()
    .returning()
  return site ? c.json(site, 201) : c.json({ error: 'site exists' }, 409)
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
