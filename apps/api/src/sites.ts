import { eq } from 'drizzle-orm'
import { db } from './db/postgres'
import { type Site, sites } from './db/schema'

const TTL_MS = 60_000
const cache = new Map<string, { site: Site | undefined; at: number }>()

const key = (domain: string) => domain.toLowerCase().replace(/^www\./, '')

/** Looks up a site by domain, caching hits and misses for a minute. */
export async function siteByDomain(domain: string): Promise<Site | undefined> {
  const k = key(domain)
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site
  const site = await db.query.sites.findFirst({ where: eq(sites.domain, k) })
  cache.set(k, { site, at: Date.now() })
  return site
}

/**
 * Drops a domain from the cache once its site is added or deleted, so a new site's first events
 * are not dropped for a minute and a deleted one's stop at once.
 */
export function forgetDomain(domain: string) {
  cache.delete(key(domain))
}
