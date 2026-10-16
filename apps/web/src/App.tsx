import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ChevronDown, CircleUser, LogOut, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
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
import { Ask } from './dashboard/Ask'
import { BreakdownPanel } from './dashboard/BreakdownPanel'
import { Brief } from './dashboard/Brief'
import { FilterBar } from './dashboard/FilterBar'
import { FunnelPanel } from './dashboard/FunnelPanel'
import { GoalsPanel } from './dashboard/GoalsPanel'
import { Overview } from './dashboard/Overview'
import { Paths } from './dashboard/Paths'
import { PeriodPicker } from './dashboard/PeriodPicker'
import { type Period, resolve } from './dashboard/period'
import { SessionsPanel } from './dashboard/SessionsPanel'
import { fromSearch, toSearch } from './dashboard/search'
import { Traffic } from './dashboard/Traffic'
import { TriedToPay } from './dashboard/TriedToPay'
import { Settings } from './Settings'
import { AcceptInvite, SignIn } from './SignIn'
import { NewSite, SiteSettings } from './SiteSettings'
import { SitesList } from './SitesList'
import { HostIcon } from './ui/HostIcon'
import { Logo } from './ui/Logo'

/** The realtime view refetches this often. */
const REALTIME_REFRESH_MS = 30_000
/** The live count beside the site's name refetches this often. */
const CURRENT_REFRESH_MS = 30_000

export type View = 'sites' | 'dashboard' | 'settings' | 'site' | 'new-site'

/** The period and filters of the dashboard on this path, kept in the query string. */
function useDashboardSearch() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const { period, filters } = useMemo(() => fromSearch(search), [search])
  const go = (next: Period, nextFilters: Filters) =>
    navigate({ to: '.', search: toSearch(next, nextFilters) })
  return {
    period,
    setPeriod: (next: Period) => go(next, filters),
    filters,
    setFilter: (key: FilterKey, value: string) => go(period, { ...filters, [key]: value }),
    removeFilter: (key: FilterKey) => {
      const { [key]: _, ...rest } = filters
      go(period, rest)
    },
    clearFilters: () => go(period, {}),
    replaceFilters: (next: Filters) => go(period, next),
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

export function Accounts({ view }: { view: View }) {
  const [invite, inviteDone] = useInviteToken()
  const me = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !invite })
  if (invite) return <AcceptInvite token={invite} onDone={inviteDone} />
  if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />
  if (me.isError) return <p className="p-6 text-muted">Could not load: {String(me.error)}</p>
  if (!me.data) return null
  return <SignedIn me={me.data} view={view} />
}

