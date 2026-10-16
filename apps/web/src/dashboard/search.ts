import type { Filters } from '../api'
import { readFilters } from './filters'
import { type Period, readPeriod, writePeriod } from './period'

/** The dashboard's tabs: the numbers at a glance, or who tried to pay and how far people got. */
export type Tab = 'overview' | 'journeys'

/**
 * A dashboard's period, filters and tab as they sit in the query string, so a view can be
 * reloaded and shared: `range` (with `from` and `to` for custom days), one key per filter, and
 * `tab=journeys` off the default tab.
 */
export type DashboardSearch = {
  range?: string
  from?: string
  to?: string
  tab?: 'journeys'
} & Filters

function toParams(raw: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw))
    if (typeof value === 'string') params.set(key, value)
  return params
}

export function toSearch(period: Period, filters: Filters, tab: Tab = 'overview'): DashboardSearch {
  const params = new URLSearchParams()
  writePeriod(period, params)
  return { ...Object.fromEntries(params), ...filters, ...(tab === 'journeys' && { tab }) }
}

export function fromSearch(search: Record<string, unknown>) {
  const params = toParams(search)
  const tab: Tab = params.get('tab') === 'journeys' ? 'journeys' : 'overview'
  return { period: readPeriod(params), filters: readFilters(params), tab }
}

/** Keeps only a known period, known filters and tab, dropping anything else in the address. */
export function validateSearch(raw: Record<string, unknown>): DashboardSearch {
  const { period, filters, tab } = fromSearch(raw)
  return toSearch(period, filters, tab)
}
