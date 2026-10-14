import { z } from 'zod'

const DAY = 86_400_000
/** Room for "all time" on sites with years of imported history. */
const MAX_DAYS = 3660
/** The realtime view looks back at most this far. */
const MAX_SINCE_MS = DAY

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface DateRange {
  from: string
  to: string
  /**
   * Unix milliseconds. Narrows the days to events from `since` until `until` (default: now), for
   * the realtime view. The days must still cover both moments in the site's timezone.
   */
  since?: number
  until?: number
}

/** How finely the chart buckets a range. */
export type Interval = 'minute' | 'hour' | 'day' | 'month'

/** Query-string range: both ends inclusive, in the site's timezone. */
export const RangeQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    since: z.coerce.number().int().positive().optional(),
  })
  .refine((r) => r.from <= r.to, 'from must not be after to')
  .refine((r) => !(days(r) > MAX_DAYS), `range must be at most ${MAX_DAYS} days`)
  .refine(
    (r) => r.since === undefined || Date.now() - r.since <= MAX_SINCE_MS,
    'since must be within the last day',
  )

export function days({ from, to }: DateRange): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1
}

/** Minutes for the realtime view, hours for one day, months past a quarter, days otherwise. */
export function intervalOf(range: DateRange): Interval {
  if (range.since !== undefined) return 'minute'
  const n = days(range)
  if (n === 1) return 'hour'
  return n > 92 ? 'month' : 'day'
}

/** Query parameters for a range. `since` and `until` are always set, 0 meaning unbounded. */
export const rangeParams = (range: DateRange) => ({
  from: range.from,
  to: range.to,
  since: range.since ?? 0,
  until: range.until ?? 0,
})

/** SQL keeping events inside the range's `since` and `until`. */
export const withinMoments = `timestamp >= fromUnixTimestamp64Milli({since:Int64})
  AND ({until:Int64} = 0 OR timestamp < fromUnixTimestamp64Milli({until:Int64}))`

/**
 * The period of the same length that ends the day before `from`, used for change figures. A
 * realtime range compares with the same stretch of time just before it.
 */
export function previousRange(range: DateRange, now = Date.now()): DateRange {
  if (range.since !== undefined) {
    const since = range.since - ((range.until ?? now) - range.since)
    return { from: isoDay(since - DAY), to: range.to, since, until: range.since }
  }
  const start = Date.parse(range.from)
  return { from: isoDay(start - days(range) * DAY), to: isoDay(start - DAY) }
}
