import type { Finding, Metric } from './changes'

/**
 * Findings as the model sees them. Every figure is pre-formatted so the model can copy it
 * verbatim, and `unsupportedNumbers` can check that it did.
 */

const DIMENSION_LABELS: Record<string, string> = {
  channel: 'Channel',
  referrer: 'Referrer',
  campaign: 'Campaign',
  entry: 'Entry page',
  country: 'Country',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  page: 'Page',
  goal: 'Goal',
}

const METRIC_LABELS: Record<Metric, string> = {
  visitors: 'visitors',
  pageviews: 'pageviews',
  bounce_rate: 'bounce rate',
  avg_session_seconds: 'average session time',
  conversion_rate: 'conversion rate (share of visitors who triggered it)',
  revenue: 'revenue (net of refunds)',
  revenue_per_visitor: 'revenue per visitor (net of refunds)',
}

export function count(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`
}

export const percent = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`

export function seconds(s: number): string {
  const m = Math.floor(s / 60)
  return m ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`
}

export function signed(change: number | null): string {
  if (change === null) return 'new (no baseline)'
  const p = Math.round(change * 100)
  return p > 0 ? `+${p}%` : `${p}%`
}

export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Whole units from 100 up, so "$4,059" rather than "$4,059.00", which the model would shorten. */
export function money(minor: number, currency: string): string {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  const major = minor / 10 ** digits
  return new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: Math.abs(major) >= 100 ? 0 : digits,
  }).format(major)
}

export function value(metric: Metric, x: number, currency = 'USD'): string {
  if (metric === 'revenue' || metric === 'revenue_per_visitor') return money(x, currency)
  if (metric === 'bounce_rate') return percent(x)
  if (metric === 'conversion_rate') return percent(x, 1)
  if (metric === 'avg_session_seconds') return seconds(x)
  return count(x)
}

export function subjectLabel(f: Finding): string {
  const s = f.subject
  if (s.kind === 'total') return 'All traffic in scope'
  if (s.kind === 'goal') return `Goal "${s.name}"`
  if (s.kind === 'segment_goal')
    return `Goal "${s.name}" among visitors with ${DIMENSION_LABELS[s.dimension]} = ${s.value}`
  return `${DIMENSION_LABELS[s.dimension]} = ${s.value}`
}

/** One finding as the plain lines given to the model. */
export function describe(f: Finding): string {
  const lines = [
    `[${f.id}] ${subjectLabel(f)}: ${METRIC_LABELS[f.metric]}`,
    `  now ${value(f.metric, f.current, f.currency)}, before ${value(f.metric, f.previous, f.currency)}, change ${signed(f.change)}`,
  ]
  if (f.baseline !== undefined)
    lines.push(`  among all visitors in scope it is ${value(f.metric, f.baseline, f.currency)}`)
  if (f.share !== undefined)
    lines.push(`  accounts for ${percent(f.share)} of the total visitor change`)
  if (f.since) lines.push(`  the shift starts on ${shortDay(f.since)}`)
  return lines.join('\n')
}

const NUMBER = /\d[\d,.]*\s*(?:%|k\b)?/g
const normalize = (token: string) => token.replace(/[\s,]/g, '').replace(/\.$/, '').toLowerCase()

/**
 * Numbers in `text` that do not appear in `allowed`. A claim that quotes a number its evidence
 * does not contain is dropped rather than shown.
 */
export function unsupportedNumbers(text: string, allowed: string[]): string[] {
  const known = new Set(allowed.flatMap((a) => (a.match(NUMBER) ?? []).map(normalize)))
  return (text.match(NUMBER) ?? []).map(normalize).filter((n) => {
    if (known.has(n)) return false
    // "78%" may be written as "78 percent"; a bare number matches a percentage or count with it.
    return !known.has(`${n}%`) && !known.has(`${n}k`)
  })
}
