import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
import { readFilters } from './dashboard/filters'
import { GoalsPanel } from './dashboard/GoalsPanel'
import { Overview } from './dashboard/Overview'
import { PeriodPicker } from './dashboard/PeriodPicker'
import { type Period, readPeriod, resolve, writePeriod } from './dashboard/period'
import { ReadingPanel } from './dashboard/ReadingPanel'
import { SessionsPanel } from './dashboard/SessionsPanel'
import { Settings } from './Settings'
import { AcceptInvite, SignIn } from './SignIn'
import { Switch } from './ui/Switch'

/** The realtime view refetches this often. */
const REALTIME_REFRESH_MS = 30_000

type View = 'dashboard' | 'settings'

/** Site, period and filters live in the query string so a view can be reloaded and shared. */
function useUrlState() {
  const params = new URLSearchParams(window.location.search)
  const [view, setView] = useState<View>(
    params.get('view') === 'settings' ? 'settings' : 'dashboard',
  )
  const [domain, setDomain] = useState(params.get('site') ?? undefined)
  const [period, setPeriod] = useState<Period>(() => readPeriod(params))
  const [filters, setFilters] = useState<Filters>(() => readFilters(params))
  useEffect(() => {
    const next = new URLSearchParams()
    if (view !== 'dashboard') next.set('view', view)
    if (domain) next.set('site', domain)
    writePeriod(period, next)
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value)
    window.history.replaceState(null, '', `?${next}${window.location.hash}`)
  }, [view, domain, period, filters])
  return {
    view,
    setView,
    domain,
    // Filter values belong to one site, so switching sites starts unfiltered.
    setDomain: (d: string) => {
      setDomain(d)
      setFilters({})
      setView('dashboard')
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

export function App() {
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

  const settings = state.view === 'settings'
  const canAdd = me.orgs.some((o) => o.role !== 'viewer')
  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-5 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => state.setView('dashboard')}
            className="cursor-pointer text-base font-semibold tracking-[-0.01em]"
          >
            Recount
          </button>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          {settings ? (
            <span className="text-title font-semibold tracking-[-0.01em]">Settings</span>
          ) : (
            <>
              {sites.data && sites.data.length > 0 && site && (
                <SitePicker sites={sites.data} current={site} onChange={state.setDomain} />
              )}
              {site && site.role !== 'viewer' && <AiSwitch site={site} />}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!settings && site && range && (
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
              aria-label="Settings"
              aria-pressed={settings}
              title="Account, team and API keys"
              className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:bg-sunken aria-pressed:text-ink"
            >
              <SettingsIcon className="size-4" strokeWidth={1.75} />
            </button>
          )}
          <SignOut />
        </div>
      </header>

      {settings ? <Settings me={me} /> : <SitesView sites={sites} canAdd={canAdd} />}
      {!settings && (
        <FilterBar
          filters={state.filters}
          onRemove={state.removeFilter}
          onClear={state.clearFilters}
        />
      )}
      {!settings && site && range && (
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
    </div>
  )
}

/** Why there is no dashboard yet, when the sites have not loaded or there are none. */
function SitesView({
  sites,
  canAdd,
}: {
  sites: { isError: boolean; error: unknown; data?: Site[] }
  canAdd: boolean
}) {
  if (sites.isError)
    return <p className="text-muted">Could not load sites: {String(sites.error)}</p>
  if (sites.data?.length !== 0) return null
  return (
    <p className="text-muted">
      {canAdd ? (
        <>
          No sites yet. Add one with <code className="font-mono text-path">POST /api/sites</code>{' '}
          and an API key from Settings.
        </>
      ) : (
        'No sites yet. An admin of your team can add one.'
      )}
    </p>
  )
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
        all?.map((s) => (s.id === updated.id ? updated : s)),
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

function SitePicker({
  sites,
  current,
  onChange,
}: {
  sites: Site[]
  current: Site
  onChange: (domain: string) => void
}) {
  return (
    <label className="relative inline-flex items-center gap-1.5 text-title font-semibold tracking-[-0.01em]">
      <span className="sr-only">Site</span>
      <select
        className="cursor-pointer appearance-none rounded-sm bg-transparent pr-6 outline-none"
        value={current.domain}
        onChange={(e) => onChange(e.target.value)}
      >
        {sites.map((s) => (
          <option key={s.id} value={s.domain}>
            {s.domain}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-0 size-4 text-muted"
        strokeWidth={1.75}
      />
    </label>
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
  range,
  realtime,
  filters,
  onFilter,
  onShow,
}: {
  site: Site
  range: DateRange
  /** The last 30 minutes: no AI panels, since the window moves every refresh. */
  realtime: boolean
  filters: Filters
  onFilter: (key: FilterKey, value: string) => void
  onShow: (filters: Filters) => void
}) {
  const { from, to, since } = range
  const scope = useMemo<Scope>(
    () => ({ siteId: site.id, range: { from, to, since }, filters }),
    [site.id, from, to, since, filters],
  )
  const props = { scope, onFilter: (d: Dimension, value: string) => onFilter(d, value) }

  return (
    <>
      {realtime ? (
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
      {site.ai && !realtime && <SessionsPanel scope={scope} timezone={site.timezone} />}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] gap-3">
        <BreakdownPanel
          title="Acquisition"
          options={[
            { value: 'channel', label: 'Channel', column: 'Channel' },
            { value: 'referrer', label: 'Referrer', column: 'Referrer' },
            { value: 'campaign', label: 'Campaign', column: 'Campaign' },
          ]}
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
      </div>
    </>
  )
}
