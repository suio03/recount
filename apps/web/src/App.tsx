import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, CircleUser, LogOut, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  api,
  type DateRange,
  type Dimension,
  type FilterKey,
  type Filters,
  type Me,
  type Scope,
  type Site,
} from './api'
import { BreakdownPanel } from './dashboard/BreakdownPanel'
import { FilterBar } from './dashboard/FilterBar'
import { FunnelPanel } from './dashboard/FunnelPanel'
import { readFilters } from './dashboard/filters'
import { GoalsPanel } from './dashboard/GoalsPanel'
import { Overview } from './dashboard/Overview'
import { PeriodPicker } from './dashboard/PeriodPicker'
import { type Period, readPeriod, resolve, writePeriod } from './dashboard/period'
import { ReadingPanel } from './dashboard/ReadingPanel'
import { SessionsPanel } from './dashboard/SessionsPanel'
import { Settings } from './Settings'
import { AcceptInvite, SignIn } from './SignIn'
import { NewSite, SiteSettings } from './SiteSettings'
import { SitesList } from './SitesList'
import { HostIcon } from './ui/HostIcon'
import { Switch } from './ui/Switch'

/** The realtime view refetches this often. */
const REALTIME_REFRESH_MS = 30_000
/** The live count beside the site's name refetches this often. */
const CURRENT_REFRESH_MS = 30_000

type View = 'sites' | 'dashboard' | 'settings' | 'site' | 'new-site'
const VIEWS: View[] = ['sites', 'dashboard', 'settings', 'site', 'new-site']

/** Site, period and filters live in the query string so a view can be reloaded and shared. */
function useUrlState() {
  const params = new URLSearchParams(window.location.search)
  // Without a site in the address, the list of sites opens first.
  const [view, setView] = useState<View>(
    () =>
      VIEWS.find((v) => v === params.get('view')) ?? (params.get('site') ? 'dashboard' : 'sites'),
  )
  const [domain, setDomain] = useState(params.get('site') ?? undefined)
  const [period, setPeriod] = useState<Period>(() => readPeriod(params))
  const [filters, setFilters] = useState<Filters>(() => readFilters(params))
  useEffect(() => {
    const next = new URLSearchParams()
    if (view !== 'dashboard' && view !== 'sites') next.set('view', view)
    if (domain && view !== 'sites') next.set('site', domain)
    writePeriod(period, next)
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value)
    window.history.replaceState(null, '', `?${next}${window.location.hash}`)
  }, [view, domain, period, filters])
  return {
    view,
    setView,
    domain,
    // Filter values belong to one site, so switching sites starts unfiltered. A site's settings
    // stay open on the next site.
    setDomain: (d: string | undefined, next?: View) => {
      setDomain(d)
      setFilters({})
      setView((v) => next ?? (v === 'site' ? 'site' : 'dashboard'))
    },
    period,
    setPeriod,
    filters,
    setFilter: (key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value })),
    removeFilter: (key: FilterKey) => setFilters(({ [key]: _, ...rest }) => rest),
    clearFilters: () => setFilters({}),
    replaceFilters: setFilters,
  }
}

/** An invite link carries its token after `#invite=`, which never reaches a server log. */
function useInviteToken() {
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? undefined,
  )
  const done = () => {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setToken(undefined)
  }
  return [token, done] as const
}

/** A public link opens /share/<token>: the dashboard without signing in. */
const shareToken = () => /^\/share\/([\w-]{20,})\/?$/.exec(window.location.pathname)?.[1]

export function App() {
  const [share] = useState(shareToken)
  if (share) return <Shared token={share} />
  return <Accounts />
}

function Accounts() {
  const [invite, inviteDone] = useInviteToken()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !invite })
  if (invite) return <AcceptInvite token={invite} onDone={inviteDone} />
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />
  if (me.isError) return <p className="p-6 text-muted">Could not load: {String(me.error)}</p>
  if (!me.data) return null
  return <SignedIn me={me.data} />
}

