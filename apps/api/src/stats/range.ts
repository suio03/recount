import { z } from 'zod'

const DAY = 86_400_000
const MAX_DAYS = 400

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export interface DateRange {
  from: string
  to: string
}

/** Query-string range: both ends inclusive, in the site's timezone. */
export const RangeQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => r.from <= r.to, 'from must not be after to')
  .refine((r) => !(days(r) > MAX_DAYS), `range must be at most ${MAX_DAYS} days`)

export function days({ from, to }: DateRange): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1
}

/** The period of the same length that ends the day before `from`, used for change figures. */
export function previousRange(range: DateRange): DateRange {
  const start = Date.parse(range.from)
  return { from: isoDay(start - days(range) * DAY), to: isoDay(start - DAY) }
}
