export type Role = 'owner' | 'admin' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
}

export interface Org {
  id: string
  name: string
  role: Role
}

/** The caller. Scripts with a token have no user; people always do. */
export interface Me {
  user: User | null
  orgs: Org[]
}

export interface Member extends User {
  role: Role
  joinedAt: string
}

export interface Invite {
  id: string
  email: string
  role: Role
  expiresAt: string
}

/** What an invite link is for. */
export interface InviteInfo {
  org: string
  email: string
  role: Role
  /** Whether the email already has an account, which then signs in instead of signing up. */
  hasAccount: boolean
}

export interface ApiKey {
  id: string
  name: string
  /** The key's first characters, to tell keys apart. */
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export interface Site {
  id: string
  orgId: string
  /** The caller's role in the org that owns the site. */
  role: Role
  domain: string
  name: string
  timezone: string
  currency: string
  /** Whether the model reads this site: the reading, replay summaries and their patterns. */
  ai: boolean
  /** ISO time of the site's first event, null before any; where "All time" starts. */
  firstEvent: string | null
}

/** Where a site's payments come from. */
export interface RevenueSource {
  id: string
  provider: 'paddle'
  /** The environment variable holding the key, for sources set up with the CLI. */
  keyEnv: string | null
  /** The last characters of a key entered in the dashboard. */
  keyHint: string | null
  match: Record<string, string>
  syncedAt: string | null
  lastError: string | null
  syncing: boolean
}

export interface RevenueSources {
  /** Whether the server can store keys, which needs ENCRYPTION_KEY. */
  canStoreKeys: boolean
  sources: RevenueSource[]
}

export type SiteChange = Partial<Pick<Site, 'name' | 'timezone' | 'currency' | 'ai'>>

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

/**
 * A failed request; status 401 means the browser is not signed in. The message is the API's
 * `error` text, which is written to be shown.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function failure(res: Response) {
  const text = await res.text()
  let message = text || res.statusText
  try {
    const error = (JSON.parse(text) as { error?: unknown }).error
    if (typeof error === 'string') message = error.replace(/^✖ /, '')
  } catch {}
  return new ApiError(res.status, message)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw await failure(res)
  return res.json() as Promise<T>
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await failure(res)
  return res.json() as Promise<T>
}

const del = (path: string) =>
  fetch(path, { method: 'DELETE' }).then(async (res) => {
    if (!res.ok) throw await failure(res)
  })

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
  createSite: (input: { domain: string; timezone: string; currency: string; org?: string }) =>
    send<Site>('POST', '/api/sites', input),
  updateSite: (siteId: string, change: SiteChange) =>
    send<Site>('PATCH', `/api/sites/${siteId}`, change),
  deleteSite: (siteId: string) => del(`/api/sites/${siteId}`),
  revenueSources: (siteId: string) => get<RevenueSources>(`/api/sites/${siteId}/revenue`),
  connectRevenue: (siteId: string, input: { key: string; match: Record<string, string> }) =>
    send<RevenueSource>('POST', `/api/sites/${siteId}/revenue`, { provider: 'paddle', ...input }),
  syncRevenue: (siteId: string, id: string) =>
    send<RevenueSource>('POST', `/api/sites/${siteId}/revenue/${id}/sync`, {}),
  disconnectRevenue: (siteId: string, id: string) => del(`/api/sites/${siteId}/revenue/${id}`),
  me: () => get<Me>('/api/me'),
  setupNeeded: () => get<{ needed: boolean }>('/api/setup'),
  setup: (input: { setupCode: string; email: string; name: string; password: string }) =>
    send<User>('POST', '/api/setup', input),
  signIn: (input: { email: string; password: string }) => send<User>('POST', '/api/login', input),
  signOut: () => send<{ ok: true }>('POST', '/api/logout', {}),
  updateMe: (change: { name?: string; password?: { current: string; next: string } }) =>
    send<User>('PATCH', '/api/me', change),
  invite: (token: string) => get<InviteInfo>(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, input: { password: string; name?: string }) =>
    send<{ orgId: string }>('POST', `/api/invites/${encodeURIComponent(token)}`, input),
  renameOrg: (orgId: string, name: string) => send<Org>('PATCH', `/api/orgs/${orgId}`, { name }),
  members: (orgId: string) =>
    get<{ members: Member[]; invites: Invite[] }>(`/api/orgs/${orgId}/members`),
  createInvite: (orgId: string, email: string, role: Role) =>
    send<Invite & { token: string }>('POST', `/api/orgs/${orgId}/invites`, { email, role }),
  deleteInvite: (orgId: string, id: string) => del(`/api/orgs/${orgId}/invites/${id}`),
  setRole: (orgId: string, userId: string, role: Role) =>
    send<{ ok: true }>('PATCH', `/api/orgs/${orgId}/members/${userId}`, { role }),
  removeMember: (orgId: string, userId: string) => del(`/api/orgs/${orgId}/members/${userId}`),
  keys: (orgId: string) => get<ApiKey[]>(`/api/orgs/${orgId}/keys`),
  createKey: (orgId: string, name: string) =>
    send<ApiKey & { key: string }>('POST', `/api/orgs/${orgId}/keys`, { name }),
  deleteKey: (orgId: string, id: string) => del(`/api/orgs/${orgId}/keys/${id}`),
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