function SignedIn({ me }: { me: Me }) {
  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites })
  const state = useUrlState()
  const site = sites.data?.find((s) => s.domain === state.domain) ?? sites.data?.[0]
  const realtime = state.period.preset === 'realtime'
  const now = useClock(realtime ? REALTIME_REFRESH_MS : 60_000)
  // Resolved on every tick so presets roll over at midnight and realtime moves with the clock.
  const range = site && resolve(state.period, site.timezone, site.firstEvent, now)

  const canAdd = me.orgs.some((o) => o.role !== 'viewer')
  // Viewers cannot open a site's settings or add one, even from a shared link.
  const view =
    (state.view === 'site' && site?.role === 'viewer') || (state.view === 'new-site' && !canAdd)
      ? 'dashboard'
      : state.view
  const settings = view === 'settings'
  const dashboard = view === 'dashboard'
  const list = view === 'sites'
  // A new site opens on its install snippet.
  const openCreated = (created: Site) => state.setDomain(created.domain, 'site')
  return (
    <>
      <AppHeader>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => state.setView('sites')}
            title="All sites"
            className="cursor-pointer text-base font-semibold tracking-[-0.01em]"
          >
            Recount
          </button>
          {!settings && view !== 'new-site' && view !== 'sites' && (
            <>
              <span className="h-5 w-px bg-line" aria-hidden="true" />
              {sites.data && sites.data.length > 0 && site && (
                <SitePicker
                  sites={sites.data}
                  current={site}
                  onChange={state.setDomain}
                  onAdd={canAdd ? () => state.setView('new-site') : undefined}
                />
              )}
              {site && (
                <CurrentVisitors
                  site={{ siteId: site.id }}
                  onOpen={() => {
                    state.setView('dashboard')
                    state.setPeriod({ preset: 'realtime' })
                  }}
                />
              )}
              {site && site.role !== 'viewer' && <AiSwitch site={site} />}
              {site && site.role !== 'viewer' && (
                <button
                  type="button"
                  onClick={() => state.setView(view === 'site' ? 'dashboard' : 'site')}
                  aria-pressed={view === 'site'}
                  title="This site: install, goals and funnels, revenue, public link, delete"
                  className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-label font-medium text-muted hover:bg-sunken hover:text-ink aria-pressed:bg-sunken aria-pressed:text-ink"
                >
                  <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden="true" />
                  Site settings
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dashboard && site && range && (
            <PeriodPicker
              period={state.period}
              range={range}
              timezone={site.timezone}
              firstEvent={site.firstEvent}
              onChange={state.setPeriod}
            />
          )}
          {me.user && (
            <button
              type="button"
              onClick={() => state.setView(settings ? 'dashboard' : 'settings')}
              aria-label="Account"
              aria-pressed={settings}
              title="Your account: profile, team, API keys and usage"
              className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:bg-sunken aria-pressed:text-ink"
            >
              <CircleUser className="size-4" strokeWidth={1.75} />
            </button>
          )}
          <SignOut />
        </div>
      </AppHeader>

      {list && (
        <main className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-6 pb-12 sm:px-6">
          {sites.data && sites.data.length > 0 ? (
            <>
              <PageTitle
                title="Sites"
                detail="Visitors in the last 24 hours, against the 24 before"
              />
              <SitesList
                sites={sites.data}
                onOpen={(domain) => state.setDomain(domain, 'dashboard')}
                onSettings={(domain) => state.setDomain(domain, 'site')}
                onAdd={canAdd ? () => state.setView('new-site') : undefined}
              />
            </>
          ) : (
            <SitesView sites={sites} me={me} canAdd={canAdd} onCreated={openCreated} />
          )}
        </main>
      )}
      {!dashboard && !list && (
        <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-6 pb-12 sm:box-content sm:px-6">
          {settings && (
            <>
              <PageTitle title="Account" detail="Your profile, team, API keys and usage" />
              <Settings me={me} />
            </>
          )}
          {view === 'new-site' && <NewSite me={me} onCreated={openCreated} />}
          {view === 'site' && site && (
            <>
              <PageTitle title="Site settings" detail={site.domain} />
              <SiteSettings site={site} onDeleted={() => state.setDomain(undefined, 'sites')} />
            </>
          )}
        </main>
      )}
      {dashboard && (
        <main className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-4 pb-12 sm:px-6">
          <SitesView sites={sites} me={me} canAdd={canAdd} onCreated={openCreated} />
          <FilterBar
            filters={state.filters}
            onRemove={state.removeFilter}
            onClear={state.clearFilters}
          />
          {site && range && (
            <Dashboard
              key={site.id}
              site={site}
              range={range}
              realtime={realtime}
              filters={state.filters}
              onFilter={state.setFilter}
              onShow={state.replaceFilters}
            />
          )}
        </main>
      )}
    </>
  )
}

/**
 * The bar across the top of every signed-in and shared page, kept in view while scrolling so the
 * site, period and account stay at hand.
 */
function AppHeader({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-line border-b bg-canvas">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {children}
      </div>
    </header>
  )
}

function PageTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid gap-0.5 pb-1">
      <h1 className="m-0 text-title font-semibold tracking-[-0.01em]">{title}</h1>
      <p className="m-0 text-body text-muted">{detail}</p>
    </div>
  )
}

