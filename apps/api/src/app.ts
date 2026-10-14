import { readFile } from 'node:fs/promises'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { env } from './env'
import { accountRoutes } from './routes/account'
import { adminRoutes } from './routes/admin'
import { eventRoutes } from './routes/event'
import { orgRoutes } from './routes/orgs'
import { replayRoutes } from './routes/replay'
import { shareRoutes } from './routes/share'

export const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

// The tracker posts from any site, so the ingest endpoint is open to all origins.
app.use('/api/event', cors({ origin: '*', allowMethods: ['POST'] }))
app.use('/api/replay', cors({ origin: '*', allowMethods: ['POST'] }))
app.route('/', eventRoutes)
app.route('/', replayRoutes)
app.route('/', accountRoutes)
app.route('/', orgRoutes)
app.route('/', adminRoutes)
app.route('/', shareRoutes)

/** The tracker, and the recorder it loads for sampled sessions. */
for (const file of ['script.js', 'replay.js'])
  app.get(`/js/${file}`, async (c) => {
    const body = await readFile(`${env.TRACKER_DIST}/${file}`, 'utf8').catch(() => null)
    if (body === null) return c.text('tracker not built', 503)
    return c.body(body, 200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    })
  })

// The dashboard. Its file names are content-hashed, so they can be cached for good; every other
// path gets index.html and the app reads the view from the query string.
app.use(
  '/assets/*',
  serveStatic({
    root: env.WEB_DIST,
    onFound: (_, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable'),
  }),
)
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) return next()
  const html = await readFile(`${env.WEB_DIST}/index.html`, 'utf8').catch(() => null)
  if (html === null) return c.text('dashboard not built', 503)
  return c.html(html, 200, { 'Cache-Control': 'no-cache' })
})
