const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Compact for tiles (12.4k); rows use toLocaleString for exact figures. */
export const compact = (n: number) => compactFormat.format(n).toLowerCase()

export const percent = (fraction: number, digits = 0) => `${(fraction * 100).toFixed(digits)}%`

export const duration = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`

/** Revenue from minor units: "$4,059" in rows, "$4.1k" when `compact`. */
export function money(minor: number, currency: string, { compact = false } = {}) {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  const format = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  })
  const text = format.format(minor / 10 ** digits)
  return compact ? text.replace(/K$/, 'k') : text
}

const regions = new Intl.DisplayNames(['en'], { type: 'region' })

export const countryName = (code: string) => {
  try {
    return regions.of(code) ?? code
  } catch {
    return code
  }
}

/** Today as YYYY-MM-DD in the given IANA timezone. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

/** The last `n` days ending today in the site's timezone, both ends inclusive. */
export function lastDays(n: number, timezone: string) {
  const to = todayIn(timezone)
  const from = new Date(Date.parse(to) - (n - 1) * 86_400_000).toISOString().slice(0, 10)
  return { from, to }
}

const rangeDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "Sep 14 – Oct 13" */
export const rangeLabel = ({ from, to }: { from: string; to: string }) =>
  rangeDay.formatRange(new Date(from), new Date(to))
