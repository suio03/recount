import { serve } from '@hono/node-server'
import { app } from './app'
import { env } from './env'
import { pruneSalts } from './ingest/identity'
import { syncAll } from './revenue/sync'

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`recount api listening on http://localhost:${info.port}`)
})

// Hourly is enough: salts only need to disappear within a day of expiring.
setInterval(() => pruneSalts().catch((e) => console.error('pruneSalts', e)), 3600_000).unref()

// Payments are pulled from the providers' APIs rather than pushed by webhooks, so a self-hosted
// install needs no public endpoint for them.
const syncRevenue = () => syncAll().catch((e) => console.error('revenue sync', e))
setTimeout(syncRevenue, 10_000).unref()
setInterval(syncRevenue, 15 * 60_000).unref()
