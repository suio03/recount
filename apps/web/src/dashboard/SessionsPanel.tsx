import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { api, type ReplayOutcome, type ReplayReason, type ReplaySession, type Scope } from '../api'
import { cx } from '../ui/cx'
import { Panel } from '../ui/Panel'
import { SegmentedControl } from '../ui/SegmentedControl'
import { countryName, duration, money } from './format'

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

const MOMENT_TONES = { friction: 'bg-down', progress: 'bg-up', intent: 'bg-line-strong' }

const SHOWS = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'converted', label: 'Converted' },
] as const
type Show = (typeof SHOWS)[number]['value']

const PROBLEMS = new Set<ReplayOutcome>(['gave_up', 'stuck'])
const CONVERTED = new Set<ReplayOutcome>(['purchased', 'converted'])

const COLLAPSED_ROWS = 5

/** "01:07": where in the recording a moment happens. */
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Recorded visits worth knowing about, each told in a sentence by the AI so nobody has to
 * watch them one by one: who paid or converted, and who got stuck or gave up.
 */
export function SessionsPanel({ scope, timezone }: { scope: Scope; timezone: string }) {
  const [show, setShow] = useState<Show>('all')
  const [expanded, setExpanded] = useState(false)
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
          {shown.length === 0 ? (
            <p className="m-0 py-4 text-center text-muted">No sessions like that in this range.</p>
          ) : (
            <ul className="m-0 grid list-none p-0">
              {visible.map((s) => (
                <Row key={s.id} session={s} currency={data.currency} when={when} />
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
    </Panel>
  )
}

function Row({
  session: s,
  currency,
  when,
}: {
  session: ReplaySession
  currency: string
  when: Intl.DateTimeFormat
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
        <div className="grid gap-2 pb-4 font-serif">
          <p className="m-0 text-note text-muted">{s.summary.intent}</p>
          <ol className="m-0 grid list-none gap-1.5 p-0">
            {s.summary.moments.map((m) => (
              <li
                key={`${m.t}-${m.text}`}
                className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-2"
              >
                <span className="flex items-center gap-1.5 font-mono text-label text-muted tabular-nums">
                  <span className={cx('size-1.5 rounded-full', MOMENT_TONES[m.kind])} />
                  {clock(m.t)}
                </span>
                <span className="text-note">{m.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  )
}
