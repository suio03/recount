import type { Filters } from '../api'
import { readFilters } from './filters'
import { type Period, readPeriod, writePeriod } from './period'

/**
 * A dashboard's period and filters as they sit in the query string, so a view can be reloaded and
 * shared: `range` (with `from` and `to` for custom days) and one key per filter.
 */
export type DashboardSearch = { range?: string; from?: string; to?: string } & Filters

function toParams(raw: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw))
    if (typeof value === 'string') params.set(key, value)
  return params
}

export function toSearch(period: Period, filters: Filters): DashboardSearch {
  const params = new URLSearchParams()
  writePeriod(period, params)
  return { ...Object.fromEntries(params), ...filters }
}

export function fromSearch(search: Record<string, unknown>) {
  const params = toParams(search)
  return { period: readPeriod(params), filters: readFilters(params) }
}

/** Keeps only a known period and known filters, dropping anything else in the address. */
export function validateSearch(raw: Record<string, unknown>): DashboardSearch {
  const { period, filters } = fromSearch(raw)
  return toSearch(period, filters)
}
