import { eq } from 'drizzle-orm'
import { clickhouse } from '../db/clickhouse'
import { db, sql } from '../db/postgres'
import { revenueSources, sites } from '../db/schema'
import { syncSource } from './sync'

/**
 *   pnpm revenue connect <domain> paddle <KEY_ENV> [key=value ...]
 *       Takes the site's payments from the Paddle account whose key is in $KEY_ENV, keeping only
 *       transactions whose custom data has every key=value given (e.g. project=scribix).
 *   pnpm revenue sync [domain]
 *   pnpm revenue list
 */

async function siteByDomain(domain: string) {
  const site = await db.query.sites.findFirst({ where: eq(sites.domain, domain) })
  if (!site) throw new Error(`no site ${domain}`)
  return site
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'connect') {
    const [domain, provider, keyEnv, ...pairs] = args
    if (!domain || provider !== 'paddle' || !keyEnv)
      throw new Error('usage: connect <domain> paddle <KEY_ENV> [key=value ...]')
    const match = Object.fromEntries(
      pairs.map((p) => {
        const at = p.indexOf('=')
        if (at < 1) throw new Error(`expected key=value, got ${p}`)
        return [p.slice(0, at), p.slice(at + 1)]
      }),
    )
    const site = await siteByDomain(domain)
    await db
      .insert(revenueSources)
      .values({ siteId: site.id, provider, keyEnv, match })
      .onConflictDoUpdate({
        target: [revenueSources.siteId, revenueSources.provider, revenueSources.keyEnv],
        set: { match, syncedAt: null },
      })
    console.log(`${domain}: paddle via ${keyEnv}, matching ${JSON.stringify(match)}`)
  } else if (command === 'sync') {
    const site = args[0] ? await siteByDomain(args[0]) : undefined
    const sources = await db
      .select()
      .from(revenueSources)
      .where(site ? eq(revenueSources.siteId, site.id) : undefined)
    for (const source of sources) {
      const { recorded, skipped } = await syncSource(source)
      console.log(`${source.provider} for ${source.siteId}: ${recorded} recorded`)
      for (const s of skipped) console.log(`  skipped ${s}`)
    }
  } else if (command === 'list') {
    const found = await db
      .select({ domain: sites.domain, source: revenueSources })
      .from(revenueSources)
      .innerJoin(sites, eq(sites.id, revenueSources.siteId))
    for (const { domain, source: s } of found)
      console.log(
        `${domain}  ${s.provider}  ${s.keyEnv}  ${JSON.stringify(s.match)}  synced ${s.syncedAt?.toISOString() ?? 'never'}${s.lastError ? `  error: ${s.lastError}` : ''}`,
      )
  } else {
    throw new Error('commands: connect, sync, list')
  }
}

try {
  await main()
} finally {
  await sql.end()
  await clickhouse.close()
}
