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

/** What a custom event means, as a person or a coding agent defined it. */
export interface EventDefinition {
  name: string
  description: string
  stage: 'acquisition' | 'activation' | 'conversion' | 'retention' | 'referral' | null
  key: boolean
  properties: Record<string, { type: 'string' | 'number' | 'boolean'; description: string }>
  /** `key:<name>` for an API key, or a person's email. */
  definedBy: string
  createdAt: string
  updatedAt: string
}

/** Where coding agents find the rules and the MCP server, and what they have defined. */
export interface AgentSetup {
  rules: string
  mcp: string
  /** Lines for the project's AGENTS.md. */
  snippet: string
  events: EventDefinition[]
}

/** `admin` acts as an admin of the team; `agent` is for coding agents; `ingest` sends server events. */
export type KeyScope = 'admin' | 'agent' | 'ingest'

export interface ApiKey {
  id: string
  name: string
  scope: KeyScope
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
  /** Whether the model reads this site: the brief, replay summaries and their patterns. */
  ai: boolean
  /** ISO time of the site's first event, null before any; where "All time" starts. */
  firstEvent: string | null
  /** Opens the public read-only dashboard at /share/<token>. Null when off, and for viewers. */
  shareToken: string | null
  /** How often the model drafts the site's goals and funnels. */
  draftSchedule: 'off' | 'daily' | 'weekly'
  /** Whether a draft's new goals and funnels are added on their own or wait for review. */
  draftApply: 'review' | 'auto'
  /** Which custom events mean activating and paying; null while they are guessed from names. */
  keyEvents: KeyEvents | null
}

/** Custom events by what they mean for the activation and payment figures. */
export interface KeyEvents {
  activation: string[]
  start: string[]
  paid: string[]
  failed: string[]
  closed: string[]
}

export interface KeyEventsSetup {
  events: KeyEvents
  /** Whether `events` were guessed from the names rather than set. */
  guessed: boolean
  /** Custom events of the last 90 days. */
  names: string[]
}

/** A site's last 24 hours, for the sites list. */
export interface SiteActivity {
  siteId: string
  visitors: number
  /** Visitors in the 24 hours before. */
  previous: number
  /** Visitors per hour, oldest first. */
  series: number[]
}

/**
 * Where a host's icon is served, fetched once by the server and stored there. A public link asks
 * through its token, since its viewers are not signed in.
 */
export const iconUrl = (host: string, share?: string) =>
  share
    ? `/api/share/${encodeURIComponent(share)}/icons/${encodeURIComponent(host)}`
    : `/api/icons/${encodeURIComponent(host)}`

/** What one site used in a month. Model calls of a deleted site have no site. */
export interface SiteUsage {
  siteId: string | null
  domain: string | null
  pageviews: number
  recordings: number
  aiCalls: number
  /** In millionths of a US dollar. */
  aiCostMicros: number
}

export interface Usage {
  /** `YYYY-MM`, in UTC. */
  month: string
  sites: SiteUsage[]
  /** Today's model spend (UTC) against the daily budget, both in micros. */
  ai: { todayMicros: number; dailyBudgetMicros: number }
}

/** A site as its public link shows it. */
export interface SharedSite {
  domain: string
  name: string
  timezone: string
  currency: string
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

export type SiteChange = Partial<
  Pick<Site, 'name' | 'timezone' | 'currency' | 'ai' | 'draftSchedule' | 'draftApply' | 'keyEvents'>
>

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
  /** The median day's visitors over the 28 days before the range; null with too little data. */
  usual?: number | null
  /** Visitors today so far, when the range reaches today. */
  today?: number | null
}

/** What an event means for paying: a key event's kind, or a look at pricing or upgrading. */
export type PayRole = keyof KeyEvents | 'interest'

export interface TrailEvent {
  name: string
  /** Unix milliseconds of the first of `n` in a row. */
  at: number
  n: number
  role?: PayRole
  /** Whether the name reads as something going wrong. */
  fault: boolean
}

export type Ending = 'paid' | 'failed' | 'closed' | 'none'

/** A visitor who tried to pay, as of their first visit in range. */
export interface PayingVisitor {
  visitor: string
  /** Unix milliseconds of their last payment event. */
  last: number
  channel: string
  referrer: string
  entry: string
  country: string
  device: string
  browser: string
  visits: number
  pageviews: number
  /** Minor units paid in range, from a connected payment provider. */
  amount: number
  ending: Ending
  trail: TrailEvent[]
}

