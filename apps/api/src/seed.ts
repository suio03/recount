import { eq } from 'drizzle-orm'
import { clickhouse } from './db/clickhouse'
import { db, sql } from './db/postgres'
import { orgs, readings, sites } from './db/schema'
import { type PaymentInput, recordPayments } from './revenue/record'

// Fills two demo sites with the same 60 days of synthetic traffic so the dashboard can be
// developed without real data. `demo` also sends the custom events a site would add by hand;
// `autocapture` has only what the script records by itself: pageviews and element clicks. Safe to
// rerun: it replaces the demo sites' events and touches no other site.

const DEMOS = [
  { domain: 'demo.recount.localhost', name: 'Demo', customEvents: true },
  { domain: 'autocapture.recount.localhost', name: 'Autocapture demo', customEvents: false },
]
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
// Revenue: a $49 featured listing bought after a submission, and a $19/month Pro plan.
const LISTING = 4900
const PRO = 1900
/** Chance a multi-page session starts Pro; AI assistant visitors browse more and buy less. */
const PRO_RATE: Record<string, number> = { 'Organic Search': 0.006, 'AI Assistant': 0.0015 }

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
  ['/pricing', 2],
  ['/playground', 3],
]

const TOOLS: Record<string, string> = {
  cursor: 'Cursor',
  runway: 'Runway',
  elevenlabs: 'ElevenLabs',
}

const SEARCH_CATEGORIES: Array<[string, number]> = [
  ['code', 5],
  ['writing', 3],
  ['video', 2],
  ['voice', 1],
]

interface Click {
  element_tag: string
  element_text: string
  element_section: string
  element_href: string
}

const link = (text: string, section: string, href: string): Click => ({
  element_tag: 'a',
  element_text: text,
  element_section: section,
  element_href: href,
})
const button = (text: string, section: string): Click => ({
  element_tag: 'button',
  element_text: text,
  element_section: section,
  element_href: '',
})

/** The link a visitor on `from` clicks to reach `to`, as the script records it. */
function linkTo(from: string, to: string, origin: string): Click {
  const href = `${origin}${to}`
  const tool = to.match(/^\/tools\/(.+)/)?.[1]
  if (tool) {
    const name = TOOLS[tool] ?? tool
    if (from === '/') return link(name, 'Popular tools', href)
    if (from.startsWith('/category/')) return link(name, 'Tools in this category', href)
    return link(name, 'Similar tools', href)
  }
  if (to.startsWith('/compare/')) return link('Cursor vs Windsurf', 'Compare', href)
  if (to === '/category/video') return link('Video', 'nav', href)
  if (to === '/category/writing') return link('Writing', 'nav', href)
  if (to === '/submit') return link('Submit a tool', 'header', href)
  if (to === '/pricing') return link('Pricing', 'header', href)
  if (to === '/playground') return link('Playground', 'nav', href)
  return link('AI Tools Directory', 'header', href)
}
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

