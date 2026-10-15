import { useQuery } from '@tanstack/react-query'
import { Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Site, type SiteActivity } from './api'
import { cx } from './ui/cx'
import { change, Delta } from './ui/Delta'
import { Button, inputClass } from './ui/Form'
import { HostIcon } from './ui/HostIcon'

/** Refetched this often while the list is open. */
const ACTIVITY_REFRESH_MS = 60_000

/**
 * Every site the person can see, each with its last 24 hours: visitors, the change from the 24
 * hours before, and visitors per hour. Opening one shows its dashboard.
 */
export function SitesList({
  sites,
  onOpen,
  onSettings,
  onAdd,
}: {
  sites: Site[]
  onOpen: (domain: string) => void
  onSettings: (domain: string) => void
  /** Set for people who can add a site. */
  onAdd?: () => void
}) {
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: api.activity,
    refetchInterval: ACTIVITY_REFRESH_MS,
  })
  const byId = useMemo(() => new Map(activity.data?.map((a) => [a.siteId, a])), [activity.data])
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  // "/" focuses the search, as in most lists of this kind.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        search.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const needle = query.trim().toLowerCase()
  const shown = sites.filter(
    (s) => !needle || s.domain.includes(needle) || s.name.toLowerCase().includes(needle),
  )

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full sm:w-72">
          <span className="sr-only">Search sites</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder="Press / to search sites"
            className={cx(inputClass, 'w-full pl-8')}
          />
        </label>
        {onAdd && (
          <Button onClick={onAdd} className="inline-flex items-center gap-1.5">
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Add a site
          </Button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">No site matches “{query.trim()}”.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3 p-0">
          {shown.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              activity={byId.get(site.id)}
              loading={activity.isPending}
              onOpen={() => onOpen(site.domain)}
              onSettings={site.role === 'viewer' ? undefined : () => onSettings(site.domain)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SiteCard({
  site,
  activity,
  loading,
  onOpen,
  onSettings,
}: {
  site: Site
  activity?: SiteActivity
  loading: boolean
  onOpen: () => void
  onSettings?: () => void
}) {
  const delta = activity && change(activity.visitors, activity.previous)
  return (
    <li className="group relative grid gap-3 rounded-md border border-line bg-surface p-4 hover:border-line-strong">
      <div className="flex min-w-0 items-center gap-2.5 pr-8">
        <HostIcon host={site.domain} className="size-5" />
        {/* The whole card opens the dashboard; the button covers it from underneath. */}
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 cursor-pointer truncate text-left text-body font-semibold after:absolute after:inset-0 after:rounded-md"
          title={site.name !== site.domain ? `${site.name} (${site.domain})` : site.domain}
        >
          {site.domain}
        </button>
      </div>
      {onSettings && (
        <button
          type="button"
          onClick={onSettings}
          aria-label={`Settings of ${site.domain}`}
          title="Site settings"
          className="absolute top-3 right-3 z-10 grid size-7 cursor-pointer place-items-center rounded-sm text-muted opacity-60 hover:bg-sunken hover:text-ink hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} />
        </button>
      )}
      <Sparkline values={activity?.series} loading={loading} />
      <div className="flex items-baseline justify-between gap-2 text-body">
        <span className="text-muted">
          <span className="font-semibold text-ink tabular-nums">
            {activity ? compact(activity.visitors) : '–'}
          </span>{' '}
          visitors in last 24h
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
    </li>
  )
}

const compact = (n: number) =>
  n < 10_000
    ? n.toLocaleString('en')
    : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const WIDTH = 240
const HEIGHT = 40

/** Visitors per hour as a line over a soft fill, scaled to its own peak. */
function Sparkline({ values, loading }: { values?: number[]; loading: boolean }) {
  if (!values)
    return (
      <div
        className={cx('h-10 rounded-xs bg-sunken/40', loading && 'animate-pulse')}
        aria-hidden="true"
      />
    )
  const max = Math.max(1, ...values)
  const step = WIDTH / Math.max(1, values.length - 1)
  const points = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(HEIGHT - 2 - (v / max) * (HEIGHT - 4)).toFixed(1)}`,
  )
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-10 w-full overflow-visible"
      role="img"
      aria-label={`Visitors per hour over the last 24 hours, peaking at ${max.toLocaleString('en')}`}
    >
      <polygon
        points={`0,${HEIGHT} ${points.join(' ')} ${WIDTH},${HEIGHT}`}
        className="fill-visitors-soft"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-visitors"
      />
    </svg>
  )
}
