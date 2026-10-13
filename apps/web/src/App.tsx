import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type Dimension, type FilterKey, type Filters, type Scope, type Site } from './api'
import { BreakdownPanel } from './dashboard/BreakdownPanel'
import { FilterBar } from './dashboard/FilterBar'
import { readFilters } from './dashboard/filters'
import { lastDays, rangeLabel } from './dashboard/format'
import { GoalsPanel } from './dashboard/GoalsPanel'
import { Overview } from './dashboard/Overview'
import { ReadingPanel } from './dashboard/ReadingPanel'
import { SegmentedControl } from './ui/SegmentedControl'

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
] as const
type RangeKey = (typeof RANGES)[number]['value']

/** Site, range and filters live in the query string so a view can be reloaded and shared. */
function useUrlState() {
  const params = new URLSearchParams(window.location.search)
  const [domain, setDomain] = useState(params.get('site') ?? undefined)
  const [range, setRange] = useState<RangeKey>(
    RANGES.find((r) => r.value === params.get('range'))?.value ?? '30d',
  )
  const [filters, setFilters] = useState<Filters>(() => readFilters(params))
  useEffect(() => {
    const next = new URLSearchParams()
    if (domain) next.set('site', domain)
    next.set('range', range)
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value)
    window.history.replaceState(null, '', `?${next}`)
  }, [domain, range, filters])
  return {
    domain,
    // Filter values belong to one site, so switching sites starts unfiltered.
    setDomain: (d: string) => {
      setDomain(d)
      setFilters({})
    },
    range,
    setRange,
    filters,
    setFilter: (key: FilterKey, value: string) => setFilters((f) => ({ ...f, [key]: value })),
    removeFilter: (key: FilterKey) => setFilters(({ [key]: _, ...rest }) => rest),
    clearFilters: () => setFilters({}),
  }
}

export function App() {
  const sites = useQuery({ queryKey: ['sites'], queryFn: api.sites })
  const state = useUrlState()
  const site = sites.data?.find((s) => s.domain === state.domain) ?? sites.data?.[0]

  return (
    <div className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 pt-5 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 pb-2">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-base font-semibold tracking-[-0.01em]">Recount</span>
          <span className="h-5 w-px bg-line" aria-hidden="true" />
          {sites.data && sites.data.length > 0 && site && (
            <SitePicker sites={sites.data} current={site} onChange={state.setDomain} />
          )}
        </div>
        {site && (
          <RangePicker timezone={site.timezone} value={state.range} onChange={state.setRange} />
        )}
      </header>

      {sites.isError && <p className="text-muted">Could not load sites: {String(sites.error)}</p>}
      {sites.data?.length === 0 && (
        <p className="text-muted">
          No sites yet. Add one with <code className="font-mono text-path">POST /api/sites</code>,
          or run <code className="font-mono text-path">pnpm seed</code> for a demo site.
        </p>
      )}
      <FilterBar
        filters={state.filters}
        onRemove={state.removeFilter}
        onClear={state.clearFilters}
      />
      {site && (
        <Dashboard
          key={site.id}
          site={site}
          days={Number.parseInt(state.range, 10)}
          filters={state.filters}
          onFilter={state.setFilter}
        />
      )}
    </div>
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

function RangePicker({
  timezone,
  value,
  onChange,
}: {
  timezone: string
  value: RangeKey
  onChange: (r: RangeKey) => void
}) {
  const range = lastDays(Number.parseInt(value, 10), timezone)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-label text-muted">
        {rangeLabel(range)} · vs previous {Number.parseInt(value, 10)} days
      </span>
      <SegmentedControl label="Date range" options={RANGES} value={value} onChange={onChange} />
    </div>
  )
}

function Dashboard({
  site,
  days,
  filters,
  onFilter,
}: {
  site: Site
  days: number
  filters: Filters
  onFilter: (key: FilterKey, value: string) => void
}) {
  // Recomputed per render so the range rolls over at midnight in the site's timezone.
  const { from, to } = lastDays(days, site.timezone)
  const scope = useMemo<Scope>(
    () => ({ siteId: site.id, range: { from, to }, filters }),
    [site.id, from, to, filters],
  )
  const props = { scope, onFilter: (d: Dimension, value: string) => onFilter(d, value) }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <Overview scope={scope} />
        <ReadingPanel />
      </div>
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
