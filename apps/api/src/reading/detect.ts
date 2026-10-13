import type { SiteSemantics } from '@recount/semantic'
import { SESSION_DIMENSIONS } from '../stats/filters'
import { goalsOf, rows, type Scope, sessions, type Totals, totalsOf } from '../stats/queries'
import { type DateRange, previousRange } from '../stats/range'
import {
  changePoint,
  type Finding,
  type Metric,
  type Mover,
  movers,
  relChange,
  topMovers,
  type ValueRow,
} from './changes'

/** Totals other than visitors are reported only when they moved at least this much. */
const TOTAL_THRESHOLD = 0.1
/** Goal conversion rates are reported when they moved this much, or always for key events. */
const GOAL_THRESHOLD = 0.15
const GOAL_MIN_VISITORS = 10

function valuesOf(scope: Scope, range: DateRange, dimension: string) {
  const s = sessions(scope, range)
  return rows<ValueRow>(
    `SELECT ${dimension} AS value, uniqExact(visitor_id) AS visitors
     FROM (${s.sql}) WHERE value != ''
     GROUP BY value ORDER BY visitors DESC LIMIT 100`,
    s.params,
  )
}

async function dailyVisitors(scope: Scope) {
  const s = sessions(scope)
  return rows<{ day: string; visitors: number }>(
    `SELECT day, uniqExact(visitor_id) AS visitors
     FROM (${s.sql}) GROUP BY day ORDER BY day WITH FILL FROM {from:Date} TO {to:Date} + 1`,
    s.params,
  )
}

/** The day a scope's daily visitors stepped in the same direction as `change`, if they did. */
async function stepDay(scope: Scope, change: number | null): Promise<string | undefined> {
  const series = await dailyVisitors(scope)
  const at = changePoint(series.map((d) => d.visitors))
  if (at === undefined) return undefined
  const before = series.slice(0, at).reduce((s, d) => s + d.visitors, 0) / at
  const after = series.slice(at).reduce((s, d) => s + d.visitors, 0) / (series.length - at)
  const up = after > before
  if (change !== null && up !== change > 0) return undefined
  return series[at]?.day
}

/**
 * What changed between the scope's range and the period before it: headline totals, the
 * segments that moved most, and goal conversion rates.
 */
export async function detectChanges(scope: Scope, semantics?: SiteSemantics): Promise<Finding[]> {
  const before = previousRange(scope.range)
  const dimensions = SESSION_DIMENSIONS.filter((d) => !scope.filters[d])

  const [totals, previous, goalsNow, goalsBefore, ...byDimension] = await Promise.all([
    totalsOf(scope, scope.range),
    totalsOf(scope, before),
    goalsOf(scope, scope.range),
    goalsOf(scope, before),
    ...dimensions.flatMap((d) => [valuesOf(scope, scope.range, d), valuesOf(scope, before, d)]),
  ])

  const findings: Omit<Finding, 'id'>[] = []
  const totalChange = relChange(totals.visitors, previous.visitors)

  findings.push({
    subject: { kind: 'total' },
    metric: 'visitors',
    current: totals.visitors,
    previous: previous.visitors,
    change: totalChange,
    since: await stepDay(scope, totalChange),
    filters: scope.filters,
  })
  for (const metric of ['pageviews', 'bounce_rate', 'avg_session_seconds'] as const) {
    const change = relChange(totals[metric], previous[metric])
    if (change === null || Math.abs(change) < TOTAL_THRESHOLD) continue
    findings.push(total(scope, metric, totals, previous))
  }

  // Segments: values that moved, then their own step day.
  const minVisitors = Math.max(10, Math.round(0.02 * Math.max(totals.visitors, previous.visitors)))
  const trend = previous.visitors ? totals.visitors / previous.visitors : 1
  const candidates: Mover[] = dimensions.flatMap((d, i) =>
    movers(d, byDimension[2 * i] as ValueRow[], byDimension[2 * i + 1] as ValueRow[], {
      minVisitors,
      trend,
    }),
  )
  const totalDiff = totals.visitors - previous.visitors
  const segments = await Promise.all(
    topMovers(candidates).map(async (m): Promise<Omit<Finding, 'id'>> => {
      const filters = { ...scope.filters, [m.dimension]: m.value }
      const change = relChange(m.current, m.previous)
      const diff = m.current - m.previous
      return {
        subject: { kind: 'segment', dimension: m.dimension, value: m.value },
        metric: 'visitors',
        current: m.current,
        previous: m.previous,
        change,
        share:
          totalDiff !== 0 && Math.sign(diff) === Math.sign(totalDiff)
            ? diff / totalDiff
            : undefined,
        since: await stepDay({ ...scope, filters }, change),
        filters,
      }
    }),
  )
  findings.push(...segments)

  // Goals: conversion rate among the scope's visitors.
  const keyEvents = new Set(semantics?.events.filter((e) => e.key).map((e) => e.name))
  const now = new Map(goalsNow.map((g) => [g.name, g.visitors]))
  const earlier = new Map(goalsBefore.map((g) => [g.name, g.visitors]))
  // Goals that stopped firing matter as much as new ones.
  for (const name of new Set([...now.keys(), ...earlier.keys()])) {
    const visitors = now.get(name) ?? 0
    const prevVisitors = earlier.get(name) ?? 0
    const rate = totals.visitors ? visitors / totals.visitors : 0
    const prevRate = previous.visitors ? prevVisitors / previous.visitors : 0
    const change = relChange(rate, prevRate)
    const moved =
      Math.max(visitors, prevVisitors) >= GOAL_MIN_VISITORS &&
      (change === null || Math.abs(change) >= GOAL_THRESHOLD)
    if (!moved && !keyEvents.has(name)) continue
    findings.push({
      subject: { kind: 'goal', name },
      metric: 'conversion_rate',
      current: rate,
      previous: prevRate,
      change,
      filters: { ...scope.filters, goal: name },
    })
  }

  return findings.map((f, i) => ({ id: `f${i + 1}`, ...f }))
}

function total(scope: Scope, metric: Metric & keyof Totals, now: Totals, before: Totals) {
  return {
    subject: { kind: 'total' } as const,
    metric,
    current: now[metric],
    previous: before[metric],
    change: relChange(now[metric], before[metric]),
    filters: scope.filters,
  }
}