export interface IntentCounts {
  activated: number
  tried: number
  paid: number
}

export interface Intent extends Omit<KeyEventsSetup, 'names'> {
  /** Whether a payment provider is connected, which then counts what was paid. */
  provider: boolean
  currency: string
  totals: IntentCounts
  previous: IntentCounts
  /** Buckets in which somebody tried to pay, as in the main series. */
  series: Array<{ t: string; tried: number }>
  /** The latest who tried, newest first. */
  people: PayingVisitor[]
}

export type StepKind = 'page' | 'click' | 'event'

/** A funnel counted per visitor across the range. */
export interface Lane {
  name: string
  /** A funnel someone defined or applied, or one only drafted and waiting for review. */
  source: 'funnel' | 'draft'
  id?: string
  steps: Array<{ name: string; kind: StepKind; visitors: number; previous: number }>
  /** Failures and give-ups among the visitors who started the lane. */
  side: Array<{ name: string; visitors: number }>
}

/** A custom event that fired almost every day and then stopped. */
export interface QuietEvent {
  name: string
  /** Full days at zero, up to the last full day. */
  days: number
  /** The last day it fired. */
  last: string
  /** Days it fired on, of the 14 before it stopped. */
  active: number
  perDay: number
  /** The last 7 full days, oldest first. */
  recent: number[]
}

