import { and, eq, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { atLeast } from '../auth'
import { db } from '../db/postgres'
import { type RevenueSource, revenueSources } from '../db/schema'
import { checkPaddleKey } from '../revenue/paddle'
import { syncSource } from '../revenue/sync'
import { canSeal, seal } from '../secrets'
import type { SiteEnv } from './admin'

/** A site's payment providers: connecting one with its key, syncing and disconnecting. */
export const revenueRoutes = new Hono<SiteEnv>()

revenueRoutes.use(bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'too large' }, 413) }))

/** Sources syncing right now, so the dashboard can say so and a second sync is not started. */
const syncing = new Set<string>()

function startSync(source: RevenueSource) {
  if (syncing.has(source.id)) return
  syncing.add(source.id)
  syncSource(source)
    .catch((e) => console.error(`revenue sync ${source.provider} for site ${source.siteId}:`, e))
    .finally(() => syncing.delete(source.id))
}

const publicSource = (s: RevenueSource) => ({
  id: s.id,
  provider: s.provider,
  /** Where the key lives: sealed in the database, or in an environment variable. */
  keyEnv: s.keyEnv,
  keyHint: s.keyHint,
  match: s.match,
  syncedAt: s.syncedAt,
  lastError: s.lastError,
  syncing: syncing.has(s.id),
})

const sourcesOf = (siteId: string) =>
  db
    .select()
    .from(revenueSources)
    .where(eq(revenueSources.siteId, siteId))
    .orderBy(revenueSources.createdAt)

// Viewers see which providers are connected; admins change them.
revenueRoutes.use('/*', async (c, next) => {
  if (c.req.method !== 'GET' && !atLeast(c.get('role'), 'admin'))
    return c.json({ error: 'not allowed' }, 403)
  await next()
})

revenueRoutes.get('/', async (c) =>
  c.json({
    canStoreKeys: canSeal(),
    sources: (await sourcesOf(c.get('site').id)).map(publicSource),
  }),
)

const Connect = z.object({
  provider: z.literal('paddle'),
  key: z.string().trim().min(10).max(500),
  /** Keeps only transactions whose custom data has all of these, for an account billing several products. */
  match: z.record(z.string().min(1).max(100), z.string().max(200)).default({}),
})

/**
 * Connects a provider with a key, checked with the provider first. Connecting again replaces the
 * key. The first sync starts right away and reads the account's whole history.
 */
revenueRoutes.post('/', async (c) => {
  if (!canSeal()) return c.json({ error: 'ENCRYPTION_KEY is not set on the server' }, 400)
  const parsed = Connect.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const { provider, key, match } = parsed.data
  const problem = await checkPaddleKey(key)
  if (problem) return c.json({ error: problem }, 400)
  const siteId = c.get('site').id
  const source = await db.transaction(async (tx) => {
    await tx
      .delete(revenueSources)
      .where(
        and(
          eq(revenueSources.siteId, siteId),
          eq(revenueSources.provider, provider),
          isNotNull(revenueSources.keyCipher),
        ),
      )
    const [created] = await tx
      .insert(revenueSources)
      .values({ siteId, provider, match, keyCipher: seal(key), keyHint: key.slice(-4) })
      .returning()
    return created
  })
  if (!source) return c.json({ error: 'not saved' }, 500)
  startSync(source)
  return c.json(publicSource(source), 201)
})

const sourceIn = async (siteId: string, id: string) =>
  z.uuid().safeParse(id).success
    ? db.query.revenueSources.findFirst({
        where: and(eq(revenueSources.id, id), eq(revenueSources.siteId, siteId)),
      })
    : undefined

/** Pulls new payments now instead of at the next scheduled sync. */
revenueRoutes.post('/:source/sync', async (c) => {
  const source = await sourceIn(c.get('site').id, c.req.param('source'))
  if (!source) return c.json({ error: 'not found' }, 404)
  startSync(source)
  return c.json(publicSource(source), 202)
})

/** Stops syncing a source. Payments already recorded stay on the dashboard. */
revenueRoutes.delete('/:source', async (c) => {
  const source = await sourceIn(c.get('site').id, c.req.param('source'))
  if (!source) return c.json({ error: 'not found' }, 404)
  await db.delete(revenueSources).where(eq(revenueSources.id, source.id))
  return c.json({ ok: true })
})
