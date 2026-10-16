import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/postgres'
import { type KeyEvents, revenueSources, type Site } from '../db/schema'
import { bucketSql } from './buckets'
import { inRange, payments, rows, type Scope, sessions } from './queries'
import { type DateRange, intervalOf, previousRange } from './range'

/**
 * Who tried to pay: visitors who sent an event meaning they started paying, paid, failed to pay
 * or gave up, with the events that led there. Which events mean what is set per site, or
 * guessed from the event names until someone corrects it.
 */

const Names = z.array(z.string().trim().min(1).max(120)).max(30)
export const KeyEventsInput = z.object({
  activation: Names,
  start: Names,
  paid: Names,
  failed: Names,
  closed: Names,
})

export type Role = keyof KeyEvents | 'interest'

/** An event name's words: `checkoutFailed`, `checkout_failed` and `Checkout failed` alike. */
const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const PAY = new Set([
  'checkout',
  'purchase',
  'purchased',
  'subscribe',
  'subscribed',
  'subscription',
  'payment',
  'pay',
  'paid',
  'billing',
  'invoice',
  'paddle',
  'stripe',
  'lemonsqueezy',
  'creem',
])
const SUCCESS = new Set([
  'success',
  'succeeded',
  'successful',
  'completed',
  'complete',
  'paid',
  'confirmed',
])
const FAULT = new Set([
  'fail',
  'failed',
  'failure',
  'error',
  'errored',
  'declined',
  'denied',
  'rejected',
])
const GAVE_UP = new Set([
  'close',
  'closed',
  'cancel',
  'cancelled',
  'canceled',
  'abandon',
  'abandoned',
  'dismiss',
  'dismissed',
  'exit',
])
const INTEREST = new Set(['upgrade', 'pricing', 'paywall', 'premium'])
/** Payment words that alone also name browsing plans, so `pricing_billing_cycle_view` is interest. */
const WEAK_PAY = new Set(['billing', 'invoice'])
const SIGN_IN = ['signin', 'signup', 'login', 'register', 'registered', 'registration']

/** Whether a name reads as something going wrong, payment or not. */
export const isFault = (name: string) => words(name).some((w) => FAULT.has(w))

/** What a name means when nobody has said: a guess from its words. */
export function guessRole(name: string): Role | undefined {
  const w = words(name)
  const joined = w.join('')
  const browsing = w.some((x) => INTEREST.has(x)) && w.every((x) => !PAY.has(x) || WEAK_PAY.has(x))
  if (!browsing && w.some((x) => PAY.has(x))) {
    if (w.some((x) => FAULT.has(x))) return 'failed'
    if (w.some((x) => GAVE_UP.has(x))) return 'closed'
    if (
      w.some((x) => SUCCESS.has(x)) ||
      ['purchase', 'purchased', 'paid', 'subscribed'].includes(joined)
    )
      return 'paid'
    return 'start'
  }
  if (SIGN_IN.some((s) => joined.includes(s)) && !w.some((x) => FAULT.has(x) || GAVE_UP.has(x)))
    return 'activation'
  if (w.some((x) => INTEREST.has(x))) return 'interest'
  return undefined
}

/**
 * Key events guessed from a site's event names. Of the sign-in events, the ones marking success
 * win over attempts, so `signin_success` counts and `signin_start` does not.
 */
export function guessKeyEvents(names: string[]): KeyEvents {
  const out: KeyEvents = { activation: [], start: [], paid: [], failed: [], closed: [] }
  for (const name of names) {
    const role = guessRole(name)
    if (role && role !== 'interest') out[role].push(name)
  }
  const succeeded = out.activation.filter((n) => words(n).some((w) => SUCCESS.has(w)))
  if (succeeded.length) out.activation = succeeded
  return out
}

/** Custom events seen this recently are guessed from. */
const GUESS_DAYS = 90

/** The custom events the site sent in the last 90 days, by name. */
export async function eventNamesOf(site: Pick<Site, 'id'>): Promise<string[]> {
  const names = await rows<{ name: string }>(
    `SELECT DISTINCT name FROM events
     WHERE site_id = {site:UUID} AND timestamp >= now() - INTERVAL {days:UInt32} DAY
       AND name NOT IN ('pageview', 'click')
     ORDER BY name`,
    { site: site.id, days: GUESS_DAYS },
  )
  return names.map((r) => r.name)
}

/** The site's key events, and whether they were guessed rather than set. */
export async function keyEventsOf(
  site: Site,
  names?: string[],
): Promise<{ events: KeyEvents; guessed: boolean }> {
  if (site.keyEvents) return { events: site.keyEvents, guessed: false }
  return { events: guessKeyEvents(names ?? (await eventNamesOf(site))), guessed: true }
}