/** A site's public dashboard: the numbers, with no AI panels or recordings. */
function Shared({ token }: { token: string }) {
  const site = useQuery({
    queryKey: ['shared', token],
    queryFn: () => api.sharedSite(token),
    // A link that was turned off stays off.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 3,
  })
  const state = useUrlState()
  const realtime = state.period.preset === 'realtime'
  const now = useClock(realtime ? REALTIME_REFRESH_MS : 60_000)
  if (site.error instanceof ApiError && site.error.status === 404)
    return <p className="p-6 text-muted">This link is not shared any more.</p>
  if (site.isError) return <p className="p-6 text-muted">Could not load: {String(site.error)}</p>
  if (!site.data) return null
  const { domain, timezone, firstEvent } = site.data
  const range = resolve(state.period, timezone, firstEvent, now)
  return (
    <>
      <AppHeader>
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2 text-title font-semibold tracking-[-0.01em]">
            <HostIcon host={domain} share={token} className="size-5" />
            {domain}
          </span>
          <CurrentVisitors
            site={{ share: token }}
            onOpen={() => state.setPeriod({ preset: 'realtime' })}
          />
          <span className="text-label text-muted">Shared dashboard</span>
        </div>
        <PeriodPicker
          period={state.period}
          range={range}
          timezone={timezone}
          firstEvent={firstEvent}
          onChange={state.setPeriod}
        />
      </AppHeader>
      <main className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-4 pb-12 sm:px-6">
        <FilterBar
          filters={state.filters}
          onRemove={state.removeFilter}
          onClear={state.clearFilters}
        />
        <Dashboard
          site={{ id: token, timezone, ai: false, role: 'viewer' }}
          share={token}
          range={range}
          realtime={realtime}
          filters={state.filters}
          onFilter={state.setFilter}
          onShow={state.replaceFilters}
        />
        <footer className="pt-4 text-center text-label text-muted">
          Counted by{' '}
          <a
            href="https://github.com/suio03/recount"
            className="text-ink underline-offset-2 hover:underline"
          >
            Recount
          </a>
        </footer>
      </main>
    </>
  )
}

/** Why there is no dashboard yet, when the sites have not loaded or there are none. */
function SitesView({
  sites,
  me,
  canAdd,
  onCreated,
}: {
  sites: { isError: boolean; error: unknown; data?: Site[] }
  me: Me
  canAdd: boolean
  onCreated: (site: Site) => void
}) {
  if (sites.isError)
    return <p className="text-muted">Could not load sites: {String(sites.error)}</p>
  if (sites.data?.length !== 0) return null
  if (!canAdd) return <p className="text-muted">No sites yet. An admin of your team can add one.</p>
  // The first site: once added, its install snippet is shown in its settings.
  return <NewSite me={me} onCreated={onCreated} />
}

function SignOut() {
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => queryClient.resetQueries(),
  })
  return (
    <button
      type="button"
      onClick={() => signOut.mutate()}
      aria-label="Sign out"
      title="Sign out"
      className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink"
    >
      <LogOut className="size-4" strokeWidth={1.75} />
    </button>
  )
}

/** Per site, since a wiki or reference site rarely needs the model reading it. */
function AiSwitch({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const change = useMutation({
    mutationFn: (ai: boolean) => api.setAi(site.id, ai),
    onSuccess: (updated) => {
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      )
      for (const key of ['reading', 'replays', 'replayDigest'])
        queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
  return (
    <span title="The reading, replay summaries and the patterns across them. Off means no model calls for this site.">
      <Switch
        label="AI analysis"
        checked={change.isPending ? (change.variables ?? site.ai) : site.ai}
        disabled={change.isPending}
        onChange={(ai) => change.mutate(ai)}
      />
    </span>
  )
}

/** Not a domain, so it cannot collide with a site. */
const ADD = '+add'

function SitePicker({
  sites,
  current,
  onChange,
  onAdd,
}: {
  sites: Site[]
  current: Site
  onChange: (domain: string) => void
  /** Offers "Add a site" at the end of the list, for people who can. */
  onAdd?: () => void
}) {
  return (
    <label className="relative inline-flex items-center gap-2 text-title font-semibold tracking-[-0.01em]">
      <span className="sr-only">Site</span>
      <HostIcon host={current.domain} className="size-5" />
      <select
        className="cursor-pointer appearance-none rounded-sm bg-transparent pr-6 outline-none"
        value={current.domain}
        onChange={(e) => (e.target.value === ADD ? onAdd?.() : onChange(e.target.value))}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.domain}>
            {s.domain}
          </option>
        ))}
        {onAdd && <option value={ADD}>Add a site…</option>}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-0 size-4 text-muted"
        strokeWidth={1.75}
      />
    </label>
  )
}

