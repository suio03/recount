import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Play } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { api, type ReplayOutcome, type ReplayReason, type ReplaySession, type Scope } from '../api'
import { cx } from '../ui/cx'
import { Panel } from '../ui/Panel'
import { SegmentedControl } from '../ui/SegmentedControl'
import { countryName, duration, money } from './format'
import { clock, LEAD_IN_MS, MOMENT_TONES } from './moments'
import { PatternsDigest } from './PatternsDigest'

// The player carries rrweb, so it loads only when a replay is opened.
const ReplayPlayer = lazy(() => import('./ReplayPlayer').then((m) => ({ default: m.ReplayPlayer })))

const OUTCOMES: Record<ReplayOutcome, { label: string; tone: string }> = {
  purchased: { label: 'Purchased', tone: 'bg-revenue-soft text-revenue' },
  converted: { label: 'Converted', tone: 'bg-visitors-soft text-visitors' },
  gave_up: { label: 'Gave up', tone: 'bg-sunken text-down' },
  stuck: { label: 'Stuck', tone: 'bg-sunken text-down' },
  browsed: { label: 'Browsed', tone: 'bg-sunken text-muted' },
  left_quickly: { label: 'Left quickly', tone: 'bg-sunken text-muted' },
}

const REASONS: Record<ReplayReason, string> = {
  paid: 'Paid',
  abandoned_form: 'Left a form',
  error: 'Error',
  rage_click: 'Rage click',
  dead_clicks: 'Dead clicks',
  key_event: 'Key event',
}

const SHOWS = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'converted', label: 'Converted' },
] as const
type Show = (typeof SHOWS)[number]['value']

const PROBLEMS = new Set<ReplayOutcome>(['gave_up', 'stuck'])
const CONVERTED = new Set<ReplayOutcome>(['purchased', 'converted'])

const COLLAPSED_ROWS = 5

/** The fewest summarized sessions worth looking for patterns across; the API agrees. */
const MIN_FOR_PATTERNS = 3

/**
 * Recorded visits worth knowing about, each told in a sentence by the AI so nobody has to
 * watch them one by one: who paid or converted, and who got stuck or gave up.
 */
export function SessionsPanel({ scope, timezone }: { scope: Scope; timezone: string }) {
  const [show, setShow] = useState<Show>('all')
  const [expanded, setExpanded] = useState(false)
  const [watching, setWatching] = useState<{ session: ReplaySession; start: number }>()
  const query = useQuery({
    queryKey: ['replays', scope],
    queryFn: () => api.replays(scope),
    placeholderData: (prev) => prev,
  })
  const data = query.data
  const shown =
    data?.sessions.filter(
      (s) => show === 'all' || (show === 'problems' ? PROBLEMS : CONVERTED).has(s.summary.outcome),
    ) ?? []
  const visible = expanded ? shown : shown.slice(0, COLLAPSED_ROWS)
  const when = new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  })

  return (
    <Panel
      title="Sessions worth watching"
      actions={
        data && data.sessions.length > 0 ? (
          <SegmentedControl label="Show sessions" options={SHOWS} value={show} onChange={setShow} />
        ) : undefined
      }
    >
      {query.isError ? (
        <p className="m-0 text-muted">Could not load: {String(query.error)}</p>
      ) : !data ? (
        <div className="h-32 animate-pulse rounded-xs bg-sunken/40" />
      ) : data.sessions.length === 0 ? (
        <p className="m-0 py-4 text-center text-muted">
          {data.recorded === 0
            ? 'No recorded sessions in this range. Add data-replay="1" to the tracker script to record visits.'
            : `${data.recorded.toLocaleString()} recorded ${data.recorded === 1 ? 'session' : 'sessions'}, none with a payment, a key event or trouble worth summarizing yet.`}
        </p>
      ) : (
        <>
          {data.sessions.length >= MIN_FOR_PATTERNS && (
            <PatternsDigest
              scope={scope}
              sessions={data.sessions}
              onWatch={(session, start) => setWatching({ session, start })}
            />
          )}
          {shown.length === 0 ? (
            <p className="m-0 py-4 text-center text-muted">No sessions like that in this range.</p>
          ) : (
            <ul className="m-0 grid list-none p-0">
              {visible.map((s) => (
                <Row
                  key={s.id}
                  session={s}
                  currency={data.currency}
                  when={when}
                  onWatch={(start) => setWatching({ session: s, start })}
                />
              ))}
            </ul>
          )}
          <footer className="flex flex-wrap items-center justify-between gap-2 text-label text-muted">
            <span>
              {data.sessions.length} summarized of {data.recorded.toLocaleString()} recorded{' '}
              {data.recorded === 1 ? 'session' : 'sessions'}
            </span>
            {shown.length > COLLAPSED_ROWS && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="cursor-pointer rounded-sm px-1.5 py-0.5 font-medium text-ink hover:bg-sunken"
              >
                {expanded ? 'Show fewer' : `Show all ${shown.length}`}
              </button>
            )}
          </footer>
        </>
      )}
      {watching && (
        <Suspense>
          <ReplayPlayer
            siteId={scope.siteId}
            session={watching.session}
            start={watching.start}
            onClose={() => setWatching(undefined)}
          />
        </Suspense>
      )}
    </Panel>
  )
}