export type Ending = 'paid' | 'failed' | 'closed' | 'none'

/**
 * How a visitor's try ended: paid if they paid at all, failed if any payment failed even when
 * they tried again, otherwise what their last payment event says, and `none` when it was a
 * start with nothing after.
 */
export function endingOf(roles: Array<Role | undefined>, paid: boolean): Ending {
  if (paid || roles.includes('paid')) return 'paid'
  if (roles.includes('failed')) return 'failed'
  const last = roles.filter((r) => r === 'start' || r === 'failed' || r === 'closed').at(-1)
  return last === 'failed' || last === 'closed' ? last : 'none'
}

/** People listed, newest try first. */
const MAX_PEOPLE = 20
/** Events kept per person, the latest. */
const MAX_TRAIL = 60

export interface TrailEvent {
  name: string
  /** Unix milliseconds of the first of `n` in a row. */
  at: number
  n: number
  role?: Role
  fault: boolean
}

export interface Person {
  visitor: string
  /** Unix milliseconds of their last payment event. */
  last: number
  channel: string
  referrer: string
  entry: string
  country: string
  device: string
  browser: string
  visits: number
  pageviews: number
  /** Minor units paid in range, when a payment provider is connected. */
  amount: number
  ending: Ending
  trail: TrailEvent[]
}

const roleOf = (events: KeyEvents, name: string): Role | undefined => {
  for (const role of ['paid', 'failed', 'closed', 'start', 'activation'] as const)
    if (events[role].includes(name)) return role
  return guessRole(name) === 'interest' ? 'interest' : undefined
}

/** Consecutive repeats of one event become one entry with a count. */
export function compress(names: string[], times: number[], events: KeyEvents): TrailEvent[] {
  const out: TrailEvent[] = []
  names.forEach((name, i) => {
    const prev = out.at(-1)
    if (prev?.name === name) prev.n++
    else
      out.push({ name, at: times[i] ?? 0, n: 1, role: roleOf(events, name), fault: isFault(name) })
  })
  return out
}

/** SQL and parameters for the events of sessions in scope that are one of `names`. */
function eventsIn(scope: Scope, range: DateRange) {
  const s = sessions(scope, range)
  return {
    where: `${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))`,
    params: s.params,
  }
}

/** Visitors attributed a payment in range, with what they paid, under the active filters. */
async function payersOf(scope: Scope, range: DateRange) {
  const p = payments(scope, range)
  return rows<{ visitor: string; amount: number; payments: number }>(
    `SELECT toString(visitor_id) AS visitor, sum(amount) AS amount, countIf(kind != 'refund') AS payments
     FROM (${p.sql}) WHERE visitor_id != 0 GROUP BY visitor_id`,
    p.params,
  )
}

/** Whether a payment provider is connected, so payments count from it rather than events. */
export async function hasProvider(site: Pick<Site, 'id'>) {
  const sources = await db
    .select({ id: revenueSources.id })
    .from(revenueSources)
    .where(eq(revenueSources.siteId, site.id))
  return sources.length > 0
}

/** Visitors who tried to pay and paid in the range and the one before, as the dashboard counts. */
export async function triesOf(scope: Scope) {
  const [{ events }, provider] = await Promise.all([
    keyEventsOf(scope.site),
    hasProvider(scope.site),
  ])
  const known =
    events.start.length + events.failed.length + events.closed.length + events.paid.length
  if (!known) return null
  const [now, before] = await Promise.all([
    countsOf(scope, scope.range, events, provider),
    countsOf(scope, previousRange(scope.range), events, provider),
  ])
  return { now, before }
}

/** How many visitors activated, tried to pay and paid in a range. */
async function countsOf(scope: Scope, range: DateRange, events: KeyEvents, provider: boolean) {
  const e = eventsIn(scope, range)
  const tries = [...events.start, ...events.failed, ...events.closed, ...events.paid]
  const payers = provider ? await payersOf(scope, range) : []
  const p = payments(scope, range)
  const [counts, paid] = await Promise.all([
    rows<{ activated: number; tried: number; paid: number }>(
      `SELECT uniqExactIf(visitor_id, name IN {activation:Array(String)}) AS activated,
              uniqExactIf(visitor_id, name IN {tries:Array(String)} OR toString(visitor_id) IN {payers:Array(String)}) AS tried,
              uniqExactIf(visitor_id, name IN {paid:Array(String)}) AS paid
       FROM events WHERE ${e.where}`,
      {
        ...e.params,
        activation: events.activation,
        tries,
        paid: events.paid,
        payers: payers.map((r) => r.visitor),
      },
    ).then((r) => r[0]),
    provider
      ? rows<{ payments: number }>(
          `SELECT countIf(kind != 'refund') AS payments FROM (${p.sql})`,
          p.params,
        ).then((r) => Number(r[0]?.payments ?? 0))
      : undefined,
  ])
  return {
    activated: Number(counts?.activated ?? 0),
    tried: Number(counts?.tried ?? 0),
    // With a provider, payments are counted where they happened, not from events.
    paid: paid ?? Number(counts?.paid ?? 0),
  }
}

