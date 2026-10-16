import { useQuery } from '@tanstack/react-query'
import {
  BellOff,
  CreditCard,
  Plus,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Unplug,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Attention, api, type Site, type SiteActivity } from './api'
import { cx } from './ui/cx'
import { change, Delta } from './ui/Delta'
import { Button, inputClass } from './ui/Form'
import { HostIcon } from './ui/HostIcon'

/** Refetched this often while the list is open. */
const ACTIVITY_REFRESH_MS = 5 * 60_000

/**
 * Every site the person can see at a glance: its last 30 days against a usual day, this week's
 * visitors, who tried to pay and what needs a look, with the sites that need a look first.
 * Opening one shows its dashboard.
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
  // The server sorts by what needs a look; sites it has not counted yet keep their place after.
  const order = useMemo(() => new Map(activity.data?.map((a, i) => [a.siteId, i])), [activity.data])
  const shown = sites
    .filter((s) => !needle || s.domain.includes(needle) || s.name.toLowerCase().includes(needle))
    .sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size))
  const flagged = activity.data?.filter((a) => a.attention.some((x) => x.kind !== 'spike')).length

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
      {flagged !== undefined && sites.length > 1 && (
        <p className="m-0 text-label text-muted">
          {flagged
            ? `${flagged} of ${sites.length} sites need a look.`
            : `Nothing needs a look across ${sites.length} sites.`}
        </p>
      )}
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
  const delta = activity && change(activity.week.visitors, activity.week.previous)
  const today = activity?.days.at(-1)?.visitors
  const tries = activity?.tries
  const flags = activity?.attention.filter((a) => a.kind !== 'unpaid') ?? []
  return (
    <li className="group relative grid content-start gap-3 rounded-md border border-line bg-surface p-4 hover:border-line-strong">
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
      {/* People who tried to pay without paying show in the line at the foot of the card. */}
      {flags.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {flags.map((a) => (
            <Flag key={a.kind} attention={a} quiet={activity?.quiet ?? []} />
          ))}
        </ul>
      )}
      <Sparkline days={activity?.days} usual={activity?.usual ?? null} loading={loading} />
      <div className="grid gap-1">
        <div className="flex items-baseline justify-between gap-2 text-body">
          <span className="text-muted">
            <span className="font-semibold text-ink tabular-nums">
              {activity ? compact(activity.week.visitors) : '–'}
            </span>{' '}
            visitors this week
          </span>
          {delta !== undefined && <Delta value={delta} />}
        </div>
        {activity && (
          <p className="m-0 text-label text-muted tabular-nums">
            Today so far {compact(today ?? 0)}
            {activity.usual !== null && ` · usual day ≈ ${compact(activity.usual)}`}
          </p>
        )}
      </div>
      {tries && (
        <p className="m-0 flex items-center gap-1.5 border-t border-line pt-2.5 text-label text-muted">
          <CreditCard
            className={cx('size-3.5', tries.tried ? 'text-revenue' : 'text-muted')}
            strokeWidth={2}
            aria-hidden="true"
          />
          {tries.tried ? (
            <span className={cx(tries.tried > tries.paid && 'text-revenue')}>
              <span className="font-semibold text-ink tabular-nums">{tries.tried}</span> tried to
              pay this week ·{' '}
              <span className="font-semibold text-ink tabular-nums">{tries.paid}</span> paid
            </span>
          ) : (
            'Nobody tried to pay this week'
          )}
        </p>
      )}
    </li>
  )
}

/** One thing that needs a look, as a small pill on the card. */
function Flag({ attention: a, quiet }: { attention: Attention; quiet: SiteActivity['quiet'] }) {
  const [Icon, text, tone, title] =
    a.kind === 'silent'
      ? [Unplug, 'No visitors since yesterday', 'bad', 'Is the tracking script still on the site?']
      : a.kind === 'drop'
        ? [TrendingDown, `Yesterday ${compact(a.yesterday)}, usual ≈ ${compact(a.usual)}`, 'bad']
        : a.kind === 'spike'
          ? [TrendingUp, `Yesterday ${compact(a.yesterday)}, usual ≈ ${compact(a.usual)}`, 'up']
          : a.kind === 'quiet'
            ? [
                BellOff,
                a.events === 1 ? `${quiet[0]?.name} went quiet` : `${a.events} events went quiet`,
                'bad',
                quiet.map((q) => `${q.name}: ${q.days}d`).join(', '),
              ]
            : [CreditCard, `${a.tried} tried, ${a.paid} paid`, 'revenue']
  return (
    <li
      title={title}
      className={cx(
        'inline-flex max-w-full items-center gap-1 rounded-xs px-1.5 py-0.5 text-label font-medium',
        tone === 'bad' && 'bg-down/10 text-down',
        tone === 'up' && 'bg-up/10 text-up',
        tone === 'revenue' && 'bg-revenue-soft text-revenue',
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      <span className="truncate">{text}</span>
    </li>
  )
}

const compact = (n: number) =>
  n < 10_000
    ? n.toLocaleString('en')
    : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)

const WIDTH = 240
const HEIGHT = 40

/**
 * Visitors per day as a line over a soft fill, with a usual day dashed across. Scaled to the
 * higher of the peak and the usual day; today, still under way, ends on a dot.
 */
function Sparkline({
  days,
  usual,
  loading,
}: {
  days?: SiteActivity['days']
  usual: number | null
  loading: boolean
}) {
  if (!days)
    return (
      <div
        className={cx('h-10 rounded-xs bg-sunken/40', loading && 'animate-pulse')}
        aria-hidden="true"
      />
    )
  const values = days.map((d) => d.visitors)
  const peak = Math.max(...values)
  const max = Math.max(1, peak, usual ?? 0)
  const y = (v: number) => HEIGHT - 2 - (v / max) * (HEIGHT - 4)
  const step = WIDTH / Math.max(1, values.length - 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`)
  const last = values.at(-1) ?? 0
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-10 w-full overflow-visible"
      role="img"
      aria-label={`Visitors per day over the last ${values.length} days, peaking at ${peak.toLocaleString('en')}${usual !== null ? `; a usual day is about ${usual.toLocaleString('en')}` : ''}`}
    >
      <polygon
        points={`0,${HEIGHT} ${points.join(' ')} ${WIDTH},${HEIGHT}`}
        className="fill-visitors-soft"
      />
      {usual !== null && (
        <line
          x1={0}
          x2={WIDTH}
          y1={y(usual)}
          y2={y(usual)}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          className="stroke-muted"
        />
      )}
      <polyline
        points={points.join(' ')}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-visitors"
      />
      {/* A zero-length round-capped line stays a circle where the stretched viewBox would not. */}
      <line
        x1={WIDTH}
        x2={WIDTH}
        y1={y(last)}
        y2={y(last)}
        strokeWidth={5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-visitors"
      />
    </svg>
  )
}
