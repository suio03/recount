import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  api,
  type Dimension,
  type Intent,
  type MainStats,
  type PayingVisitor,
  type Scope,
} from '../api'
import { BreakdownList } from '../ui/BreakdownList'
import { cx } from '../ui/cx'
import { change, Delta } from '../ui/Delta'
import { SegmentedControl } from '../ui/SegmentedControl'
import { TrendChart } from '../ui/TrendChart'
import { compact, countryFlag, countryName, duration, money, percent } from './format'

const SOURCE_OPTIONS = [
  { value: 'channel', label: 'Channel', column: 'Channel' },
  { value: 'referrer', label: 'Referrer', column: 'Referrer' },
] as const

type SourceDimension = (typeof SOURCE_OPTIONS)[number]['value']

const day = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const bucketDate = (t: string) => new Date(t.length === 10 ? t : `${t.replace(' ', 'T')}Z`)

/** Where a person came from, in a word: the referrer, or the channel when there is none. */
export const sourceOf = (p: Pick<PayingVisitor, 'referrer' | 'channel'>) =>
  p.referrer || p.channel || 'Direct'

/**
 * The traffic at a glance: visitors against the period before, today against a usual day,
 * activation and payment tries, then the chart with the usual line and the buckets in which
 * somebody tried to pay, and where visitors came from beside it.
 */
export function Traffic({
  scope,
  timezone,
  intent,
  onFilter,
  onShowDay,
}: {
  scope: Scope
  timezone: string
  intent?: Intent
  onFilter: (dimension: Dimension, value: string) => void
  /** Narrows the dashboard to one day. */
  onShowDay: (day: string) => void
}) {
  const main = useQuery({
    queryKey: ['main', scope],
    queryFn: () => api.main(scope),
    placeholderData: (prev) => prev,
  })
  return (
    <section
      id="traffic"
      className="grid min-w-0 overflow-hidden rounded-md border border-line bg-surface lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="min-w-0">
        {main.isError ? (
          <p className="p-4 text-muted">Could not load stats: {String(main.error)}</p>
        ) : !main.data ? (
          <div className="h-[380px] animate-pulse bg-sunken/40" />
        ) : (
          <Body stats={main.data} intent={intent} timezone={timezone} onShowDay={onShowDay} />
        )}
      </div>
      <Sources scope={scope} intent={intent} onFilter={onFilter} />
    </section>
  )
}

