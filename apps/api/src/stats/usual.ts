import { rows, type Scope, sessions } from './queries'
import type { DateRange } from './range'

const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Days before the range that set what a usual day is. */
export const USUAL_DAYS = 28
/** Fewer days with data than this, and there is no usual day yet. */
const MIN_DAYS = 7

/**
 * The median of daily counts, counting quiet days as zero but only from the first day with any
 * data, so a site's days before it was installed do not drag it down. Undefined with too little.
 */
export function usualOf(daily: Array<{ day: string; visitors: number }>, from: string, to: string) {
  const sorted = daily
    .filter((d) => d.day >= from && d.day <= to)
    .sort((a, b) => (a.day < b.day ? -1 : 1))
  const first = sorted[0]?.day
  if (!first) return undefined
  const byDay = new Map(sorted.map((d) => [d.day, d.visitors]))
  const counts: number[] = []
  for (let t = Date.parse(first); t <= Date.parse(to); t += DAY)
    counts.push(byDay.get(isoDay(t)) ?? 0)
  if (counts.length < MIN_DAYS) return undefined
  counts.sort((a, b) => a - b)
  const mid = counts.length / 2
  return Number.isInteger(mid)
    ? Math.round(((counts[mid - 1] ?? 0) + (counts[mid] ?? 0)) / 2)
    : (counts[Math.floor(mid)] ?? 0)
}

/** The 28 days just before the range. */
export function usualRange(range: DateRange): DateRange {
  const start = Date.parse(range.from)
  return { from: isoDay(start - USUAL_DAYS * DAY), to: isoDay(start - DAY) }
}

/** A usual day's visitors before the range, under the active filters. */
export async function usualVisitors(scope: Scope): Promise<number | null> {
  const range = usualRange(scope.range)
  const s = sessions(scope, range)
  const daily = await rows<{ day: string; visitors: number }>(
    `SELECT toString(day) AS day, uniqExact(visitor_id) AS visitors FROM (${s.sql}) GROUP BY day`,
    s.params,
  )
  return (
    usualOf(
      daily.map((d) => ({ day: d.day, visitors: Number(d.visitors) })),
      range.from,
      range.to,
    ) ?? null
  )
}
