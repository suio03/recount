import type { DateRange } from '../api'

const DAY = 86_400_000
/** How far back the realtime view looks. */
export const REALTIME_MINUTES = 30

export type Preset =
  | 'today'
  | 'yesterday'
  | 'realtime'
  | '7d'
  | '30d'
  | 'month'
  | 'last-month'
  | 'year'
  | '12mo'
  | 'all'

/** A preset that rolls with the clock, or fixed days chosen by hand or reached with the arrows. */
export type Period = { preset: Preset } | { preset: 'custom'; from: string; to: string }

/** The menu, in Plausible's order and with its keyboard shortcuts. */
export const PRESET_GROUPS: Array<Array<{ preset: Preset; label: string; key?: string }>> = [
  [
    { preset: 'today', label: 'Today', key: 'D' },
    { preset: 'yesterday', label: 'Yesterday', key: 'E' },
    { preset: 'realtime', label: 'Realtime', key: 'R' },
  ],
  [
    { preset: '7d', label: 'Last 7 Days', key: 'W' },
    { preset: '30d', label: 'Last 30 Days', key: 'T' },
  ],
  [
    { preset: 'month', label: 'Month to Date', key: 'M' },
    { preset: 'last-month', label: 'Last Month' },
  ],
  [
    { preset: 'year', label: 'Year to Date', key: 'Y' },
    { preset: '12mo', label: 'Last 12 Months', key: 'L' },
  ],
  [{ preset: 'all', label: 'All time', key: 'A' }],
]

const PRESETS = PRESET_GROUPS.flat()
export const DEFAULT_PERIOD: Period = { preset: 'today' }

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (day: string, n: number) => isoDay(Date.parse(day) + n * DAY)
const isDay = (s: string | null): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/** First day of the month `n` months after `day`'s month. */
function monthStart(day: string, n = 0) {
  const d = new Date(Date.parse(day))
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))
}
const monthEnd = (day: string) => addDays(monthStart(day, 1), -1)

/** Today as YYYY-MM-DD in the timezone, at `now`. */
export const dayIn = (timezone: string, now: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)

/** Reads the period from the query string: `range=<preset>`, or `range=custom&from=…&to=…`. */
export function readPeriod(params: URLSearchParams): Period {
  const range = params.get('range')
  if (range === 'custom') {
    const from = params.get('from')
    const to = params.get('to')
    if (isDay(from) && isDay(to) && from <= to) return { preset: 'custom', from, to }
  }
  const preset = PRESETS.find((p) => p.preset === range)?.preset
  return preset ? { preset } : DEFAULT_PERIOD
}

export function writePeriod(period: Period, params: URLSearchParams) {
  params.set('range', period.preset)
  if (period.preset === 'custom') {
    params.set('from', period.from)
    params.set('to', period.to)
  }
}

/**
 * The days a period covers in the site's timezone, both ends inclusive. Realtime also carries
 * `since`, the start of its window to the minute, so the query stays the same within a minute.
 */
export function resolve(
  period: Period,
  timezone: string,
  firstEvent: string | null,
  now = Date.now(),
): DateRange {
  const today = dayIn(timezone, now)
  switch (period.preset) {
    case 'custom':
      return { from: period.from, to: period.to }
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const day = addDays(today, -1)
      return { from: day, to: day }
    }
    case 'realtime': {
      const since = Math.floor((now - REALTIME_MINUTES * 60_000) / 60_000) * 60_000
      return { from: dayIn(timezone, since), to: today, since }
    }
    case '7d':
      return { from: addDays(today, -6), to: today }
    case '30d':
      return { from: addDays(today, -29), to: today }
    case 'month':
      return { from: monthStart(today), to: today }
    case 'last-month':
      return { from: monthStart(today, -1), to: monthEnd(monthStart(today, -1)) }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today }
    case '12mo':
      return { from: monthStart(today, -11), to: today }
    case 'all': {
      const first = firstEvent ? dayIn(timezone, Date.parse(firstEvent)) : today
      return { from: first < today ? first : today, to: today }
    }
  }
}

const isWholeMonth = (r: DateRange) => r.from === monthStart(r.from) && r.to === monthEnd(r.from)
const isWholeYear = (r: DateRange) =>
  r.from.endsWith('-01-01') && r.to.endsWith('-12-31') && r.from.slice(0, 4) === r.to.slice(0, 4)
const lengthOf = (r: DateRange) => Math.round((Date.parse(r.to) - Date.parse(r.from)) / DAY) + 1

/**
 * The period one step earlier (`-1`) or later (`1`): a day, a calendar month or year when the
 * range is one, otherwise the range's own length. Undefined for realtime and all time, and for
 * steps into the future.
 */
export function shift(
  period: Period,
  direction: -1 | 1,
  timezone: string,
  now = Date.now(),
): Period | undefined {
  if (period.preset === 'realtime' || period.preset === 'all') return undefined
  const today = dayIn(timezone, now)
  const r = resolve(period, timezone, null, now)
  if (direction === 1 && r.to >= today) return undefined
  let next: DateRange
  const unit =
    period.preset === 'year' || isWholeYear(r)
      ? 'year'
      : period.preset === 'month' || isWholeMonth(r)
        ? 'month'
        : 'days'
  if (unit === 'year') {
    const year = Number(r.from.slice(0, 4)) + direction
    next = { from: `${year}-01-01`, to: `${year}-12-31` }
  } else if (unit === 'month') {
    const from = monthStart(r.from, direction)
    next = { from, to: monthEnd(from) }
  } else if (r.from === r.to) {
    next = { from: addDays(r.from, direction), to: addDays(r.from, direction) }
  } else {
    const n = lengthOf(r) * direction
    next = { from: addDays(r.from, n), to: addDays(r.to, n) }
  }
  if (next.to > today) {
    // Stepping forward into the current month or year lands on its "to date" preset.
    if (unit === 'month') return { preset: 'month' }
    if (unit === 'year') return { preset: 'year' }
    next.to = today
  }
  if (next.from === today && next.to === today) return { preset: 'today' }
  if (next.from === addDays(today, -1) && next.to === next.from) return { preset: 'yesterday' }
  return { preset: 'custom', ...next }
}

const dayFormat = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const monthFormat = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const spanFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

/** The button's text: the preset's name, or the days in words for a custom period. */
export function periodLabel(period: Period, timezone: string, now = Date.now()): string {
  if (period.preset !== 'custom')
    return PRESETS.find((p) => p.preset === period.preset)?.label ?? period.preset
  const today = dayIn(timezone, now)
  const r: DateRange = period
  if (r.from === r.to) {
    if (r.from === today) return 'Today'
    if (r.from === addDays(today, -1)) return 'Yesterday'
    return dayFormat.format(Date.parse(r.from))
  }
  if (isWholeMonth(r)) return monthFormat.format(Date.parse(r.from))
  if (isWholeYear(r)) return r.from.slice(0, 4)
  return spanFormat.formatRange(Date.parse(r.from), Date.parse(r.to))
}

/** What the numbers are compared with, for the line beside the picker. */
export function comparisonLabel(period: Period, range: DateRange): string | undefined {
  if (period.preset === 'all') return undefined
  if (period.preset === 'realtime') return `vs previous ${REALTIME_MINUTES} minutes`
  const n = lengthOf(range)
  return n === 1 ? 'vs previous day' : `vs previous ${n} days`
}