function Body({
  stats,
  intent,
  timezone,
  onShowDay,
}: {
  stats: MainStats
  intent?: Intent
  timezone: string
  onShowDay: (day: string) => void
}) {
  const { totals: t, previous: p, currency } = stats
  const hasRevenue = t.revenue !== 0 || p.revenue !== 0
  const [picked, setPicked] = useState<number>()
  const tried = useMemo(() => new Map(intent?.series.map((b) => [b.t, b.tried]) ?? []), [intent])
  const markers = stats.series.flatMap((d, i) => (tried.get(d.t) ? [i] : []))
  const daily = stats.interval === 'day'
  const usual = daily && stats.usual != null ? stats.usual : undefined
  const point = picked === undefined ? undefined : stats.series[picked]
  const keyEvents = intent?.events
  return (
    <>
      <div className="flex flex-wrap border-b border-line">
        <Tile label="Visitors" value={compact(t.visitors)}>
          <Compared now={t.visitors} before={p.visitors} />
        </Tile>
        {stats.today != null && (
          <Tile label="Today so far" value={compact(stats.today)}>
            {stats.usual != null ? (
              <span className="text-label text-muted">
                usual day ≈ {stats.usual.toLocaleString('en')}
              </span>
            ) : (
              <span className="text-label text-muted">no usual day yet</span>
            )}
          </Tile>
        )}
        {keyEvents && keyEvents.activation.length > 0 && intent && (
          <Tile
            label="Activated"
            value={compact(intent.totals.activated)}
            title={`Visitors who sent ${keyEvents.activation.join(' or ')}`}
          >
            <Compared now={intent.totals.activated} before={intent.previous.activated} />
          </Tile>
        )}
        {intent && (
          <a
            href="#tried"
            className="grid min-w-32 flex-1 gap-1 px-4 py-3 hover:bg-sunken"
            title="See who tried to pay"
          >
            <span className="inline-flex items-center gap-1 text-label font-medium text-muted">
              <span className="size-2 rounded-full bg-revenue" aria-hidden="true" />
              Tried to pay
            </span>
            <span className="text-kpi font-semibold tabular-nums">
              {intent.totals.tried.toLocaleString('en')}
              <span className="text-body font-medium text-muted">
                {' '}
                → {intent.totals.paid.toLocaleString('en')} paid
              </span>
            </span>
            <span className="text-label text-muted">
              was {intent.previous.tried.toLocaleString('en')} →{' '}
              {intent.previous.paid.toLocaleString('en')}
            </span>
          </a>
        )}
        {hasRevenue && (
          <Tile label="Revenue" value={money(t.revenue, currency, { compact: true })}>
            <Compared
              now={t.revenue}
              before={p.revenue}
              format={(n) => money(n, currency, { compact: true })}
            />
          </Tile>
        )}
      </div>
      <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-label text-muted">
        <span>
          Pageviews <span className="text-ink tabular-nums">{compact(t.pageviews)}</span>
        </span>
        <span>
          Bounce rate <span className="text-ink tabular-nums">{percent(t.bounce_rate)}</span>
          {p.bounce_rate > 0 && <> (was {percent(p.bounce_rate)})</>}
        </span>
        <span>
          Session time{' '}
          <span className="text-ink tabular-nums">{duration(t.avg_session_seconds)}</span>
          {p.avg_session_seconds > 0 && <> (was {duration(p.avg_session_seconds)})</>}
        </span>
      </p>
      <div className="px-4 pt-2 pb-2">
        <TrendChart
          metric="Visitors"
          interval={stats.interval}
          data={stats.series.map((d) => ({
            t: d.t,
            value: d.visitors,
            revenue: hasRevenue ? d.revenue : undefined,
          }))}
          formatRevenue={hasRevenue ? (minor) => money(minor, currency) : undefined}
          usual={usual}
          markers={markers}
          markerLabel={(i) => {
            const n = tried.get(stats.series[i]?.t ?? '')
            return n ? `${n} tried to pay` : undefined
          }}
          onPick={daily ? (i) => setPicked((now) => (now === i ? undefined : i)) : undefined}
          picked={picked}
        />
      </div>
      {point && (
        <DayDetail
          t={point.t}
          visitors={point.visitors}
          pageviews={point.pageviews}
          usual={stats.usual ?? undefined}
          people={intent?.people.filter(
            (person) =>
              new Date(person.last).toLocaleDateString('en-CA', { timeZone: timezone }) === point.t,
          )}
          tried={tried.get(point.t) ?? 0}
          onShow={() => onShowDay(point.t)}
          onClose={() => setPicked(undefined)}
        />
      )}
      {daily && !point && (
        <p className="m-0 px-4 pb-3 text-label text-muted">
          {markers.length > 0 && (
            <>
              <span className="mr-1 inline-block size-2 rounded-full bg-revenue align-middle" />
              Somebody tried to pay that day.{' '}
            </>
          )}
          Click a day for its numbers.
        </p>
      )}
    </>
  )
}

function Tile({
  label,
  value,
  title,
  children,
}: {
  label: string
  value: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid min-w-32 flex-1 gap-1 px-4 py-3" title={title}>
      <span className="text-label font-medium text-muted">{label}</span>
      <span className="text-kpi font-semibold tabular-nums">{value}</span>
      {children}
    </div>
  )
}

function Compared({
  now,
  before,
  format = (n) => n.toLocaleString('en'),
}: {
  now: number
  before: number
  format?: (n: number) => string
}) {
  const delta = change(now, before)
  return (
    <span className="flex items-baseline gap-2 text-label text-muted">
      {delta !== undefined && <Delta value={delta} />}
      was {format(before)}
    </span>
  )
}

