import { readFile } from 'node:fs/promises'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env'
import { adminRoutes } from './routes/admin'
import { eventRoutes } from './routes/event'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

// The tracker posts from any site, so the ingest endpoint is open to all origins.
app.use('/api/event', cors({ origin: '*', allowMethods: ['POST'] }))
app.route('/', eventRoutes)
app.route('/', adminRoutes)

app.get('/js/script.js', async (c) => {
  const body = await readFile(`${env.TRACKER_DIST}/script.js`, 'utf8').catch(() => null)
  if (body === null) return c.text('tracker not built', 503)
  return c.body(body, 200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  })
})