function SignedIn({ me, view }: { me: Me; view: View }) {
  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites })
  const { domain } = useParams({ strict: false })
  const state = useDashboardSearch()
  const navigate = useNavigate()
  const site = domain ? sites.data?.find((s) => s.domain === domain) : undefined
  const realtime = state.period.preset === 'realtime'
  const now = useClock(realtime ? REALTIME_REFRESH_MS : 60_000)
  // Resolved on every tick so presets roll over at midnight and realtime moves with the clock.
  const range = site && resolve(state.period, site.timezone, site.firstEvent, now)

  const canAdd = me.orgs.some((o) => o.role !== 'viewer')
  // A site that is gone, or was never this team's, falls back to the list of sites.
  if (domain && sites.data && !site) return <Navigate to="/" replace />
  // Viewers cannot open a site's settings or add one, even from a shared link.
  if (view === 'site' && site?.role === 'viewer')
    return <Navigate to="/sites/$domain" params={{ domain: site.domain }} search={true} replace />
  if (view === 'new-site' && !canAdd) return <Navigate to="/" replace />

  const settings = view === 'settings'
  const dashboard = view === 'dashboard'
  const list = view === 'sites'
  // Filter values belong to one site, so another site starts unfiltered on the same period.
  const openSite = (next: string, page: 'dashboard' | 'site' = 'dashboard') =>
    navigate({
      to: page === 'site' ? '/sites/$domain/settings' : '/sites/$domain',
      params: { domain: next },
      search: toSearch(state.period, {}),
    })
  // A new site opens on its install snippet.
  const openCreated = (created: Site) => openSite(created.domain, 'site')
  const openNew = () => navigate({ to: '/new' })
  return (
    <>
      <TopBar>
        <Link
          to="/"
          title="All sites"
          className="flex cursor-pointer items-center gap-2.5 text-title font-semibold tracking-[-0.01em]"
        >
          <Logo className="size-7" />
          recount
        </Link>
        <AccountMenu name={me.user?.name} email={me.user?.email} current={settings} />
      </TopBar>
      {site && (dashboard || view === 'site') && (
        <SiteBar>
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex min-w-0 items-center gap-1">
              {sites.data && (
                <SitePicker
                  sites={sites.data}
                  current={site}
                  // A site's settings stay open on the next site.
                  onChange={(next) => openSite(next, view === 'site' ? 'site' : 'dashboard')}
                  onAdd={canAdd ? openNew : undefined}
                />
              )}
              {site.role !== 'viewer' && (
                <Link
                  to={view === 'site' ? '/sites/$domain' : '/sites/$domain/settings'}
                  params={{ domain: site.domain }}
                  search={true}
                  aria-label="Site settings"
                  aria-pressed={view === 'site'}
                  title="Site settings: install, goals and funnels, revenue, public link"
                  className="grid size-8 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:bg-sunken aria-pressed:text-ink"
                >
                  <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden="true" />
                </Link>
              )}
            </span>
            <CurrentVisitors
              site={{ siteId: site.id }}
              onOpen={() =>
                navigate({
                  to: '/sites/$domain',
                  params: { domain: site.domain },
                  search: toSearch({ preset: 'realtime' }, state.filters),
                })
              }
            />
          </div>
          {dashboard && range && (
            <PeriodPicker
              period={state.period}
              range={range}
              timezone={site.timezone}
              firstEvent={site.firstEvent}
              onChange={state.setPeriod}
            />
          )}
        </SiteBar>
      )}

      {list && (
        <main className="mx-auto flex max-w-[1360px] flex-col gap-4 px-4 pt-2 pb-16 sm:px-6 sm:pt-4">
          {sites.data && sites.data.length > 0 ? (
            <>
              <PageTitle
                title="Sites"
                detail="The last 30 days against a usual day, who tried to pay this week, and what needs a look"
              />
              <SitesList
                sites={sites.data}
                onOpen={(d) => openSite(d)}
                onSettings={(d) => openSite(d, 'site')}
                onAdd={canAdd ? openNew : undefined}
              />
            </>
          ) : (
            <SitesView sites={sites} me={me} canAdd={canAdd} onCreated={openCreated} />
          )}
        </main>
      )}
      {!dashboard && !list && (
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-4 pb-16 sm:box-content sm:px-6">
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
              <SiteSettings site={site} onDeleted={() => navigate({ to: '/' })} />
            </>
          )}
        </main>
      )}
      {dashboard && (
        <main className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-2 pb-16 sm:px-6">
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
              onShowDay={(day) => state.setPeriod({ preset: 'custom', from: day, to: day })}
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

/** The brand and the account, with room around them. Scrolls away with the page. */
function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="relative z-40 mx-auto flex max-w-[1360px] items-center justify-between gap-3 px-4 pt-6 pb-4 sm:px-6 sm:pt-8 sm:pb-6">
      {children}
    </header>
  )
}

/** The site and period, kept in view while scrolling on screens wide enough to spare the room. */
function SiteBar({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-30 bg-canvas sm:sticky sm:top-0">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        {children}
      </div>
    </div>
  )
}

function PageTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-2 grid gap-1 border-b border-line pb-5">
      <h1 className="m-0 text-kpi font-semibold">{title}</h1>
      <p className="m-0 text-body text-muted">{detail}</p>
    </div>
  )
}