export interface Paths {
  lanes: Lane[]
  /** The custom events, when there are no lanes. */
  events: Array<{ name: string; visitors: number; previous: number }> | null
  /** Whether AI analysis is on, which drafts lanes. */
  ai: boolean
  quiet: QuietEvent[]
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

/**
 * What a goal or funnel step matches. Page paths take `*` for any characters; unset click fields
 * match anything.
 */
export type Match =
  | { kind: 'event'; name: string }
  | { kind: 'page'; path: string }
  | { kind: 'click'; text?: string; section?: string; page?: string; href?: string }

export type GoalMatch = Exclude<Match, { kind: 'event' }>

/** A goal defined by a rule. Custom events are goals without being defined. */
export interface GoalDefinition {
  id: string
  name: string
  match: GoalMatch
  /** Added from a draft rather than by a person. */
  drafted: boolean
}

export interface FunnelStep {
  name: string
  match: Match
}

export interface FunnelDefinition {
  id: string
  name: string
  steps: FunnelStep[]
  drafted: boolean
}

/**
 * Where a drafted goal or funnel stands: `event` for a custom event, a goal already; `added`
 * when one with its name or rule exists (`as` names it); `taken` when its name is used by a
 * different rule; `dismissed` when a person removed or turned it down; `new` otherwise.
 */
export type DraftItemStatus = 'new' | 'added' | 'taken' | 'dismissed' | 'event'

export interface SemanticDraft {
  about: string
  conversions: Array<{
    name: string
    primary: boolean
    why: string
    match: Match
    visitors: number
    status: DraftItemStatus
    as?: string
  }>
  funnels: Array<{
    name: string
    why: string
    steps: Array<{ name: string; match: Match; visitors: number }>
    status: DraftItemStatus
    as?: string
  }>
  /** `signal` is the id of the blind spot a gap starts from, null for a guess; older drafts have neither. */
  gaps: Array<{ title: string; why: string; code: string; signal?: string | null }>
  /** Blind spots found in the data: something visitors do that the events do not show. */
  signals?: Array<{ id: string; kind: string; text: string }>
  dropped: string[]
  model: string
  generatedAt: string
}

export interface Semantics {
  drafting: boolean
  /** Whether the server has a model key. */
  configured: boolean
  latest: {
    id: string
    createdAt: string
    range: { from: string; to: string }
    /** Why no draft could be made, such as too few visitors. */
    error: string | null
    draft: SemanticDraft | null
  } | null
}

export interface Goals {
  goals: Array<{
    name: string
    kind: Match['kind']
    visitors: number
    events: number
    previous_visitors: number
  }>
}

/** The property names a custom event carries, with the visitors and events carrying each. */
export interface EventProperties {
  event: string
  events: number
  properties: Array<{ key: string; visitors: number; events: number }>
}

/** One property's top values, and its distribution over events when every value is a number. */
export interface EventProperty {
  event: string
  key: string
  /** Events and visitors carrying the property, and how many values it takes. */
  events: number
  visitors: number
  distinct: number
  values: Array<{ value: string; visitors: number; events: number }>
  distribution: {
    min: number
    p25: number
    median: number
    p75: number
    max: number
    /** Events per bin; a bin covers `from` up to, not including, `to`. */
    bins: Array<{ from: number; to: number; events: number }>
  } | null
}

/** Visitors who reached each step in order on any of their visits, now and in the previous period. */
export interface FunnelStats {
  id: string
  name: string
  steps: Array<{ name: string; kind: Match['kind']; visitors: number; previous_visitors: number }>
}

/** Where a line of the brief is shown on the dashboard. */
export type BriefSection = 'traffic' | 'tried' | 'paths' | 'quiet'

/** A few lines on the range, written only when someone asks; every figure comes from a query. */
export interface BriefResult {
  brief: {
    range: { from: string; to: string }
    lines: Array<{
      kind: 'fact' | 'guess'
      text: string
      section: BriefSection
      /** Filters that show the line, for one resting on a detected change. */
      filters?: Filters
    }>
    model: string
    generatedAt: string
  } | null
  /** Whether a brief can be written, or why the last try failed. */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

/** What "Why?" is asked about: one lane of the paths, or one visitor who tried to pay. */
export type WhySubject = { lane: string } | { visitor: string }

/** A few lines on why a lane or a visitor's try went the way it did, each a fact or a guess. */
export interface WhyResult {
  answer: {
    range: { from: string; to: string }
    lines: Array<{ kind: 'fact' | 'guess'; text: string }>
    model: string
    generatedAt: string
  } | null
  status: BriefResult['status']
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
  status:
    | 'ok'
    | 'off'
    | 'too_few'
    | 'unconfigured'
    | 'key_rejected'
    | 'no_credit'
    | 'over_budget'
    | 'error'
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

export type FilterKey = Dimension | 'goal' | 'prop'
export type Filters = Partial<Record<FilterKey, string>>

/** What every stats request is scoped to. Also used as the react-query key. */
export interface Scope {
  siteId: string
  /** Set on a public link: stats come from the link instead of a signed-in site. */
  share?: string
  range: DateRange
  filters: Filters
}

const stats = (scope: Scope, kind: string, extra: Record<string, string> = {}) => {
  const { from, to, since } = scope.range
  const params = new URLSearchParams({ from, to, ...extra })
  if (since !== undefined) params.set('since', String(since))
  for (const [key, value] of Object.entries(scope.filters)) if (value) params.set(key, value)
  const base = scope.share ? `/api/share/${scope.share}` : `/api/sites/${scope.siteId}`
  return `${base}/stats/${kind}?${params}`
}

export const api = {
  sites: () => get<Site[]>('/api/sites'),
  activity: () => get<SiteActivity[]>('/api/activity'),
  setAi: (siteId: string, ai: boolean) => send<Site>('PATCH', `/api/sites/${siteId}`, { ai }),
  createSite: (input: { domain: string; timezone: string; currency: string; org?: string }) =>
    send<Site>('POST', '/api/sites', input),
  updateSite: (siteId: string, change: SiteChange) =>
    send<Site>('PATCH', `/api/sites/${siteId}`, change),
  deleteSite: (siteId: string) => del(`/api/sites/${siteId}`),
  share: (siteId: string) => send<Site>('PUT', `/api/sites/${siteId}/share`, {}),
  unshare: (siteId: string) =>
    fetch(`/api/sites/${siteId}/share`, { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) throw await failure(res)
      return res.json() as Promise<Site>
    }),
  /** Visitors in the last few minutes, by site id or a public link's token. */
  current: (site: { siteId: string } | { share: string }) =>
    get<{ visitors: number }>(
      'share' in site
        ? `/api/share/${encodeURIComponent(site.share)}/current`
        : `/api/sites/${site.siteId}/current`,
    ),
  sharedSite: (token: string) => get<SharedSite>(`/api/share/${encodeURIComponent(token)}/site`),
  revenueSources: (siteId: string) => get<RevenueSources>(`/api/sites/${siteId}/revenue`),
  connectRevenue: (siteId: string, input: { key: string; match: Record<string, string> }) =>
    send<RevenueSource>('POST', `/api/sites/${siteId}/revenue`, { provider: 'paddle', ...input }),
  syncRevenue: (siteId: string, id: string) =>
    send<RevenueSource>('POST', `/api/sites/${siteId}/revenue/${id}/sync`, {}),
  disconnectRevenue: (siteId: string, id: string) => del(`/api/sites/${siteId}/revenue/${id}`),
  definedGoals: (siteId: string) =>
    get<{ goals: GoalDefinition[]; events: string[] }>(`/api/sites/${siteId}/goals`),
  createGoal: (siteId: string, input: { name: string; match: GoalMatch }) =>
    send<GoalDefinition>('POST', `/api/sites/${siteId}/goals`, input),
  deleteGoal: (siteId: string, id: string) => del(`/api/sites/${siteId}/goals/${id}`),
  definedFunnels: (siteId: string) => get<FunnelDefinition[]>(`/api/sites/${siteId}/funnels`),
  createFunnel: (siteId: string, input: { name: string; steps: FunnelStep[] }) =>
    send<FunnelDefinition>('POST', `/api/sites/${siteId}/funnels`, input),
  deleteFunnel: (siteId: string, id: string) => del(`/api/sites/${siteId}/funnels/${id}`),
  keyEvents: (siteId: string) => get<KeyEventsSetup>(`/api/sites/${siteId}/key-events`),
  semantics: (siteId: string) => get<Semantics>(`/api/sites/${siteId}/semantics`),
  agents: (siteId: string) => get<AgentSetup>(`/api/sites/${siteId}/agents`),
  deleteDefinition: (siteId: string, name: string) =>
    del(`/api/sites/${siteId}/agents/events/${encodeURIComponent(name)}`),
  draftSemantics: (siteId: string) =>
    send<Semantics>('POST', `/api/sites/${siteId}/semantics/draft`, {}),
  applyDrafted: (siteId: string, kind: 'goal' | 'funnel', name: string) =>
    send<Semantics>('POST', `/api/sites/${siteId}/semantics/apply`, { kind, name }),
  dismissDrafted: (siteId: string, kind: 'goal' | 'funnel', name: string) =>
    send<Semantics>('POST', `/api/sites/${siteId}/semantics/dismiss`, { kind, name }),
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
  usage: (orgId: string, month: string) => get<Usage>(`/api/orgs/${orgId}/usage?month=${month}`),
  keys: (orgId: string) => get<ApiKey[]>(`/api/orgs/${orgId}/keys`),
  createKey: (orgId: string, name: string, scope: KeyScope) =>
    send<ApiKey & { key: string }>('POST', `/api/orgs/${orgId}/keys`, { name, scope }),
  deleteKey: (orgId: string, id: string) => del(`/api/orgs/${orgId}/keys/${id}`),
  main: (scope: Scope) => get<MainStats>(stats(scope, 'main')),
  breakdown: (scope: Scope, dimension: Dimension, limit = 8) =>
    get<Breakdown>(stats(scope, 'breakdown', { dimension, limit: String(limit) })),
  goals: (scope: Scope) => get<Goals>(stats(scope, 'goals')),
  intent: (scope: Scope) => get<Intent>(stats(scope, 'intent')),
  paths: (scope: Scope) => get<Paths>(stats(scope, 'paths')),
  properties: (scope: Scope, event: string) =>
    get<EventProperties>(stats(scope, 'properties', { event })),
  property: (scope: Scope, event: string, key: string, limit = 10) =>
    get<EventProperty>(stats(scope, 'property', { event, key, limit: String(limit) })),
  funnels: (scope: Scope) =>
    get<{ funnels: Array<{ id: string; name: string }> }>(stats(scope, 'funnels')),
  funnel: (scope: Scope, id: string) => get<FunnelStats>(stats(scope, 'funnel', { id })),
  brief: (scope: Scope) => get<BriefResult>(stats(scope, 'brief')),
  writeBrief: (scope: Scope) => send<BriefResult>('POST', stats(scope, 'brief'), {}),
  why: (scope: Scope, subject: WhySubject) => get<WhyResult>(stats(scope, 'why', subject)),
  writeWhy: (scope: Scope, subject: WhySubject) =>
    send<WhyResult>('POST', stats(scope, 'why', subject), {}),
  replays: (scope: Scope) => get<Replays>(stats(scope, 'replays')),
  replayDigest: (scope: Scope, refresh = false) =>
    get<ReplayDigest>(stats(scope, 'replays/digest', refresh ? { refresh: '1' } : {})),
  recording: (siteId: string, session: string) =>
    get<{ events: unknown[] }>(`/api/sites/${siteId}/replays/${session}`),
}
