import { serve } from '@hono/node-server'
import { app } from './app'
import { pruneSessions } from './auth'
import { env } from './env'
import { pruneSalts } from './ingest/identity'
import { extractEnded } from './replay/sessions'
import { summarizeAll } from './replay/summarize'
import { syncAll } from './revenue/sync'

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`recount api listening on http://localhost:${info.port}`)
})

// Hourly is enough: salts only need to disappear within a day of expiring, and expired sign-in
// sessions are already refused.
setInterval(() => {
  pruneSalts().catch((e) => console.error('pruneSalts', e))
  pruneSessions().catch((e) => console.error('pruneSessions', e))
}, 3600_000).unref()

// Payments are pulled from the providers' APIs rather than pushed by webhooks, so a self-hosted
// install needs no public endpoint for them.
const syncRevenue = () => syncAll().catch((e) => console.error('revenue sync', e))
setTimeout(syncRevenue, 10_000).unref()
setInterval(syncRevenue, 15 * 60_000).unref()

// Recordings become timelines once their session has ended.
// Timelines first, then summaries of the notable ones.
const extractReplays = () =>
  extractEnded()
    .catch((e) => console.error('replay extract', e))
    .then(() => summarizeAll())
    .catch((e) => console.error('replay summarize', e))
setTimeout(extractReplays, 20_000).unref()
setInterval(extractReplays, 5 * 60_000).unref()