/** One day's numbers, picked on the chart. */
function DayDetail({
  t,
  visitors,
  pageviews,
  usual,
  people = [],
  tried,
  onShow,
  onClose,
}: {
  t: string
  visitors: number
  pageviews: number
  usual?: number
  people?: PayingVisitor[]
  tried: number
  onShow: () => void
  onClose: () => void
}) {
  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm bg-sunken px-3 py-2 text-label">
      <span className="font-semibold text-ink">{day.format(bucketDate(t))}</span>
      <span>
        <span className="font-medium tabular-nums">{visitors.toLocaleString('en')}</span> visitors
        {usual !== undefined && usual > 0 && (
          <span className={cx('ml-1', visitors < usual * 0.7 ? 'text-down' : 'text-muted')}>
            ({visitors >= usual ? '+' : '−'}
            {Math.round((Math.abs(visitors - usual) / usual) * 100)}% vs usual)
          </span>
        )}
      </span>
      <span>
        <span className="font-medium tabular-nums">{pageviews.toLocaleString('en')}</span> pageviews
      </span>
      {tried > 0 && (
        <a href="#tried" className="text-revenue hover:underline">
          {tried} tried to pay
          {people.length > 0 &&
            `: ${people.map((p) => `${countryFlag(p.country) ?? ''} ${sourceOf(p)}`).join(', ')}`}
        </a>
      )}
      <span className="ml-auto flex gap-1">
        <button
          type="button"
          onClick={onShow}
          className="h-7 cursor-pointer rounded-sm border border-line bg-surface px-2 font-medium hover:bg-canvas"
        >
          Show this day
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-7 cursor-pointer rounded-sm px-2 text-muted hover:bg-canvas hover:text-ink"
        >
          Close
        </button>
      </span>
    </div>
  )
}

/** Where visitors came from, and where the people who tried to pay came from. */
function Sources({
  scope,
  intent,
  onFilter,
}: {
  scope: Scope
  intent?: Intent
  onFilter: (dimension: Dimension, value: string) => void
}) {
  const [dimension, setDimension] = useState<SourceDimension>('referrer')
  const data = useQuery({
    queryKey: ['breakdown', scope, dimension],
    queryFn: () => api.breakdown(scope, dimension, 8),
    placeholderData: (prev) => prev,
  })
  const column = SOURCE_OPTIONS.find((o) => o.value === dimension)?.column ?? ''
  return (
    <aside className="grid min-w-0 content-start gap-3 border-t border-line p-4 lg:border-t-0 lg:border-l">
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="m-0 text-body font-semibold">Sources</h2>
        <SegmentedControl
          label="Sources dimension"
          options={SOURCE_OPTIONS}
          value={dimension}
          onChange={setDimension}
        />
      </header>
      {data.isError ? (
        <p className="text-muted">Could not load: {String(data.error)}</p>
      ) : !data.data ? (
        <div className="h-48 animate-pulse rounded-xs bg-sunken/40" />
      ) : data.data.rows.length === 0 ? (
        <p className="py-6 text-center text-muted">No {column.toLowerCase()} data in this range.</p>
      ) : (
        <BreakdownList
          dimension={column}
          rows={data.data.rows.map((r) => ({
            key: r.value,
            label: r.value,
            icon: dimension === 'referrer' ? { host: r.value, share: scope.share } : undefined,
            visitors: r.visitors,
          }))}
          onSelect={(row) => onFilter(dimension, row.key)}
        />
      )}
      {intent && intent.people.length > 0 && <TriedFrom people={intent.people} />}
    </aside>
  )
}

/** "All 3 who tried to pay came from google.com", or the sources they came from. */
function TriedFrom({ people }: { people: PayingVisitor[] }) {
  const counts = new Map<string, number>()
  for (const p of people) counts.set(sourceOf(p), (counts.get(sourceOf(p)) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const [top] = ranked
  if (!top) return null
  const countries = new Set(people.map((p) => p.country).filter(Boolean))
  return (
    <p className="m-0 flex gap-2 rounded-sm bg-revenue-soft px-3 py-2 text-label">
      <span className="mt-1 size-2 shrink-0 rounded-full bg-revenue" aria-hidden="true" />
      <span>
        {ranked.length === 1
          ? `${people.length === 1 ? 'The one' : `All ${people.length}`} who tried to pay came from ${top[0]}`
          : `Who tried to pay came from ${ranked.map(([s, n]) => `${s} (${n})`).join(', ')}`}
        {countries.size > 0 &&
          `, in ${[...countries]
            .slice(0, 4)
            .map((c) => countryName(c))
            .join(', ')}${countries.size > 4 ? '…' : ''}`}
        .
      </span>
    </p>
  )
}
