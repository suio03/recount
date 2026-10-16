import { type Match, matchSql } from '../stats/goals'
import { levelsSql } from '../stats/paths'
import { inRange, payments, rows, type Scope, sessions } from '../stats/queries'
import type { DateRange } from '../stats/range'

/**
 * What "Why?" reads beyond the dashboard's own numbers: a lane split by who walked it, where the
 * people who stopped went, the properties its failures carried, and one visitor's every event.
 */

/** Columns a lane is split by, as named in the events table. */
export const SPLITS = ['device', 'channel', 'browser'] as const
export type Split = (typeof SPLITS)[number]

/** Values per split, the ones with the most starters. */
const MAX_VALUES = 4

export interface SplitRow {
  value: string
  /** Visitors reaching each step. */
  steps: number[]
}

/** A lane's steps for the visitors of each value of `split`, by their first event's value. */
export async function laneSplitOf(scope: Scope, steps: Match[], split: Split): Promise<SplitRow[]> {
  const levels = levelsSql(scope, steps, scope.range, `argMin(${split}, timestamp) AS value`)
  const found = await rows<Record<string, string | number>>(
    `SELECT value, ${steps.map((_, i) => `countIf(level >= ${i + 1}) AS s${i}`).join(', ')}
     FROM (${levels.sql}) WHERE level >= 1
     GROUP BY value ORDER BY s0 DESC, value LIMIT {limit:UInt8}`,
    { ...levels.params, limit: MAX_VALUES },
  )
  return found.map((r) => ({
    value: String(r.value) || '(none)',
    steps: steps.map((_, i) => Number(r[`s${i}`] ?? 0)),
  }))
}

export interface Stuck {
  /** The last step they reached, from 1. */
  step: number
  visitors: number
  /** Custom events they sent in the range, besides the lane's own. */
  events: Array<{ name: string; visitors: number }>
  /** The last page each of them viewed. */
  exits: Array<{ page: string; visitors: number }>
}

/** The visitors who reached step `step` (from 1) and not the next, and what they did instead. */
export async function stuckAt(
  scope: Scope,
  steps: Match[],
  step: number,
  exclude: string[],
): Promise<Stuck> {
  const levels = levelsSql(scope, steps, scope.range)
  const s = sessions(scope)
  const where = `${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
    AND visitor_id IN (SELECT visitor_id FROM (${levels.sql}) WHERE level = {level:UInt8})`
  const params = { ...s.params, ...levels.params, level: step, exclude }
  const [total, events, exits] = await Promise.all([
    rows<{ visitors: number }>(
      `SELECT count() AS visitors FROM (${levels.sql}) WHERE level = {level:UInt8}`,
      params,
    ),
    rows<{ name: string; visitors: number }>(
      `SELECT name, uniqExact(visitor_id) AS visitors FROM events
       WHERE ${where} AND name NOT IN ('pageview', 'click') AND name NOT IN {exclude:Array(String)}
       GROUP BY name ORDER BY visitors DESC, name LIMIT 6`,
      params,
    ),
    rows<{ page: string; visitors: number }>(
      `SELECT page, count() AS visitors FROM (
         SELECT argMax(pathname, timestamp) AS page FROM events
         WHERE ${where} AND name = 'pageview' GROUP BY visitor_id
       ) GROUP BY page ORDER BY visitors DESC, page LIMIT 5`,
      params,
    ),
  ])
  return {
    step,
    visitors: Number(total[0]?.visitors ?? 0),
    events: events.map((e) => ({ name: e.name, visitors: Number(e.visitors) })),
    exits: exits.map((e) => ({ page: e.page, visitors: Number(e.visitors) })),
  }
}

export interface PropRow {
  name: string
  key: string
  value: string
  visitors: number
}

/** The property values on side events among the visitors who reached a lane's first step. */
export async function sidePropsOf(scope: Scope, first: Match, names: string[]) {
  if (!names.length) return []
  const s = sessions(scope)
  const m = matchSql(first, 'f')
  const found = await rows<PropRow>(
    `SELECT name, key, props[key] AS value, uniqExact(visitor_id) AS visitors
     FROM events ARRAY JOIN mapKeys(props) AS key
     WHERE ${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
       AND name IN {side:Array(String)}
       AND visitor_id IN (SELECT visitor_id FROM events WHERE ${inRange} AND ${m.sql})
     GROUP BY name, key, value
     ORDER BY visitors DESC, name, key, value
     LIMIT 80`,
    { ...s.params, ...m.params, side: names },
  )
  return found.map((r) => ({ ...r, visitors: Number(r.visitors) }))
}

/** Events read per visitor, the latest. */
const MAX_EVENTS = 150

export interface VisitorEvent {
  at: number
  name: string
  path: string
  session: string
  referrer: string
  /** For a click, the text of what was clicked. */
  text: string
  props: Record<string, string>
}

export interface VisitorProfile {
  country: string
  device: string
  browser: string
  os: string
  channel: string
  referrer: string
  entry: string
}

/** One visitor's events in the range, oldest first, whatever the filters, and who they are. */
export async function visitorOf(scope: Scope, visitor: string) {
  const s = sessions({ ...scope, filters: {} })
  const params = { ...s.params, visitor }
  const mine = `${inRange} AND visitor_id = {visitor:UInt64}`
  const [events, profile] = await Promise.all([
    rows<VisitorEvent>(
      `SELECT toUnixTimestamp64Milli(timestamp) AS at, name, pathname AS path,
              toString(session_id) AS session, referrer_source AS referrer,
              element_text AS text, props
       FROM events WHERE ${mine}
       ORDER BY timestamp DESC LIMIT {max:UInt32}`,
      { ...params, max: MAX_EVENTS },
    ),
    rows<VisitorProfile>(
      `SELECT replaceAll(toString(argMin(country_code, timestamp)), '\\0', '') AS country,
              argMin(device, timestamp) AS device, argMin(browser, timestamp) AS browser,
              argMin(os, timestamp) AS os, argMin(channel, timestamp) AS channel,
              argMin(referrer_source, timestamp) AS referrer,
              argMinIf(pathname, timestamp, name = 'pageview') AS entry
       FROM events WHERE ${mine}`,
      params,
    ),
  ])
  return {
    events: events.reverse().map((e) => ({ ...e, at: Number(e.at) })),
    profile: profile[0] ?? null,
  }
}

/** What a visitor paid in the range by the payment provider's records, in minor units. */
export async function paidBy(scope: Scope, visitor: string) {
  const p = payments({ ...scope, filters: {} })
  const [row] = await rows<{ amount: number; payments: number }>(
    `SELECT sum(amount) AS amount, countIf(kind != 'refund') AS payments
     FROM (${p.sql}) WHERE visitor_id = {visitor:UInt64}`,
    { ...p.params, visitor },
  )
  return { amount: Number(row?.amount ?? 0), payments: Number(row?.payments ?? 0) }
}

/** How many visitors across the site sent each of `names` in a range, whatever the filters. */
export async function senders(scope: Scope, names: string[], range: DateRange) {
  if (!names.length) return new Map<string, number>()
  const s = sessions({ ...scope, filters: {} }, range)
  const found = await rows<{ name: string; visitors: number }>(
    `SELECT name, uniqExact(visitor_id) AS visitors FROM events
     WHERE ${inRange} AND name IN {names:Array(String)} GROUP BY name`,
    { ...s.params, names },
  )
  return new Map(found.map((r) => [r.name, Number(r.visitors)]))
}
