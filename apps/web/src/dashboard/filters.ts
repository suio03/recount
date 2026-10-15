import type { FilterKey, Filters } from '../api'
import { countryName } from './format'

export const FILTER_KEYS: readonly FilterKey[] = [
  'channel',
  'referrer',
  'campaign',
  'page',
  'entry',
  'country',
  'device',
  'browser',
  'os',
  'goal',
  'prop',
]

export const FILTER_LABELS: Record<FilterKey, string> = {
  channel: 'Channel',
  referrer: 'Referrer',
  campaign: 'Campaign',
  page: 'Page',
  entry: 'Entry page',
  country: 'Country',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  goal: 'Goal',
  prop: 'Property',
}

/** Values copied from the wire (paths, hosts, event names) are shown in mono. */
export const MONO_FILTERS = new Set<FilterKey>([
  'referrer',
  'campaign',
  'page',
  'entry',
  'goal',
  'prop',
])

/** A `prop` filter's value is `<key>=<value>`, as the API reads it. */
export const propertyFilterValue = (key: string, value: string) => `${key}=${value}`

export const filterValueLabel = (key: FilterKey, value: string) =>
  key === 'country' ? countryName(value) : key === 'prop' ? value.replace('=', ' = ') : value

export function readFilters(params: URLSearchParams): Filters {
  const filters: Filters = {}
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  return filters
}