/**
 * How many visitors had an event in the last five minutes, refetched while the tab is open.
 * Opens the realtime view, which shows what they are doing.
 */
function CurrentVisitors({
  site,
  onOpen,
}: {
  site: { siteId: string } | { share: string }
  onOpen: () => void
}) {
  const current = useQuery({
    queryKey: ['current', site],
    queryFn: () => api.current(site),
    refetchInterval: CURRENT_REFRESH_MS,
  })
  if (!current.data) return null
  const n = current.data.visitors
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Visitors in the last 5 minutes. Open the realtime view"
      className="inline-flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2 text-label font-medium text-muted tabular-nums hover:bg-sunken hover:text-ink"
    >
      <span className="relative flex size-2" aria-hidden="true">
        {n > 0 && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-60 motion-reduce:hidden" />
        )}
        <span className="relative inline-flex size-2 rounded-full bg-up" />
      </span>
      {n.toLocaleString()} current {n === 1 ? 'visitor' : 'visitors'}
    </button>
  )
}

/** The current time, updated every `ms`. */
function useClock(ms: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

function Dashboard({
  site,
  share,
  range,
  realtime,
  filters,
  onFilter,
  onShow,
}: {
  site: Pick<Site, 'id' | 'timezone' | 'ai' | 'role'>
  /** A public link's token: only the panels the link may show. */
  share?: string
  range: DateRange
  /** The last 30 minutes: no AI panels, since the window moves every refresh. */
  realtime: boolean
  filters: Filters
  onFilter: (key: FilterKey, value: string) => void
  onShow: (filters: Filters) => void
}) {
  const { from, to, since } = range
  const scope = useMemo<Scope>(
    () => ({ siteId: site.id, share, range: { from, to, since }, filters }),
    [site.id, share, from, to, since, filters],
  )
  const props = { scope, onFilter: (d: Dimension, value: string) => onFilter(d, value) }

  return (
    <>
      {realtime || share ? (
        <Overview scope={scope} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
          <Overview scope={scope} />
          {/* The overview sets the row height; a longer reading scrolls inside it. */}
          <div className="relative min-h-0">
            <ReadingPanel scope={scope} canEnable={site.role !== 'viewer'} onShow={onShow} />
          </div>
        </div>
      )}
      {site.ai && !realtime && (
        <SessionsPanel scope={scope} timezone={site.timezone} canRefresh={site.role !== 'viewer'} />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-3">
        <BreakdownPanel
          title="Acquisition"
          options={[
            { value: 'channel', label: 'Channel', column: 'Channel' },
            { value: 'referrer', label: 'Referrer', column: 'Referrer' },
            { value: 'campaign', label: 'Campaign', column: 'Campaign' },
          ]}
          initial="referrer"
          {...props}
        />
        <BreakdownPanel
          title="Pages"
          options={[
            { value: 'page', label: 'Top', column: 'Page' },
            { value: 'entry', label: 'Entry', column: 'Entry page' },
          ]}
          {...props}
        />
        <BreakdownPanel
          title="Locations"
          options={[{ value: 'country', label: 'Country', column: 'Country' }]}
          {...props}
        />
        <BreakdownPanel
          title="Devices"
          options={[
            { value: 'device', label: 'Device', column: 'Device' },
            { value: 'browser', label: 'Browser', column: 'Browser' },
            { value: 'os', label: 'OS', column: 'OS' },
          ]}
          {...props}
        />
        <GoalsPanel scope={scope} onFilter={(goal) => onFilter('goal', goal)} />
        <FunnelPanel scope={scope} />
      </div>
    </>
  )
}