/** A site's public dashboard: the numbers, with no AI panels or recordings. */
export function Shared() {
  const { token } = useParams({ from: '/share/$token' })
  const site = useQuery({
    queryKey: ['shared', token],
    queryFn: () => api.sharedSite(token),
    // A link that was turned off stays off.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status === 404) && failures < 3,
  })
  const state = useDashboardSearch()
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
      <div className="h-4 sm:h-6" aria-hidden="true" />
      <SiteBar>
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
      </SiteBar>
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

/** The signed-in person's account and signing out, kept in one menu. */
function AccountMenu({
  name,
  email,
  current,
}: {
  name?: string
  email?: string
  current: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const signOut = useMutation({
    mutationFn: api.signOut,
    onSuccess: () => queryClient.resetQueries(),
  })
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  const item =
    'flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-label hover:bg-sunken'
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={current}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-body font-medium hover:bg-sunken aria-expanded:bg-sunken aria-pressed:bg-sunken"
      >
        {name && <span className="hidden max-w-40 truncate sm:inline">{name}</span>}
        <CircleUser className="size-6 text-muted" strokeWidth={1.5} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-pop"
        >
          {email && (
            <p className="m-0 truncate border-b border-line px-3 pt-1 pb-2 text-label text-muted">
              {email}
            </p>
          )}
          {email && (
            <Link to="/account" role="menuitem" onClick={() => setOpen(false)} className={item}>
              <CircleUser className="size-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
              Account, team and usage
            </Link>
          )}
          <button type="button" role="menuitem" onClick={() => signOut.mutate()} className={item}>
            <LogOut className="size-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
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
    <label className="relative inline-flex min-w-0 items-center gap-2 text-title font-semibold tracking-[-0.01em]">
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
      className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm px-2 text-label font-medium text-muted tabular-nums hover:bg-sunken hover:text-ink"
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
  onShowDay,
}: {
  site: Pick<Site, 'id' | 'timezone' | 'ai' | 'role'> & { domain?: string }
  /** A public link's token: only the panels the link may show. */
  share?: string
  range: DateRange
  /** The last 30 minutes: no AI panels, since the window moves every refresh. */
  realtime: boolean
  filters: Filters
  onFilter: (key: FilterKey, value: string) => void
  onShow: (filters: Filters) => void
  /** Narrows the dashboard to one day; the shared dashboard has no day view. */
  onShowDay?: (day: string) => void
}) {
  const { from, to, since } = range
  const scope = useMemo<Scope>(
    () => ({ siteId: site.id, share, range: { from, to, since }, filters }),
    [site.id, share, from, to, since, filters],
  )
  const props = { scope, onFilter: (d: Dimension, value: string) => onFilter(d, value) }
  // The people who tried to pay are private to the team, and the realtime view has none.
  const full = !realtime && !share
  const intent = useQuery({
    queryKey: ['intent', scope],
    queryFn: () => api.intent(scope),
    placeholderData: (prev) => prev,
    enabled: full,
  })
  const paths = useQuery({
    queryKey: ['paths', scope],
    queryFn: () => api.paths(scope),
    placeholderData: (prev) => prev,
    enabled: full,
  })
  const why = site.ai ? { siteId: site.id, scope, canWrite: site.role !== 'viewer' } : undefined

  return (
    <>
      {full ? (
        <>
          <Brief
            key={`${from}-${to}`}
            site={site}
            scope={scope}
            canWrite={site.role !== 'viewer'}
            onShow={onShow}
          />
          {site.ai && (
            <Ask
              key={`ask-${from}-${to}`}
              siteId={site.id}
              scope={scope}
              canWrite={site.role !== 'viewer'}
            />
          )}
          <Traffic
            scope={scope}
            timezone={site.timezone}
            intent={intent.data}
            onFilter={props.onFilter}
            onShowDay={(day) => onShowDay?.(day)}
          />
          {intent.isError ? (
            <p className="text-muted">Could not load who tried to pay: {String(intent.error)}</p>
          ) : (
            <TriedToPay
              intent={intent.data}
              domain={site.domain}
              timezone={site.timezone}
              canEdit={site.role !== 'viewer'}
              why={why}
            />
          )}
          {paths.isError ? (
            <p className="text-muted">Could not load the paths: {String(paths.error)}</p>
          ) : (
            <Paths
              paths={paths.data}
              domain={site.domain}
              canEdit={site.role !== 'viewer'}
              why={why}
            />
          )}
        </>
      ) : (
        <Overview scope={scope} />
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
        <GoalsPanel scope={scope} onFilter={onFilter} />
        {/* Paths count the funnels per visitor in the full view. */}
        {!full && <FunnelPanel scope={scope} />}
      </div>
    </>
  )
}