/**
 * Activation and payment figures for the range and the one before, buckets holding a try, and
 * the people who tried, newest first, each with their events in order and how it ended.
 */
export async function intentOf(scope: Scope) {
  const { site, range } = scope
  const [{ events, guessed }, provider] = await Promise.all([keyEventsOf(site), hasProvider(site)])
  const tries = [...events.start, ...events.failed, ...events.closed, ...events.paid]
  const e = eventsIn(scope, range)
  const payers = provider ? await payersOf(scope, range) : []
  const paidBy = new Map(payers.map((r) => [r.visitor, Number(r.amount)]))
  const tried = `(name IN {tries:Array(String)} OR toString(visitor_id) IN {payers:Array(String)})`
  const params = { ...e.params, tries, payers: [...paidBy.keys()] }

  const [totals, previous, buckets, found] = await Promise.all([
    countsOf(scope, range, events, provider),
    countsOf(scope, previousRange(range), events, provider),
    rows<{ t: string; tried: number }>(
      `SELECT ${bucketSql(intervalOf(range), 'timestamp')} AS t, uniqExact(visitor_id) AS tried
       FROM events WHERE ${e.where} AND ${tried} GROUP BY t ORDER BY t`,
      params,
    ),
    rows<{ visitor: string; last: number }>(
      `SELECT toString(visitor_id) AS visitor, toUnixTimestamp64Milli(max(timestamp)) AS last
       FROM events WHERE ${e.where} AND ${tried}
       GROUP BY visitor_id ORDER BY last DESC LIMIT {limit:UInt32}`,
      { ...params, limit: MAX_PEOPLE },
    ),
  ])

  const visitors = found.map((r) => r.visitor)
  const s = sessions(scope, range)
  const [trails, about] = visitors.length
    ? await Promise.all([
        rows<{ visitor: string; names: string[]; times: number[] }>(
          `SELECT toString(visitor_id) AS visitor,
                  arraySlice(arraySort(x -> x.1, groupArray((timestamp, name))), -{max:UInt32}) AS sorted,
                  arrayMap(x -> x.2, sorted) AS names,
                  arrayMap(x -> toUnixTimestamp64Milli(x.1), sorted) AS times
           FROM events
           WHERE ${inRange} AND toString(visitor_id) IN {visitors:Array(String)}
             AND name NOT IN ('pageview', 'click')
           GROUP BY visitor_id`,
          { ...s.params, visitors, max: MAX_TRAIL },
        ),
        rows<Omit<Person, 'last' | 'amount' | 'ending' | 'trail'>>(
          `SELECT toString(visitor_id) AS visitor,
                  argMin(channel, started) AS channel, argMin(referrer, started) AS referrer,
                  argMin(entry, started) AS entry, argMin(country, started) AS country,
                  argMin(device, started) AS device, argMin(browser, started) AS browser,
                  count() AS visits, sum(session_pageviews) AS pageviews
           FROM (${s.sql}) WHERE toString(visitor_id) IN {visitors:Array(String)}
           GROUP BY visitor_id`,
          { ...s.params, visitors },
        ),
      ])
    : [[], []]
  const trailOf = new Map(trails.map((t) => [t.visitor, t]))
  const aboutOf = new Map(about.map((a) => [a.visitor, a]))

  const people: Person[] = found.map(({ visitor, last }) => {
    const t = trailOf.get(visitor)
    const trail = t ? compress(t.names, t.times.map(Number), events) : []
    const amount = paidBy.get(visitor) ?? 0
    const a = aboutOf.get(visitor)
    return {
      visitor,
      last: Number(last),
      channel: a?.channel ?? '',
      referrer: a?.referrer ?? '',
      entry: a?.entry ?? '',
      country: a?.country ?? '',
      device: a?.device ?? '',
      browser: a?.browser ?? '',
      visits: Number(a?.visits ?? 0),
      pageviews: Number(a?.pageviews ?? 0),
      amount,
      ending: endingOf(
        trail.map((x) => x.role),
        paidBy.has(visitor),
      ),
      trail,
    }
  })

  return {
    events,
    guessed,
    provider,
    currency: site.currency,
    totals,
    previous,
    series: buckets.map((b) => ({ t: b.t, tried: Number(b.tried) })),
    people,
  }
}
