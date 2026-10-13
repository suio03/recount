import type { SiteSemantics } from '@recount/semantic'
import { SESSION_DIMENSIONS } from '../stats/filters'
import {
  type GoalRow,
  goalsOf,
  type Revenue,
  revenueOf,
  rows,
  type Scope,
  sessions,
  type Totals,
  totalsOf,
} from '../stats/queries'
import { type DateRange, previousRange } from '../stats/range'
import {
  changePoint,
  type Finding,
  type Metric,
  type Mover,
  movers,
  pickConversions,
  relChange,
  type SegmentConversion,
  topMovers,
  type ValueRow,
} from './changes'

/** Totals other than visitors are reported only when they moved at least this much. */
const TOTAL_THRESHOLD = 0.1
/** Goal conversion rates are reported when they moved this much, or always for key events. */
const GOAL_THRESHOLD = 0.15
const GOAL_MIN_VISITORS = 10
/** When a goal's rate moved, this many of the biggest moving segments get their own rate. */
const EXPLAINING_SEGMENTS = 2
/** A moving segment's revenue is reported when it holds this share of either period's revenue. */
const SEGMENT_REVENUE_SHARE = 0.05

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

  const [totals, previous, revenue, prevRevenue, goalsNow, goalsBefore, ...byDimension] =
    await Promise.all([
      totalsOf(scope, scope.range),
      totalsOf(scope, before),
      revenueOf(scope, scope.range),
      revenueOf(scope, before),
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
  const currency = scope.site.currency
  // Revenue is always worth a line once the site has any.
  if (revenue.revenue || prevRevenue.revenue)
    findings.push({
      subject: { kind: 'total' },
      metric: 'revenue',
      current: revenue.revenue,
      previous: prevRevenue.revenue,
      change: relChange(revenue.revenue, prevRevenue.revenue),
      currency,
      filters: scope.filters,
    })

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
  const top = topMovers(candidates)
  const segments = await Promise.all(
    top.map(async (m): Promise<Omit<Finding, 'id'>> => {
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
  if (revenue.revenue || prevRevenue.revenue)
    findings.push(...(await segmentRevenue(scope, before, top, revenue, prevRevenue)))

  // Goals: conversion rate among the scope's visitors.
  const keyEvents = new Set(semantics?.events.filter((e) => e.key).map((e) => e.name))
  const now = new Map(goalsNow.map((g) => [g.name, g.visitors]))
  const earlier = new Map(goalsBefore.map((g) => [g.name, g.visitors]))
  const reported: { name: string; moved: boolean }[] = []
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
    reported.push({ name, moved })
    findings.push({
      subject: { kind: 'goal', name },
      metric: 'conversion_rate',
      current: rate,
      previous: prevRate,
      change,
      filters: { ...scope.filters, goal: name },
    })
  }

  findings.push(...(await segmentConversions(scope, before, top, reported, totals.visitors, now)))

  return findings.map((f, i) => ({ id: `f${i + 1}`, ...f }))
}

/**
 * How the moving segments convert on the reported goals: the evidence for or against "the new
 * traffic converts worse". Kept when a segment's rate differs clearly from all visitors, or when
 * the goal moved and the segment is one of the biggest movers, since a matching rate then shows
 * the shift is site-wide rather than a change in the mix.
 */
async function segmentConversions(
  scope: Scope,
  before: DateRange,
  segments: Mover[],
  goals: { name: string; moved: boolean }[],
  visitors: number,
  converted: Map<string, number>,
): Promise<Omit<Finding, 'id'>[]> {
  if (!goals.length || !visitors) return []
  const perSegment = await Promise.all(
    segments.map(async (m) => {
      const filters = { ...scope.filters, [m.dimension]: m.value }
      const [now, earlier] = await Promise.all([
        goalsOf({ ...scope, filters }, scope.range),
        goalsOf({ ...scope, filters }, before),
      ])
      return { m, filters, now: byName(now), earlier: byName(earlier) }
    }),
  )
  const candidates: SegmentConversion[] = perSegment.flatMap(({ m, now }, rank) =>
    goals.map((goal) => ({
      dimension: m.dimension,
      value: m.value,
      goal: goal.name,
      visitors: m.current,
      converted: now.get(goal.name) ?? 0,
      baseline: (converted.get(goal.name) ?? 0) / visitors,
      explains: goal.moved && rank < EXPLAINING_SEGMENTS,
    })),
  )
  return pickConversions(candidates).map((c) => {
    const segment = perSegment.find((p) => p.m.dimension === c.dimension && p.m.value === c.value)
    const { m, filters, earlier } = segment as (typeof perSegment)[number]
    const rate = c.converted / c.visitors
    const prevRate = m.previous ? (earlier.get(c.goal) ?? 0) / m.previous : 0
    return {
      subject: { kind: 'segment_goal', dimension: c.dimension, value: c.value, name: c.goal },
      metric: 'conversion_rate',
      current: rate,
      previous: prevRate,
      change: relChange(rate, prevRate),
      baseline: c.baseline,
      // The segment alone: the goals panel then shows its conversion rates.
      filters,
    }
  })
}

/** Revenue from the biggest moving segments, when they bring a noticeable part of it. */
async function segmentRevenue(
  scope: Scope,
  before: DateRange,
  segments: Mover[],
  now: Revenue,
  earlier: Revenue,
): Promise<Omit<Finding, 'id'>[]> {
  const found = await Promise.all(
    segments.map(async (m) => {
      const filters = { ...scope.filters, [m.dimension]: m.value }
      const [cur, prev] = await Promise.all([
        revenueOf({ ...scope, filters }, scope.range),
        revenueOf({ ...scope, filters }, before),
      ])
      const share = Math.max(
        now.revenue ? cur.revenue / now.revenue : 0,
        earlier.revenue ? prev.revenue / earlier.revenue : 0,
      )
      if (share < SEGMENT_REVENUE_SHARE) return undefined
      return {
        subject: { kind: 'segment', dimension: m.dimension, value: m.value },
        metric: 'revenue',
        current: cur.revenue,
        previous: prev.revenue,
        change: relChange(cur.revenue, prev.revenue),
        currency: scope.site.currency,
        filters,
      } satisfies Omit<Finding, 'id'>
    }),
  )
  return found.filter((f) => f !== undefined)
}

const byName = (goals: GoalRow[]) => new Map(goals.map((g) => [g.name, g.visitors]))

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
