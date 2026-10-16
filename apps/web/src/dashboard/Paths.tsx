import { Link } from '@tanstack/react-router'
import { BellOff, Route } from 'lucide-react'
import type { Lane, Paths as PathsData, QuietEvent } from '../api'
import { cx } from '../ui/cx'
import { change, Delta } from '../ui/Delta'
import { percent } from './format'

const day = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/**
 * How far people got: each lane is a funnel counted per visitor across the range, with the
 * failures and give-ups among those who started it. Below, the events that went quiet, since a
 * broken tag looks the same as a broken feature.
 */
export function Paths({
  paths,
  domain,
  canEdit,
}: {
  paths?: PathsData
  /** Links to the site's settings, where funnels are added and drafts reviewed. */
  domain?: string
  canEdit: boolean
}) {
  if (!paths) return <div id="paths" className="h-48 animate-pulse rounded-md bg-sunken/40" />
  const settings = (hash: string, text: string) =>
    canEdit && domain ? (
      <Link
        to="/sites/$domain/settings"
        params={{ domain }}
        hash={hash}
        className="text-ink underline underline-offset-2"
      >
        {text}
      </Link>
    ) : null
  const drafted = paths.lanes.some((l) => l.source === 'draft')
  return (
    <section
      id="paths"
      className="grid min-w-0 scroll-mt-20 content-start gap-5 rounded-md border border-line bg-surface p-4"
    >
      <header className="grid gap-1">
        <h2 className="m-0 flex items-center gap-2 text-title font-semibold tracking-[-0.01em]">
          <Route className="size-5 text-visitors" strokeWidth={1.75} aria-hidden="true" />
          How far people got
        </h2>
        <p className="m-0 text-label text-muted">
          Each step counts visitors who did it after the step before, on any visit in this range.
          {drafted && (
            <> Lanes marked drafted are not added yet. {settings('drafts', 'Review them')}</>
          )}
        </p>
      </header>
      {paths.lanes.length > 0 ? (
        paths.lanes.map((lane) => <LaneRow key={lane.id ?? lane.name} lane={lane} />)
      ) : (
        <EventList paths={paths} settings={settings} />
      )}
      <Quiet quiet={paths.quiet} />
    </section>
  )
}

function LaneRow({ lane }: { lane: Lane }) {
  const first = lane.steps[0]?.visitors ?? 0
  return (
    <div className="grid gap-2">
      <h3 className="m-0 flex flex-wrap items-baseline gap-2 text-body font-semibold">
        {lane.name}
        {lane.source === 'draft' && (
          <span className="rounded-xs border border-line px-1.5 text-label font-medium text-muted">
            Drafted
          </span>
        )}
      </h3>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-2 p-0">
        {lane.steps.map((s, i) => {
          const before = i > 0 ? (lane.steps[i - 1]?.visitors ?? 0) : 0
          const delta = change(s.visitors, s.previous)
          return (
            <li
              key={`${i}-${s.name}`}
              className="grid content-start gap-1 rounded-sm bg-sunken/50 p-2.5"
            >
              <span className="truncate text-label font-medium text-muted" title={s.name}>
                {i + 1}. {s.name}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="text-title font-semibold tabular-nums">
                  {s.visitors.toLocaleString('en')}
                </span>
                {delta !== undefined && <Delta value={delta} />}
              </span>
              <span
                className="h-1.5 rounded-full bg-visitors"
                style={{ width: `${first ? Math.max(2, (s.visitors / first) * 100) : 0}%` }}
                aria-hidden="true"
              />
              <span className="text-label text-muted">
                {i === 0
                  ? 'started'
                  : before
                    ? `${percent(s.visitors / before)} of step ${i}`
                    : 'nobody to keep'}
                {' · '}was {s.previous.toLocaleString('en')}
              </span>
            </li>
          )
        })}
      </ol>
      {lane.side.length > 0 && (
        <p className="m-0 flex flex-wrap items-center gap-1.5 text-label text-muted">
          Along the way:
          {lane.side.map((e) => (
            <span
              key={e.name}
              className="rounded-xs bg-down/10 px-1.5 py-0.5 font-mono text-path text-down"
            >
              {e.name} <span className="opacity-70">{e.visitors.toLocaleString('en')}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

/** Without lanes: the custom events, and how to get lanes. */
function EventList({
  paths,
  settings,
}: {
  paths: PathsData
  settings: (hash: string, text: string) => React.ReactNode
}) {
  const add = settings('funnels', 'Add a funnel')
  const draft = settings('drafts', paths.ai ? 'have AI draft them' : 'turn on AI to draft them')
  return (
    <div className="grid gap-2">
      <p className="m-0 text-muted">
        No paths yet, so here are the custom events.{' '}
        {add && draft && (
          <>
            {add}, or {draft}.
          </>
        )}
      </p>
      {paths.events?.length ? (
        <table className="w-full border-collapse text-body">
          <thead>
            <tr className="text-left text-label text-muted">
              <th className="py-1.5 font-medium">Event</th>
              <th className="py-1.5 text-right font-medium">Visitors</th>
              <th className="py-1.5 text-right font-medium">Before</th>
            </tr>
          </thead>
          <tbody>
            {paths.events.map((e) => (
              <tr key={e.name} className="border-t border-line">
                <td className="py-1.5 font-mono text-path">{e.name}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {e.visitors.toLocaleString('en')}
                </td>
                <td className="py-1.5 text-right text-muted tabular-nums">
                  {e.previous.toLocaleString('en')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="m-0 text-label text-muted">This site sent no custom events in this range.</p>
      )}
    </div>
  )
}

function Quiet({ quiet }: { quiet: QuietEvent[] }) {
  return (
    <div className="grid gap-2 border-t border-line pt-4">
      <h3 className="m-0 flex items-center gap-2 text-body font-semibold">
        <BellOff
          className={cx('size-4', quiet.length ? 'text-down' : 'text-muted')}
          strokeWidth={2}
          aria-hidden="true"
        />
        {quiet.length ? 'Went quiet' : 'Nothing went quiet'}
      </h3>
      {quiet.length === 0 ? (
        <p className="m-0 text-label text-muted">
          Every event that fired nearly every day still does.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {quiet.map((q) => (
            <li
              key={q.name}
              className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <span className="min-w-0">
                <code className="font-mono text-path font-medium">{q.name}</code>{' '}
                <span className="text-label text-muted">
                  fired on {q.active} of 14 days, about {q.perDay} a day, then nothing for {q.days}{' '}
                  days. Last seen {day.format(new Date(q.last))}.
                </span>
              </span>
              <Recent counts={q.recent} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The last 7 full days as small bars, zeros as a flat mark. */
function Recent({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts)
  return (
    <span
      className="flex h-6 items-end gap-0.5"
      role="img"
      aria-label={`Last 7 days: ${counts.join(', ')}`}
    >
      {counts.map((n, i) => (
        <span
          key={i}
          className={cx('w-2 rounded-xs', n ? 'bg-ink/60' : 'bg-down')}
          style={{ height: n ? `${Math.max(15, (n / max) * 100)}%` : '2px' }}
        />
      ))}
    </span>
  )
}
