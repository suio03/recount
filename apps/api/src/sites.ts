import { eq } from 'drizzle-orm'
import { db } from './db/postgres'
import { type Site, sites } from './db/schema'

const TTL_MS = 60_000
const cache = new Map<string, { site: Site | undefined; at: number }>()

/** Looks up a site by domain, caching hits and misses for a minute. */
export async function siteByDomain(domain: string): Promise<Site | undefined> {
  const key = domain.toLowerCase().replace(/^www\./, '')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.site
  const site = await db.query.sites.findFirst({ where: eq(sites.domain, key) })
  cache.set(key, { site, at: Date.now() })
  return site
}
