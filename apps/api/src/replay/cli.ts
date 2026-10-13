import { eq } from 'drizzle-orm'
import { clickhouse } from '../db/clickhouse'
import { db, sql } from '../db/postgres'
import { sites } from '../db/schema'
import { rows } from '../stats/queries'
import { renderTimeline } from './render'
import { extractEnded, extractSession } from './sessions'
import { summarizeSession, summarizeSite } from './summarize'

/**
 *   pnpm replay extract [domain]        Extracts every ended session not extracted yet.
 *   pnpm replay show <domain> [session]  Extracts a session now (the latest recorded one by
 *                                        default) and prints its timeline.
 *   pnpm replay summarize <domain> [session]
 *                                        Summarizes the site's notable sessions not summarized
 *                                        yet, or one session now, notable or not.
 */

async function siteByDomain(domain: string) {
  const site = await db.query.sites.findFirst({ where: eq(sites.domain, domain) })
  if (!site) throw new Error(`no site ${domain}`)
  return site
}

async function main() {
  const [command, domain, session] = process.argv.slice(2)
  if (command === 'extract') {
    const site = domain ? await siteByDomain(domain) : undefined
    console.log(`${await extractEnded(site?.id)} sessions extracted`)
  } else if (command === 'show' && domain) {
    const site = await siteByDomain(domain)
    const sessionId =
      session ??
      (
        await rows<{ id: string }>(
          `SELECT toString(session_id) AS id FROM replay_chunks
           WHERE site_id = {site:UUID} ORDER BY received_at DESC LIMIT 1`,
          { site: site.id },
        )
      )[0]?.id
    if (!sessionId) throw new Error('no recordings')
    const result = await extractSession(site.id, sessionId)
    if (!result) throw new Error(`session ${sessionId} has no usable recording`)
    console.log(`session ${sessionId}  ${JSON.stringify(result.counts)}\n`)
    console.log(renderTimeline(result.timeline))
  } else if (command === 'summarize' && domain) {
    const site = await siteByDomain(domain)
    if (!session) {
      console.log(`${await summarizeSite(site)} sessions summarized`)
      return
    }
    const { reasons, summary, timeline } = await summarizeSession(site, session)
    console.log(`session ${session}  flagged: ${reasons.join(', ') || 'nothing'}\n`)
    console.log(renderTimeline(timeline))
    console.log(`\n${JSON.stringify(summary, null, 2)}`)
  } else {
    throw new Error(
      'commands: extract [domain], show <domain> [session], summarize <domain> [session]',
    )
  }
}

try {
  await main()
} finally {
  await sql.end()
  await clickhouse.close()
}
