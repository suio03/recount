import type { Site } from '../db/schema'
import { rows } from './queries'
import type { DateRange } from './range'

/**
 * Events that went quiet: a custom event that fired almost every day and then stopped. A broken
 * tag and a broken feature look the same from here, so both show. Found by code alone, over the
 * whole site, whatever the filters.
 */

const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Days before the silence that show an event was steady. */
export const STEADY_DAYS = 14
/** Of those, the days it must have fired on. */
const ACTIVE_DAYS = 10
/** And how often, on average, a day. */
const PER_DAY = 2
/** Full days at zero before an event counts as quiet. */
const QUIET_DAYS = 2
/** Longer than this, it has been gone too long to be news. */
const MAX_QUIET_DAYS = 30
/** Days of history each quiet event shows. */
const SHOWN_DAYS = 7

export interface Quiet {
  name: string
  /** Full days at zero, up to the last full day. */
  days: number
  /** The last day it fired, in the site's timezone. */
  last: string
  /** Days it fired on, of the 14 before it stopped. */
  active: number
  /** Its average a day over those 14 days. */
  perDay: number
  /** Its counts over the last 7 full days, oldest first. */
  recent: number[]
}

/**
 * The quiet events among daily counts that run up to `end`, the last full day. `today` is the
 * count so far today when the range reaches it; firing today means it is not quiet.
 */
export function quietOf(
  daily: Array<{ name: string; day: string; events: number }>,
  end: string,
  today: Map<string, number> = new Map(),
): Quiet[] {
  const byName = new Map<string, Map<string, number>>()
  for (const d of daily) {
    const days = byName.get(d.name) ?? new Map<string, number>()
    days.set(d.day, d.events)
    byName.set(d.name, days)
  }
  const endMs = Date.parse(end)
  const count = (days: Map<string, number>, back: number) =>
    days.get(isoDay(endMs - back * DAY)) ?? 0
  const out: Quiet[] = []
  for (const [name, days] of byName) {
    if ((today.get(name) ?? 0) > 0) continue
    let quiet = 0
    while (quiet <= MAX_QUIET_DAYS && count(days, quiet) === 0) quiet++
    if (quiet < QUIET_DAYS || quiet > MAX_QUIET_DAYS) continue
    const steady = Array.from({ length: STEADY_DAYS }, (_, i) => count(days, quiet + i))
    const active = steady.filter((n) => n > 0).length
    const perDay = steady.reduce((a, b) => a + b, 0) / STEADY_DAYS
    if (active < ACTIVE_DAYS || perDay < PER_DAY) continue
    out.push({
      name,
      days: quiet,
      last: isoDay(endMs - quiet * DAY),
      active,
      perDay: Math.round(perDay * 10) / 10,
      recent: Array.from({ length: SHOWN_DAYS }, (_, i) => count(days, SHOWN_DAYS - 1 - i)),
    })
  }
  return out.sort((a, b) => b.perDay - a.perDay)
}

/**
 * The site's quiet events as of the range's end: its last full day, which is yesterday while the
 * range reaches today.
 */
export async function quietEvents(site: Site, range: DateRange): Promise<Quiet[]> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: site.timezone })
  const open = range.to >= today
  const end = open ? isoDay(Date.parse(today) - DAY) : range.to
  const from = isoDay(Date.parse(end) - (MAX_QUIET_DAYS + STEADY_DAYS) * DAY)
  const params = { site: site.id, tz: site.timezone, from, to: open ? today : end }
  const daily = await rows<{ name: string; day: string; events: number }>(
    `SELECT name, toString(toDate(timestamp, {tz:String})) AS day, count() AS events
     FROM events
     WHERE site_id = {site:UUID} AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}
       AND name NOT IN ('pageview', 'click')
     GROUP BY name, day`,
    params,
  )
  const counts = daily.map((d) => ({ ...d, events: Number(d.events) }))
  const todays = new Map(counts.filter((d) => d.day === today).map((d) => [d.name, d.events]))
  return quietOf(
    counts.filter((d) => d.day <= end),
    end,
    open ? todays : undefined,
  )
}
