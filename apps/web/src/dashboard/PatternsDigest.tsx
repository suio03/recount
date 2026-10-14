import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api, type ReplaySession, type Scope } from '../api'
import { cx } from '../ui/cx'
import { countryName } from './format'
import { clock, LEAD_IN_MS, MOMENT_TONES } from './moments'

/**
 * What the range's summarized sessions have in common, so the owner reads a few patterns
 * instead of every session. Each pattern lists the sessions behind it; one opens the replay at
 * the moment that shows it.
 */
export function PatternsDigest({
  scope,
  sessions,
  canRefresh,
  onWatch,
}: {
  scope: Scope
  /** Admins can find the patterns again, which costs a model call. */
  canRefresh: boolean
  /** The listed sessions, which the digest's evidence points into. */
  sessions: ReplaySession[]
  onWatch: (session: ReplaySession, start: number) => void
}) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const query = useQuery({
    queryKey: ['replayDigest', scope],
    queryFn: () => api.replayDigest(scope),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })
  const data = query.data
  const byId = new Map(sessions.map((s) => [s.id, s]))

  async function refresh() {
    setRefreshing(true)
    try {
      queryClient.setQueryData(['replayDigest', scope], await api.replayDigest(scope, true))
    } finally {
      setRefreshing(false)
    }
  }

  if (data?.status === 'too_few' || data?.status === 'off') return null
  return (
    <section
      aria-label="Patterns across sessions"
      aria-busy={query.isFetching || refreshing}
      className="grid gap-3 border-b border-line pb-4"
    >
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="m-0 text-label font-medium text-muted">
          {data ? `Across ${data.sessions} summarized sessions` : 'Across these sessions'}
        </h3>
        {data?.status === 'ok' && canRefresh && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Find the patterns again"
            title="Find the patterns again"
            className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink disabled:cursor-default"
          >
            <RefreshCw
              className={cx('size-3.5', refreshing && 'animate-spin')}
              strokeWidth={1.75}
            />
          </button>
        )}
      </header>

      {query.isError ? (
        <p className="m-0 text-muted">Could not load: {String(query.error)}</p>
      ) : !data || refreshing ? (
        <div className="grid gap-2" role="status">
          <span className="sr-only">Finding patterns across sessions</span>
          <div className="h-6 w-3/4 animate-pulse rounded-xs bg-sunken" />
          <div className="h-16 animate-pulse rounded-xs bg-sunken/60" />
        </div>
      ) : data.status === 'unconfigured' ? (
        <p className="m-0 text-muted">
          Set ANTHROPIC_API_KEY to see what these sessions have in common.
        </p>
      ) : data.status === 'key_rejected' ? (
        <p className="m-0 text-muted">The Anthropic API refused the key, so no patterns yet.</p>
      ) : data.status === 'no_credit' ? (
        <p className="m-0 text-muted">
          The Anthropic account is out of credit, so no patterns yet.
        </p>
      ) : data.status === 'over_budget' ? (
        <p className="m-0 text-muted">
          Today&apos;s AI budget is spent, so no patterns until tomorrow.
        </p>
      ) : data.status === 'error' || !data.digest ? (
        <p className="m-0 text-muted">Could not find patterns this time. Try again later.</p>
      ) : (
        <>
          <p className="m-0 font-serif text-lead font-medium text-pretty">{data.digest.headline}</p>
          {data.digest.patterns.length === 0 ? (
            <p className="m-0 text-muted">
              Nothing showed up in more than one session. Each one is summarized below.
            </p>
          ) : (
            <ol className="m-0 grid list-none gap-3 p-0">
              {data.digest.patterns.map((p) => (
                <li key={p.title} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span
                      className={cx('size-2 shrink-0 rounded-full', MOMENT_TONES[p.kind])}
                      aria-hidden="true"
                    />
                    <span className="text-body font-semibold">{p.title}</span>
                    <span className="text-label text-muted tabular-nums">
                      {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'}
                    </span>
                  </div>
                  <p className="m-0 pl-4 font-serif text-note text-pretty">{p.text}</p>
                  <div className="flex flex-wrap gap-1.5 pl-4">
                    {p.evidence.map((e) => {
                      const s = byId.get(e.session)
                      if (!s) return null
                      const where = [s.country && countryName(s.country), s.device]
                        .filter(Boolean)
                        .join(' · ')
                      return (
                        <button
                          key={e.session}
                          type="button"
                          onClick={() =>
                            onWatch(s, e.t === null ? 0 : Math.max(0, e.t - LEAD_IN_MS))
                          }
                          title={s.summary.headline}
                          className="inline-flex h-6 cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 text-label hover:bg-sunken"
                        >
                          <span className="font-mono text-visitors tabular-nums">
                            {e.t === null ? 'Whole visit' : clock(e.t)}
                          </span>
                          {where && <span className="text-muted">{where}</span>}
                        </button>
                      )
                    })}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