async function seedSite(orgId: string, demo: (typeof DEMOS)[number]) {
  const { domain: DOMAIN, customEvents } = demo
  seed = 42
  await db
    .insert(sites)
    .values({ orgId, domain: DOMAIN, name: demo.name, ai: true })
    .onConflictDoNothing()
  const site = await db.query.sites.findFirst({ where: (s, { eq }) => eq(s.domain, DOMAIN) })
  if (!site) throw new Error('demo site missing')
  // Cached readings describe the old data.
  await db.delete(readings).where(eq(readings.siteId, site.id))
  for (const table of ['events', 'payments'])
    await clickhouse.command({
      query: `DELETE FROM ${table} WHERE site_id = {site:UUID}`,
      query_params: { site: site.id },
    })

  const rows: Array<Record<string, unknown>> = []
  const payments: PaymentInput[] = []
  const pay = (input: Omit<PaymentInput, 'provider' | 'paymentId'>) =>
    payments.push({ provider: 'demo', paymentId: `demo_${payments.length + 1}`, ...input })
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
      const origin = `https://${DOMAIN}`
      // Time moves on either way, so both demos get the same visits.
      const event = (name: string, pathname: string, props: Record<string, string> = {}) => {
        const timestamp = at()
        if (customEvents) rows.push({ ...session, timestamp, name, pathname, props })
      }
      const toolOf = (path: string) => path.match(/^\/tools\/(.+)/)?.[1]
      // A click on an element marked with data-rc-event carries that name instead of `click`.
      const click = (pathname: string, element: Click, name = 'click') =>
        rows.push({ ...session, timestamp: at(), name, pathname, ...element })
      const views = random() < 0.42 ? 1 : 1 + Math.floor(random() * 5)
      let pathname = ''
      for (let v = 0; v < views; v++) {
        const next = v === 0 && source.channel === 'AI Assistant' ? '/tools/cursor' : pick(PAGES)
        if (v > 0) click(pathname, linkTo(pathname, next, origin))
        pathname = next
        rows.push({ ...session, timestamp: at(), name: 'pageview', pathname })
        // Blind spots for tracking gaps: the playground is used for minutes with nothing tracked,
        // and a tool's bookmark button is an icon with no text or label.
        if (pathname === '/playground') t += 120_000 + random() * 480_000
        if (toolOf(pathname) && random() < 0.15) click(pathname, button('', 'Tool profile'))
        if (views > 1 && random() < 0.35) {
          // Where the opened tool sat in the list, top slots far more often.
          const position = String(1 + Math.floor(random() ** 2 * 12))
          const tool = toolOf(pathname)
          event('Tool Open', pathname, tool ? { tool, position } : { position })
        }
        if (views > 1 && random() < 0.15) {
          const results = String(Math.floor(random() ** 3 * 240))
          event('Search', pathname, { results, category: pick(SEARCH_CATEGORIES) })
        }
        if (random() < 0.03) click(pathname, link('Log in', 'header', `${origin}/login`))
      }
      if (views > 1 && random() < 0.45) {
        // The visitor leaves to the tool's own site.
        const tool = pathname.match(/^\/tools\/(.+)/)?.[1] ?? 'cursor'
        if (!pathname.startsWith('/tools/')) {
          click(pathname, linkTo(pathname, `/tools/${tool}`, origin))
          pathname = `/tools/${tool}`
          rows.push({ ...session, timestamp: at(), name: 'pageview', pathname })
        }
        click(
          pathname,
          link(`Visit ${TOOLS[tool] ?? tool}`, 'Tool profile', `https://${tool}.com/?ref=ordalin`),
        )
        event('Outbound Click', pathname, { tool })
      } else if (random() < 0.02)
        click(pathname, link('Follow us', 'footer', 'https://x.com/ordalin'))
      // The newsletter form shows its thanks in place, so nothing follows its button.
      else if (random() < 0.03) click(pathname, button('Subscribe', 'footer'))
      const ids = { visitorId: BigInt(session.visitor_id), sessionId: BigInt(session.session_id) }
      if (random() < 0.01) {
        if (pathname !== '/submit') {
          click(pathname, linkTo(pathname, '/submit', origin))
          rows.push({ ...session, timestamp: at(), name: 'pageview', pathname: '/submit' })
        }
        click('/submit', button('Submit tool', 'Submit form'))
        rows.push({ ...session, timestamp: at(), name: 'pageview', pathname: '/submit/thanks' })
        event('Submission Sent', '/submit/thanks', {
          plan: random() < 0.3 ? 'featured' : 'free',
        })
        if (random() < 0.6) {
          const customerId = `cus_${id()}`
          at()
          pay({ ...ids, customerId, kind: 'new', amount: LISTING, timestamp: new Date(t) })
          if (random() < 0.05) {
            const refundAt = new Date(t + 3 * 86_400_000)
            if (refundAt.getTime() < Date.now())
              pay({ customerId, kind: 'refund', amount: -LISTING, timestamp: refundAt })
          }
        }
      }
      if (views > 1 && random() < (PRO_RATE[source.channel] ?? 0.004)) {
        if (pathname !== '/pricing') {
          click(pathname, linkTo(pathname, '/pricing', origin))
          rows.push({ ...session, timestamp: at(), name: 'pageview', pathname: '/pricing' })
        }
        click('/pricing', button('Choose Pro', 'Pricing'), customEvents ? 'Choose Pro' : 'click')
        const customerId = `cus_${id()}`
        at()
        pay({ ...ids, customerId, kind: 'new', amount: PRO, timestamp: new Date(t) })
        // Monthly renewals carry no tracker ids; they inherit the first payment's session.
        for (let r = t + 30 * 86_400_000; r < Date.now(); r += 30 * 86_400_000)
          if (random() < 0.85)
            pay({ customerId, kind: 'renewal', amount: PRO, timestamp: new Date(r) })
          else break
      }
    }
  }
  await clickhouse.insert({ table: 'events', values: rows, format: 'JSONEachRow' })
  await recordPayments(site, payments)
  console.log(
    `seeded ${rows.length} events and ${payments.length} payments for ${DOMAIN} (${site.id})`,
  )
}

async function main() {
  // The first org, or a new one that the first account takes over at setup.
  const org =
    (await db.query.orgs.findFirst({ orderBy: (o, { asc }) => asc(o.createdAt) })) ??
    (await db.insert(orgs).values({ name: 'My sites' }).returning())[0]
  if (!org) throw new Error('no org for the demo sites')
  for (const demo of DEMOS) await seedSite(org.id, demo)
  await sql.end()
  await clickhouse.close()
}

await main()
