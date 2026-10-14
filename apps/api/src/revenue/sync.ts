import { eq } from 'drizzle-orm'
import { db } from '../db/postgres'
import { type RevenueSource, revenueSources, sites } from '../db/schema'
import { hash64 } from '../ingest/identity'
import { unseal } from '../secrets'
import { rows } from '../stats/queries'
import { fetchPaddle, toPayments } from './paddle'
import { recordPayments } from './record'

/** Reread this much before the last sync, so records updated while it ran are not missed. */
const OVERLAP_MS = 60 * 60_000

async function knownPayments(siteId: string, provider: string) {
  const found = await rows<{ payment_id: string }>(
    `SELECT DISTINCT payment_id FROM payments FINAL
     WHERE site_id = {site:UUID} AND provider = {provider:String} AND kind != 'refund'`,
    { site: siteId, provider },
  )
  return new Set(found.map((r) => r.payment_id))
}

/** The provider key: sealed in the row when connected in the dashboard, else in the environment. */
function keyOf(source: RevenueSource) {
  if (source.keyCipher) return unseal(source.keyCipher)
  const key = source.keyEnv && process.env[source.keyEnv]
  if (!key) throw new Error(`${source.keyEnv} is not set`)
  return key
}

/** Pulls one source's new payments and records them. Returns how many were recorded. */
export async function syncSource(source: RevenueSource) {
  const startedAt = new Date()
  try {
    const site = await db.query.sites.findFirst({ where: eq(sites.id, source.siteId) })
    if (!site) throw new Error('site not found')
    const key = keyOf(source)
    if (source.provider !== 'paddle') throw new Error(`${source.provider} is not supported yet`)

    const since = source.syncedAt && new Date(source.syncedAt.getTime() - OVERLAP_MS)
    const { transactions, adjustments } = await fetchPaddle(key, since ?? undefined)
    const { payments, skipped } = toPayments(transactions, adjustments, {
      match: source.match,
      currency: site.currency,
      known: await knownPayments(site.id, 'paddle'),
    })
    await recordPayments(
      site,
      payments.map(({ vid, sid, ...p }) => ({
        ...p,
        visitorId: vid ? hash64(site.id, vid) : undefined,
        sessionId: sid ? hash64(site.id, sid) : undefined,
      })),
    )
    await db
      .update(revenueSources)
      .set({ syncedAt: startedAt, lastError: skipped.length ? skipped.join('\n') : null })
      .where(eq(revenueSources.id, source.id))
    return { recorded: payments.length, skipped }
  } catch (e) {
    await db
      .update(revenueSources)
      .set({ lastError: String(e) })
      .where(eq(revenueSources.id, source.id))
    throw e
  }
}

/** Syncs every source; one failing source does not stop the others. */
export async function syncAll() {
  for (const source of await db.select().from(revenueSources)) {
    try {
      await syncSource(source)
    } catch (e) {
      console.error(`revenue sync ${source.provider} for site ${source.siteId}:`, e)
    }
  }
}
