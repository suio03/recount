import { gunzipSync } from 'node:zlib'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { isbot } from 'isbot'
import { z } from 'zod'
import { clickhouse } from '../db/clickhouse'
import { hash64 } from '../ingest/identity'
import { siteByDomain } from '../sites'

export const replayRoutes = new Hono()

/** Gzipped batches above this are dropped; the recorder flushes every few seconds. */
const MAX_BODY = 1_000_000
const MAX_JSON = 20_000_000

const Params = z.object({
  s: z.string().min(1).max(253),
  vid: z.string().min(8).max(64),
  sid: z.string().min(8).max(64),
  load: z.string().min(8).max(64),
  seq: z.coerce.number().int().min(0).max(100_000),
})

const RrwebEvent = z.object({ type: z.number(), timestamp: z.number() }).loose()

const chTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').replace('Z', '')

/** The body is gzip, or plain JSON for the last batch of a page (see the recorder). */
function decode(body: Buffer): unknown {
  const gzipped = body[0] === 0x1f && body[1] === 0x8b
  const text = (gzipped ? gunzipSync(body, { maxOutputLength: MAX_JSON }) : body).toString('utf8')
  return JSON.parse(text)
}

// Enforced while the body streams in, before any of it is buffered whole.
replayRoutes.post(
  '/api/replay',
  bodyLimit({ maxSize: MAX_BODY, onError: (c) => c.json({ error: 'too large' }, 413) }),
  async (c) => {
    const accepted = () => c.body(null, 202)
    const params = Params.safeParse(c.req.query())
    if (!params.success) return c.json({ error: 'invalid parameters' }, 400)

    const userAgent = c.req.header('user-agent') ?? ''
    if (!userAgent || isbot(userAgent)) return accepted()
    const site = await siteByDomain(params.data.s)
    if (!site) return accepted()

    const body = Buffer.from(await c.req.arrayBuffer())
    let events: z.infer<typeof RrwebEvent>[]
    try {
      const parsed = z.array(RrwebEvent).min(1).safeParse(decode(body))
      if (!parsed.success) return c.json({ error: 'invalid events' }, 400)
      events = parsed.data
    } catch {
      return c.json({ error: 'invalid body' }, 400)
    }

    const times = events.map((e) => e.timestamp)
    const { vid, sid, load, seq } = params.data
    await clickhouse.insert({
      table: 'replay_chunks',
      format: 'JSONEachRow',
      values: [
        {
          site_id: site.id,
          // Hashed exactly like the tracker's events, so recordings join to sessions.
          session_id: hash64(site.id, sid).toString(),
          visitor_id: hash64(site.id, vid).toString(),
          load_id: load,
          seq,
          started_at: chTime(Math.min(...times)),
          ended_at: chTime(Math.max(...times)),
          events: events.length,
          data: JSON.stringify(events),
        },
      ],
    })
    return accepted()
  },
)
