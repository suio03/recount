export interface Site {
  id: string
  domain: string
  name: string
  timezone: string
  currency: string
  /** Whether the model reads this site: the reading, replay summaries and their patterns. */
  ai: boolean
  /** ISO time of the site's first event, null before any; where "All time" starts. */
  firstEvent: string | null
}

export interface DateRange {
  from: string
  to: string
  /** Unix milliseconds; narrows the days to events since then, for the realtime view. */
  since?: number
}

/** How finely the chart buckets the range. */
export type Interval = 'minute' | 'hour' | 'day' | 'month'

export interface Totals {
  visitors: number
  sessions: number
  pageviews: number
  bounce_rate: number
  avg_session_seconds: number
  /** Minor units of the site's currency, net of refunds. */
  revenue: number
  payments: number
  customers: number
}

export interface MainStats {
  currency: string
  totals: Totals
  /** The same-length period just before the range. */
  previous: Totals
  interval: Interval
  /** `t` is the bucket in the site's timezone: `YYYY-MM-DD`, or `YYYY-MM-DD hh:mm:ss`. */
  series: Array<{ t: string; visitors: number; pageviews: number; revenue: number }>
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
  currency: string
  /** Revenue is absent for pages, which share their sessions' payments. */
  rows: Array<{ value: string; visitors: number; revenue?: number }>
}

export interface Goals {
  goals: Array<{ name: string; visitors: number; events: number; previous_visitors: number }>
}

export type Metric =
  | 'visitors'
  | 'pageviews'
  | 'bounce_rate'
  | 'avg_session_seconds'
  | 'conversion_rate'
  | 'revenue'

/** One detected change. Numbers come from the database; the reading only cites them. */
export interface Finding {
  id: string
  subject:
    | { kind: 'total' }
    | { kind: 'segment'; dimension: Exclude<Dimension, 'page'>; value: string }
    | { kind: 'goal'; name: string }
    | {
        kind: 'segment_goal'
        dimension: Exclude<Dimension, 'page'>
        value: string
        name: string
      }
  metric: Metric
  current: number
  previous: number
  change: number | null
  share?: number
  /** For a segment's conversion rate: the rate among all visitors in scope. */
  baseline?: number
  /** For revenue: the currency `current` and `previous` are minor units of. */
  currency?: string
  since?: string
  filters: Filters
}

export interface ReadingResult {
  findings: Finding[]
  reading: {
    headline: string
    claims: Array<{ text: string; evidence: string[] }>
    model: string
    generatedAt: string
  } | null
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'error'
  error?: string
}

export type ReplayReason =
  | 'paid'
  | 'abandoned_form'
  | 'error'
  | 'rage_click'
  | 'dead_clicks'
  | 'key_event'

export type ReplayOutcome =
  | 'purchased'
  | 'converted'
  | 'gave_up'
  | 'stuck'
  | 'browsed'
  | 'left_quickly'

export interface ReplaySession {
  id: string
  startedAt: string
  reasons: ReplayReason[]
  summary: {
    headline: string
    intent: string
    outcome: ReplayOutcome
    /** `t` is milliseconds from the start of the recording. */
    moments: Array<{ t: number; kind: 'friction' | 'intent' | 'progress'; text: string }>
  }
  entry: string
  channel: string
  referrer: string
  country: string
  device: string
  browser: string
  duration: number
  pages: number
  revenue: number
}

export interface Replays {
  currency: string
  /** Recorded sessions in scope, summarized or not. */
  recorded: number
  sessions: ReplaySession[]
}

export interface ReplayDigest {
  digest: {
    headline: string
    patterns: Array<{
      kind: 'friction' | 'intent' | 'progress'
      title: string
      text: string
      /** Distinct sessions the pattern rests on. */
      sessions: number
      /** `t` is where the cited moment happens; null cites the whole visit. */
      evidence: Array<{ session: string; t: number | null }>
    }>
  } | null
  /** Summarized sessions the digest reads. */
  sessions: number
  status: 'ok' | 'off' | 'too_few' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'error'
  error?: string
  generatedAt?: string
}

/** A failed request; status 401 means the browser is not signed in. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`${status} ${message}`)
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new ApiError(res.status, await res.text())
  return res.json() as Promise<T>
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ApiError(res.status, await res.text())
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
  const { from, to, since } = scope.range
  const params = new URLSearchParams({ from, to, ...extra })
  if (since !== undefined) params.set('since', String(since))
  for (const [key, value] of Object.entries(scope.filters)) if (value) params.set(key, value)
  return `/api/sites/${scope.siteId}/stats/${kind}?${params}`
}

export const api = {
  sites: () => get<Site[]>('/api/sites'),
  setAi: (siteId: string, ai: boolean) => send<Site>('PATCH', `/api/sites/${siteId}`, { ai }),
  signIn: (token: string) => send<{ ok: true }>('POST', '/api/login', { token }),
  signOut: () => send<{ ok: true }>('POST', '/api/logout', {}),
  main: (scope: Scope) => get<MainStats>(stats(scope, 'main')),
  breakdown: (scope: Scope, dimension: Dimension, limit = 8) =>
    get<Breakdown>(stats(scope, 'breakdown', { dimension, limit: String(limit) })),
  goals: (scope: Scope) => get<Goals>(stats(scope, 'goals')),
  reading: (scope: Scope, refresh = false) =>
    get<ReadingResult>(stats(scope, 'reading', refresh ? { refresh: '1' } : {})),
  replays: (scope: Scope) => get<Replays>(stats(scope, 'replays')),
  replayDigest: (scope: Scope, refresh = false) =>
    get<ReplayDigest>(stats(scope, 'replays/digest', refresh ? { refresh: '1' } : {})),
  recording: (siteId: string, session: string) =>
    get<{ events: unknown[] }>(`/api/sites/${siteId}/replays/${session}`),
}
