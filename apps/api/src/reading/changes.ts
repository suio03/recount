import type { Filters, SESSION_DIMENSIONS } from '../stats/filters'

/**
 * Deterministic change detection. These functions decide what moved; the model only explains
 * what they found, so every number in a reading comes from here.
 */

export type SessionDimension = (typeof SESSION_DIMENSIONS)[number]

export type Metric =
  | 'visitors'
  | 'pageviews'
  | 'bounce_rate'
  | 'avg_session_seconds'
  | 'conversion_rate'

export type Subject =
  | { kind: 'total' }
  | { kind: 'segment'; dimension: SessionDimension; value: string }
  | { kind: 'goal'; name: string }

export interface Finding {
  /** Stable within one reading, cited by the model as evidence. */
  id: string
  subject: Subject
  metric: Metric
  current: number
  previous: number
  /** Relative change; null when the previous value was zero. */
  change: number | null
  /** Share of the total visitor change this segment accounts for, when they move together. */
  share?: number
  /** First day of a sustained shift inside the range, when one stands out. */
  since?: string
  /** Filters that show this finding on the dashboard. */
  filters: Filters
}

export interface ValueRow {
  value: string
  visitors: number
}

export const relChange = (current: number, previous: number) =>
  previous === 0 ? null : (current - previous) / previous

export interface Mover {
  dimension: SessionDimension
  value: string
  current: number
  previous: number
  /** Visitors above (or below) what the segment would have had if it moved with the total. */
  excess: number
}

/**
 * Values of one dimension that moved differently from the total. `trend` is the total's
 * current/previous ratio; a value is kept when it deviates from that trend by at least
 * `minChange` (relative) and by at least `minVisitors` visitors.
 */
export function movers(
  dimension: SessionDimension,
  current: ValueRow[],
  previous: ValueRow[],
  {
    minVisitors,
    minChange = 0.2,
    trend = 1,
  }: { minVisitors: number; minChange?: number; trend?: number },
): Mover[] {
  const before = new Map(previous.map((r) => [r.value, r.visitors]))
  const now = new Map(current.map((r) => [r.value, r.visitors]))
  const result: Mover[] = []
  for (const value of new Set([...now.keys(), ...before.keys()])) {
    const cur = now.get(value) ?? 0
    const prev = before.get(value) ?? 0
    const expected = prev * trend
    if (Math.abs(cur - expected) < minVisitors) continue
    const deviation = relChange(cur, expected)
    if (deviation !== null && Math.abs(deviation) < minChange) continue
    result.push({ dimension, value, current: cur, previous: prev, excess: cur - expected })
  }
  return result
}

/**
 * The movers furthest from the trend, at most `perDimension` from one dimension so a single
 * shift (say, one referrer) does not crowd out everything else.
 */
export function topMovers(all: Mover[], { limit = 5, perDimension = 2 } = {}): Mover[] {
  const sorted = [...all].sort(
    (a, b) => Math.abs(b.excess) - Math.abs(a.excess) || a.value.localeCompare(b.value),
  )
  const used = new Map<SessionDimension, number>()
  const picked: Mover[] = []
  for (const m of sorted) {
    const n = used.get(m.dimension) ?? 0
    if (n >= perDimension) continue
    used.set(m.dimension, n + 1)
    picked.push(m)
    if (picked.length === limit) break
  }
  return picked
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1)

/**
 * Where a daily series shifts level, found by the split that best fits two flat segments. Returns
 * the index of the first day of the new level, or undefined when the series has no clear step:
 * both sides need `minRun` days and their means must differ by at least `minRatio`.
 */
export function changePoint(
  values: number[],
  { minRun = 3, minRatio = 1.5 } = {},
): number | undefined {
  let best: { at: number; cost: number } | undefined
  for (let at = minRun; at <= values.length - minRun; at++) {
    const left = values.slice(0, at)
    const right = values.slice(at)
    const ml = mean(left)
    const mr = mean(right)
    const cost =
      left.reduce((s, x) => s + (x - ml) ** 2, 0) + right.reduce((s, x) => s + (x - mr) ** 2, 0)
    if (!best || cost < best.cost) best = { at, cost }
  }
  if (!best) return undefined
  const before = mean(values.slice(0, best.at))
  const after = mean(values.slice(best.at))
  const ratio = Math.max(before, after) / Math.max(Math.min(before, after), 1e-9)
  return ratio >= minRatio ? best.at : undefined
}
