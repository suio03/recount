import { clickhouse } from './db/clickhouse'
import { db, sql } from './db/postgres'
import { sites } from './db/schema'

// Fills a demo site with 60 days of synthetic traffic so the dashboard can be developed without
// real data. Safe to rerun: it replaces the demo site's events and touches no other site.

const DOMAIN = 'demo.recount.localhost'
const DAYS = 60

// mulberry32: a small deterministic generator, so reruns produce the same demo data.
let seed = 42
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
}
const pick = <T>(weighted: Array<[T, number]>): T => {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let r = random() * total
  for (const [value, w] of weighted) {
    r -= w
    if (r <= 0) return value
  }
  return (weighted.at(-1) as [T, number])[0]
}
const id = () => Math.floor(random() * 2 ** 32) * 2 ** 20 + Math.floor(random() * 2 ** 20)

const SOURCES: Array<[{ referrer: string; channel: string; campaign?: string }, number]> = [
  [{ referrer: 'google.com', channel: 'Organic Search' }, 40],
  [{ referrer: 'bing.com', channel: 'Organic Search' }, 3],
  [{ referrer: 'chatgpt.com', channel: 'AI Assistant' }, 16],
  [{ referrer: 'perplexity.ai', channel: 'AI Assistant' }, 4],
  [{ referrer: '', channel: 'Direct' }, 18],
  [{ referrer: 'news.ycombinator.com', channel: 'Organic Social' }, 3],
  [{ referrer: 'x.com', channel: 'Organic Social' }, 2],
  [{ referrer: 'futurepedia.io', channel: 'Referral' }, 6],
  [{ referrer: '', channel: 'Email', campaign: 'newsletter-oct' }, 1],
]
const PAGES: Array<[string, number]> = [
  ['/', 34],
  ['/tools/cursor', 14],
  ['/compare/cursor-vs-windsurf', 7],
  ['/category/video', 6],
  ['/tools/runway', 5],
  ['/tools/elevenlabs', 4],
  ['/category/writing', 4],
  ['/submit', 2],
]
const COUNTRIES: Array<[string, number]> = [
  ['US', 32],
  ['IN', 13],
  ['DE', 9],
  ['GB', 7],
  ['BR', 5],
  ['JP', 4],
  ['FR', 4],
  ['CA', 3],
]
const DEVICES: Array<[[string, string, string], number]> = [
  [['Desktop', 'Chrome', 'Mac OS'], 34],
  [['Desktop', 'Chrome', 'Windows'], 22],
  [['Desktop', 'Safari', 'Mac OS'], 8],
  [['Mobile', 'Mobile Safari', 'iOS'], 20],
  [['Mobile', 'Chrome', 'Android'], 13],
  [['Tablet', 'Mobile Safari', 'iOS'], 3],
]

async function main() {
  await db.insert(sites).values({ domain: DOMAIN, name: 'Demo' }).onConflictDoNothing()
  const site = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.domain, DOMAIN) })
  if (!site) throw new Error('demo site missing')
  await clickhouse.command({
    query: 'DELETE FROM events WHERE site_id = {site:UUID}',
    query_params: { site: site.id },
  })

  const rows: Array<Record<string, unknown>> = []
  const today = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  )
  for (let d = DAYS - 1; d >= 0; d--) {
    const dayStart = today - d * 86_400_000
    const weekday = new Date(dayStart).getUTCDay()
    // A step up 10 days ago, mostly from AI assistants, so change figures have something to show.
    const boost = d < 10 ? 1.5 : 1
    const sessions = Math.round(
      (weekday === 0 || weekday === 6 ? 220 : 310) * boost * (0.85 + random() * 0.3),
    )
    for (let s = 0; s < sessions; s++) {
      const source = d < 10 && random() < 0.3 ? SOURCES[2]![0] : pick(SOURCES)
      const [device, browser, os] = pick(DEVICES)
      const session = {
        site_id: site.id,
        identity_mode: 'cookie',
        visitor_id: id(),
        session_id: id(),
        hostname: DOMAIN,
        referrer_source: source.referrer,
        referrer: source.referrer ? `https://${source.referrer}/` : '',
        channel: source.channel,
        utm_campaign: source.campaign ?? '',
        country_code: pick(COUNTRIES),
        device,
        browser,
        os,
      }
      let t = dayStart + random() * 86_000_000
      const at = () => new Date((t += 5_000 + random() * 60_000)).toISOString().replace('Z', '')
      const views = random() < 0.42 ? 1 : 1 + Math.floor(random() * 5)
      for (let v = 0; v < views; v++) {
        const pathname =
          v === 0 && source.channel === 'AI Assistant' ? '/tools/cursor' : pick(PAGES)
        rows.push({ ...session, timestamp: at(), name: 'pageview', pathname })
        if (views > 1 && random() < 0.35)
          rows.push({ ...session, timestamp: at(), name: 'Tool Open', pathname })
        if (views > 1 && random() < 0.15)
          rows.push({ ...session, timestamp: at(), name: 'Search', pathname })
      }
      if (views > 1 && random() < 0.45) {
        rows.push({
          ...session,
          timestamp: at(),
          name: 'Outbound Click',
          pathname: '/tools/cursor',
        })
      }
      if (random() < 0.01) {
        rows.push({ ...session, timestamp: at(), name: 'Submission Sent', pathname: '/submit' })
      }
    }
  }
  await clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' })
  console.log(`seeded ${rows.length} events for ${DOMAIN} (${site.id})`)
  await sql.end()
  await clickhouse.close()
}

await main()
