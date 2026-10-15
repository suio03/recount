import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { keyFrom } from '../auth'
import { clickhouse } from '../db/clickhouse'
import { hash64 } from '../ingest/identity'
import { personalProperties } from '../ingest/personal'
import { siteByDomain } from '../sites'
import { BUILT_IN_EVENTS } from '../stats/goals'
import { rows } from '../stats/queries'
import { chTime } from './event'

/**
 * Events only a server sees, such as a signup confirmed or an order paid, sent with an API key
 * scoped to ingestion (or an admin key). The browser's ids, from `recount.ids()` passed along
 * with the form or checkout, join the event to the visitor and the session it belongs to, so it
 * counts as a goal of that visit like any custom event. Unlike the browser endpoint, a bad
 * request is answered with what is wrong, since the caller is code that can be fixed.
 */
export const serverEventRoutes = new Hono()

const MAX_PROPS = 30
/** A webhook retried for a few days still lands; anything older is a backfill, not an event. */
const MAX_AGE_MS = 7 * 86_400_000
const MAX_AHEAD_MS = 60_000

export const ServerEvent = z.object({
  /** The site's domain, as added in Recount. */
  site: z.string().trim().min(1).max(253),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((n) => !BUILT_IN_EVENTS.includes(n), 'pageview and click are sent by the tracker'),
  /** What `recount.ids()` returned in the visitor's browser. */
  ids: z.object(
    { recount_vid: z.uuid(), recount_sid: z.uuid().optional() },
    {
      error: 'ids: pass what recount.ids() returned in the browser (cookie mode only)',
    },
  ),
  props: z
    .record(z.string().min(1).max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
    .refine((p) => Object.keys(p).length <= MAX_PROPS, `at most ${MAX_PROPS} properties`)
    .optional(),
  /** When it happened, if not now. */
  timestamp: z.iso.datetime({ offset: true }).optional(),
})

serverEventRoutes.post(
  '/api/server/events',
  bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'too large' }, 413) }),
  async (c) => {
    const key = await keyFrom(c, ['ingest', 'admin'])
    if (key === 'missing' || key === 'wrong') return c.json({ error: 'unauthorized' }, 401)
    if (key === 'scope') return c.json({ error: 'use an ingest or admin key' }, 403)

    const parsed = ServerEvent.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
    const event = parsed.data

    const site = await siteByDomain(event.site)
    if (!site || site.orgId !== key.orgId) return c.json({ error: `no site ${event.site}` }, 404)

    const props = Object.fromEntries(
      Object.entries(event.props ?? {}).map(([k, v]) => [k, String(v)]),
    )
    const personal = personalProperties(props)
    if (personal.length)
      return c.json(
        {
          error: `Personal data is not accepted: ${personal.map((p) => p.reason).join('; ')}`,
          properties: personal.map((p) => p.key),
        },
        422,
      )

    const now = Date.now()
    const at = event.timestamp ? Date.parse(event.timestamp) : now
    if (at < now - MAX_AGE_MS || at > now + MAX_AHEAD_MS)
      return c.json({ error: 'timestamp must be within the last 7 days' }, 400)

    const visitorId = hash64(site.id, event.ids.recount_vid)
    const sessionId = event.ids.recount_sid
      ? hash64(site.id, event.ids.recount_sid)
      : await lastSession(site.id, visitorId)

    await clickhouse.insert({
      table: 'events',
      format: 'JSONEachRow',
      values: [
        {
          site_id: site.id,
          timestamp: chTime(new Date(at)),
          name: event.name,
          identity_mode: 'cookie',
          visitor_id: visitorId.toString(),
          session_id: sessionId.toString(),
          // Page, acquisition and device are the session's, read from its first event.
          country_code: '',
          props,
        },
      ],
    })
    return c.json({ ok: true }, 202)
  },
)

/** The visitor's latest session, when the server was not given one; a new one if none is known. */
async function lastSession(siteId: string, visitorId: bigint) {
  const [row] = await rows<{ session: string }>(
    `SELECT toString(session_id) AS session FROM events
     WHERE site_id = {site:UUID} AND visitor_id = {visitor:UInt64}
       AND timestamp >= now() - INTERVAL 30 DAY
     ORDER BY timestamp DESC LIMIT 1`,
    { site: siteId, visitor: visitorId.toString() },
  )
  return row ? BigInt(row.session) : hash64(siteId, visitorId.toString(), 'server')
}