function Row({
  session: s,
  currency,
  when,
  onWatch,
}: {
  session: ReplaySession
  currency: string
  when: Intl.DateTimeFormat
  /** Opens the replay at this many milliseconds in. */
  onWatch: (start: number) => void
}) {
  const [open, setOpen] = useState(false)
  const outcome = OUTCOMES[s.summary.outcome] ?? OUTCOMES.browsed
  const facts = [
    when.format(new Date(s.startedAt)),
    s.channel && (s.referrer ? `${s.channel} · ${s.referrer}` : s.channel),
    s.country && countryName(s.country),
    s.device,
    duration(s.duration),
    `${s.pages} ${s.pages === 1 ? 'page' : 'pages'}`,
  ].filter(Boolean)

  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-3 text-left hover:bg-sunken/50"
      >
        <span className="grid min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={cx('rounded-xs px-1.5 py-px text-label font-semibold', outcome.tone)}>
              {outcome.label}
            </span>
            {s.revenue > 0 && (
              <span className="text-label font-semibold text-revenue tabular-nums">
                {money(s.revenue, currency)}
              </span>
            )}
            {s.reasons
              .filter((r) => r !== 'paid')
              .map((r) => (
                <span
                  key={r}
                  className="rounded-xs border border-line px-1.5 text-label text-muted"
                >
                  {REASONS[r]}
                </span>
              ))}
          </span>
          <span className="font-serif text-note">{s.summary.headline}</span>
          <span className="flex min-w-0 flex-wrap gap-x-2 text-label text-muted">
            <span>{facts[0]}</span>
            {s.entry && (
              <span>
                landed on <span className="font-mono text-ink">{s.entry}</span>
              </span>
            )}
            {facts.slice(1).map((f) => (
              <span key={f}>{f}</span>
            ))}
          </span>
        </span>
        <ChevronDown
          className={cx('mt-1 size-4 text-muted transition-transform', open && 'rotate-180')}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div className="grid gap-2 pb-4">
          <p className="m-0 font-serif text-note text-muted">{s.summary.intent}</p>
          <ol className="m-0 grid list-none gap-0.5 p-0">
            {s.summary.moments.map((m) => (
              <li key={`${m.t}-${m.text}`}>
                <button
                  type="button"
                  onClick={() => onWatch(Math.max(0, m.t - LEAD_IN_MS))}
                  title="Watch this moment"
                  className="-mx-2 grid w-[calc(100%+1rem)] cursor-pointer grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2 rounded-sm px-2 py-1 text-left hover:bg-sunken"
                >
                  <span className="flex items-center gap-1.5 font-mono text-label text-visitors tabular-nums">
                    <span className={cx('size-1.5 shrink-0 rounded-full', MOMENT_TONES[m.kind])} />
                    {clock(m.t)}
                  </span>
                  <span className="font-serif text-note">{m.text}</span>
                </button>
              </li>
            ))}
          </ol>
          <div>
            <button
              type="button"
              onClick={() => onWatch(0)}
              className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2.5 text-label font-medium hover:bg-sunken"
            >
              <Play className="size-3.5" strokeWidth={2} />
              Watch replay
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
