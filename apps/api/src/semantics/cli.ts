import { eq } from 'drizzle-orm'
import { clickhouse } from '../db/clickhouse'
import { db, sql } from '../db/postgres'
import { sites } from '../db/schema'
import { describeItem, inventoryOf } from './inventory'
import { describeSignal } from './signals'
import { last30Days, runDraft } from './store'

/**
 *   pnpm semantics inventory <domain>  Prints what the last 30 days of the site's data hold.
 *   pnpm semantics draft <domain>      Has the model draft the site's conversions, funnels and
 *                                      tracking gaps from that, checked against the data, and
 *                                      stores the draft as the dashboard's latest.
 */

async function main() {
  const [command, domain] = process.argv.slice(2)
  if ((command !== 'inventory' && command !== 'draft') || !domain)
    throw new Error('commands: inventory <domain>, draft <domain>')
  const site = await db.query.sites.findFirst({ where: eq(sites.domain, domain) })
  if (!site) throw new Error(`no site ${domain}`)
  if (command === 'inventory') {
    const inventory = await inventoryOf(site, last30Days(site.timezone))
    console.log(`${inventory.visitors} visitors, ${inventory.sessions} sessions`)
    for (const item of inventory.items) console.log(describeItem(item))
    for (const signal of inventory.signals) console.log(describeSignal(signal))
    return
  }
  const { body: draft, error } = await runDraft(site)
  if (!draft) throw new Error(error ?? 'no draft')
  console.log(`About: ${draft.about}\n`)
  console.log('Conversions:')
  for (const c of draft.conversions)
    console.log(
      `  ${c.primary ? '*' : '-'} ${c.name}: ${c.visitors} visitors  ${JSON.stringify(c.match)}\n      ${c.why} [${c.evidence.join(', ')}]`,
    )
  console.log('\nFunnels:')
  for (const f of draft.funnels) {
    console.log(`  ${f.name}: ${f.why} [${f.evidence.join(', ')}]`)
    for (const s of f.steps)
      console.log(`      ${String(s.visitors).padStart(6)}  ${s.name}  ${JSON.stringify(s.match)}`)
  }
  console.log('\nTracking gaps:')
  for (const g of draft.gaps)
    console.log(`  - ${g.title} [${g.signal ?? 'guess'}]: ${g.why}\n      ${g.code}`)
  if (draft.dropped.length) console.log(`\nDropped:\n  ${draft.dropped.join('\n  ')}`)
}

try {
  await main()
} finally {
  await sql.end()
  await clickhouse.close()
}
