import type { KeyEvents } from '../db/schema'
import { type Match, matchSql } from './goals'
import { isFault } from './intent'
import { inRange, rows, type Scope, sessions } from './queries'
import { type DateRange, days, previousRange } from './range'

/**
 * How far people got: each lane is a funnel counted per visitor across the whole range, not
 * within one visit, since people sign in on one visit and pay on another. In cookieless mode a
 * visitor lasts a day, so the lanes count within a day.
 */

/** Lanes shown, from the site's funnels first and then the drafted ones. */
export const MAX_LANES = 4
/** Steps per lane. */
export const MAX_STEPS = 5
/** Side events per lane. */
const MAX_SIDE = 4

export interface LaneDefinition {
  name: string
  /** A funnel someone defined or applied, or one only drafted and waiting for review. */
  source: 'funnel' | 'draft'
  id?: string
  steps: Array<{ name: string; match: Match }>
}

export interface Lane {
  name: string
  source: LaneDefinition['source']
  id?: string
  steps: Array<{ name: string; kind: Match['kind']; visitors: number; previous: number }>
  /** Failures and give-ups among the visitors who started the lane. */
  side: Array<{ name: string; visitors: number }>
}

/**
 * Visitors who reached each step in order, each event moving a visitor at most one step, with
 * the steps anywhere in the range among the sessions in scope.
 */
export function visitorFunnelSql(scope: Scope, steps: Match[], range: DateRange) {
  const s = sessions(scope, range)
  const matches = steps.map((m, i) => matchSql(m, `s${i}`))
  const window = days(range) * 86_400_000
  return {
    sql: `SELECT ${steps.map((_, i) => `countIf(level >= ${i + 1}) AS s${i}`).join(', ')}
     FROM (
       SELECT windowFunnel(${window}, 'strict_once')(
                toUInt64(toUnixTimestamp64Milli(timestamp)), ${matches.map((m) => m.sql).join(', ')}
              ) AS level
       FROM events
       WHERE ${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
       GROUP BY visitor_id
     )`,
    params: Object.assign({}, s.params, ...matches.map((m) => m.params)),
  }
}

export async function visitorFunnelOf(scope: Scope, steps: Match[], range: DateRange) {
  const f = visitorFunnelSql(scope, steps, range)
  const [row] = await rows<Record<string, number>>(f.sql, f.params)
  return steps.map((_, i) => Number(row?.[`s${i}`] ?? 0))
}

/** The failure and give-up events among the visitors who reached a lane's first step. */
async function sideOf(scope: Scope, first: Match, names: string[]) {
  if (!names.length) return []
  const s = sessions(scope)
  const m = matchSql(first, 'f')
  const side = await rows<{ name: string; visitors: number }>(
    `SELECT name, uniqExact(visitor_id) AS visitors
     FROM events
     WHERE ${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
       AND name IN {side:Array(String)}
       AND visitor_id IN (SELECT visitor_id FROM events WHERE ${inRange} AND ${m.sql})
     GROUP BY name
     ORDER BY visitors DESC, name
     LIMIT ${MAX_SIDE}`,
    { ...s.params, ...m.params, side: names },
  )
  return side.map((r) => ({ name: r.name, visitors: Number(r.visitors) }))
}

/** The events that count as side events: the failure and give-up key events, and any fault. */
export function sideNames(events: KeyEvents, names: string[]) {
  return [...new Set([...events.failed, ...events.closed, ...names.filter(isFault)])]
}

export async function lanesOf(
  scope: Scope,
  definitions: LaneDefinition[],
  side: string[],
): Promise<Lane[]> {
  const before = previousRange(scope.range)
  return Promise.all(
    definitions.slice(0, MAX_LANES).map(async (d) => {
      const steps = d.steps.slice(0, MAX_STEPS)
      const matches = steps.map((s) => s.match)
      const stepNames = new Set(matches.flatMap((m) => (m.kind === 'event' ? [m.name] : [])))
      const [now, then, sides] = await Promise.all([
        visitorFunnelOf(scope, matches, scope.range),
        visitorFunnelOf(scope, matches, before),
        steps[0]
          ? sideOf(
              scope,
              steps[0].match,
              side.filter((n) => !stepNames.has(n)),
            )
          : [],
      ])
      return {
        name: d.name,
        source: d.source,
        id: d.id,
        steps: steps.map((s, i) => ({
          name: s.name,
          kind: s.match.kind,
          visitors: now[i] ?? 0,
          previous: then[i] ?? 0,
        })),
        side: sides,
      }
    }),
  )
}

/** Custom events with their visitors now and before: what shows when there are no lanes. */
export async function eventListOf(scope: Scope) {
  const count = async (range: DateRange) => {
    const s = sessions(scope, range)
    return rows<{ name: string; visitors: number }>(
      `SELECT name, uniqExact(visitor_id) AS visitors
       FROM events
       WHERE ${inRange} AND session_id IN (SELECT session_id FROM (${s.sql}))
         AND name NOT IN ('pageview', 'click')
       GROUP BY name`,
      s.params,
    )
  }
  const [now, then] = await Promise.all([count(scope.range), count(previousRange(scope.range))])
  const previous = new Map(then.map((r) => [r.name, Number(r.visitors)]))
  return now
    .map((r) => ({
      name: r.name,
      visitors: Number(r.visitors),
      previous: previous.get(r.name) ?? 0,
    }))
    .sort((a, b) => b.visitors - a.visitors || a.name.localeCompare(b.name))
    .slice(0, 12)
}
