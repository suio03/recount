import { type DateRange, type Interval, intervalOf } from './range'

const DAY = 86_400_000
const MINUTE = 60_000

/**
 * SQL naming the chart bucket of a timestamp column, as text in the site's timezone: minutes and
 * hours as `YYYY-MM-DD hh:mm:00`, days as `YYYY-MM-DD`, months as their first day.
 */
export function bucketSql(interval: Interval, column: string) {
  if (interval === 'minute') return `formatDateTime(${column}, '%Y-%m-%d %H:%i:00', {tz:String})`
  if (interval === 'hour') return `formatDateTime(${column}, '%Y-%m-%d %H:00:00', {tz:String})`
  if (interval === 'day') return `toString(toDate(${column}, {tz:String}))`
  return `toString(toStartOfMonth(toDate(${column}, {tz:String})))`
}

/** `YYYY-MM-DD hh:mm` of a moment in the timezone. */
function localMinute(ms: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

/**
 * Every bucket of the range in order, up to the one holding `now`, so quiet stretches chart as
 * zero and the future is left off.
 */
export function bucketsOf(range: DateRange, timezone: string, now = Date.now()): string[] {
  const interval = intervalOf(range)
  const out: string[] = []
  if (interval === 'minute') {
    const end = Math.min(range.until ?? now, now)
    const first = Math.floor((range.since ?? end) / MINUTE) * MINUTE
    for (let t = first; t < end; t += MINUTE) out.push(`${localMinute(t, timezone)}:00`)
    return out
  }
  const current = localMinute(now, timezone)
  const today = current.slice(0, 10)
  if (interval === 'hour') {
    for (let h = 0; h < 24; h++) out.push(`${range.from} ${String(h).padStart(2, '0')}:00:00`)
    return out.filter((b) => b.slice(0, 13) <= current.slice(0, 13))
  }
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += DAY) {
    const day = new Date(t).toISOString().slice(0, 10)
    if (day > today) break
    const bucket = interval === 'day' ? day : `${day.slice(0, 7)}-01`
    if (out.at(-1) !== bucket) out.push(bucket)
  }
  return out
}
