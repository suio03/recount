export interface Site {
  id: string
  domain: string
  name: string
  timezone: string
}

export interface DateRange {
  from: string
  to: string
}

export interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounce_rate: number
  avg_session_seconds: number
}

export interface MainStats {
  totals: Totals
  /** The same-length period just before the range. */
  previous: Totals
  series: Array<{ day: string; visitors: number; pageviews: number }>
}

export type Dimension =
  | 'channel'
  | 'referrer'
  | 'campaign'
  | 'page'
  | 'entry'
  | 'country'
  | 'device'
  | 'browser'
  | 'os'

export interface Breakdown {
  dimension: Dimension
  rows: Array<{ value: string; visitors: number }>
}

export interface Goals {
  goals: Array<{ name: string; visitors: number; events: number; previous_visitors: number }>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export type FilterKey = Dimension | 'goal'
export type Filters = Partial<Record<FilterKey, string>>

/** What every stats request is scoped to. Also used as the react-query key. */
export interface Scope {
  siteId: string
  range: DateRange
  filters: Filters
}

const stats = (scope: Scope, kind: string, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams({ ...scope.range, ...extra })
  for (const [key, value] of Object.entries(scope.filters)) if (value) params.set(key, value)
  return `/api/sites/${scope.siteId}/stats/${kind}?${params}`
}

export const api = {
  sites: () => get<Site[]>('/api/sites'),
  main: (scope: Scope) => get<MainStats>(stats(scope, 'main')),
  breakdown: (scope: Scope, dimension: Dimension, limit = 8) =>
    get<Breakdown>(stats(scope, 'breakdown', { dimension, limit: String(limit) })),
  goals: (scope: Scope) => get<Goals>(stats(scope, 'goals')),
}
