import { serve } from '@hono/node-server'
import { app } from './app'
import { env } from './env'
import { pruneSalts } from './ingest/identity'

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`recount api listening on http://localhost:${info.port}`)
})

// Hourly is enough: salts only need to disappear within a day of expiring.
setInterval(() => pruneSalts().catch((e) => console.error('pruneSalts', e)), 3600_000).unref()
