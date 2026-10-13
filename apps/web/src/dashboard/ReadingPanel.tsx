import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { api, type Filters, type Finding, type ReadingResult, type Scope } from '../api'
import { cx } from '../ui/cx'
import { Delta } from '../ui/Delta'
import { FILTER_LABELS, filterValueLabel, MONO_FILTERS } from './filters'
import { compact, duration, money, percent } from './format'

const TOTAL_LABELS = {
  visitors: 'Visitors',
  pageviews: 'Pageviews',
  bounce_rate: 'Bounce rate',
  avg_session_seconds: 'Session time',
  conversion_rate: 'Conversion',
  revenue: 'Revenue',
} as const

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })

/** A value of the finding's metric, formatted like the rest of the dashboard. */
function formatted(f: Finding, x: number) {
  if (f.metric === 'conversion_rate') return percent(x, 1)
  if (f.metric === 'bounce_rate') return percent(x)
  if (f.metric === 'avg_session_seconds') return duration(x)
  if (f.metric === 'revenue') return money(x, f.currency ?? 'USD', { compact: true })
  return compact(x)
}

/** What a finding is about, in the same words and type as the filter chips. */
function Subject({ finding: f }: { finding: Finding }) {
  const s = f.subject
  if (s.kind === 'total') return <span>{TOTAL_LABELS[f.metric]}</span>
  if (s.kind === 'segment_goal')
    return (
      <span
        className="min-w-0 truncate"
        title={`${FILTER_LABELS[s.dimension]} ${filterValueLabel(s.dimension, s.value)} → ${s.name}`}
      >
        <span className="text-muted">{FILTER_LABELS[s.dimension]} </span>
        <span className={cx(MONO_FILTERS.has(s.dimension) && 'font-mono text-path')}>
          {filterValueLabel(s.dimension, s.value)}
        </span>
        <span className="text-muted"> → </span>
        <span className="font-mono text-path">{s.name}</span>
      </span>
    )
  const [label, value, mono] =
    s.kind === 'goal'
      ? ['Goal', s.name, true]
      : [
          FILTER_LABELS[s.dimension],
          filterValueLabel(s.dimension, s.value),
          MONO_FILTERS.has(s.dimension),
        ]
  return (
    <span className="min-w-0 truncate">
      <span className="text-muted">{label} </span>
      <span className={cx(mono && 'font-mono text-path')}>{value}</span>
      {f.metric === 'revenue' && <span className="text-muted"> revenue</span>}
    </span>
  )
}

function Change({ finding: f }: { finding: Finding }) {
  if (f.change === null) return <span className="text-label font-semibold text-muted">new</span>
  return <Delta value={f.change} higherIsBetter={f.metric !== 'bounce_rate'} />
}

/**
 * The AI reading of what changed, above the findings it was written from. The prose is the
 * only serif text on the dashboard; every number it relies on links back to a filtered view.
 */
export function ReadingPanel({
  scope,
  onShow,
}: {
  scope: Scope
  /** Replaces the dashboard's filters with a finding's, to show its evidence. */
  onShow: (filters: Filters) => void
}) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const query = useQuery({
    queryKey: ['reading', scope],
    queryFn: () => api.reading(scope),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })

  async function refresh() {
    setRefreshing(true)
    try {
      queryClient.setQueryData(['reading', scope], await api.reading(scope, true))
    } finally {
      setRefreshing(false)
    }
  }

  const data = query.data
  return (
    <aside
      className="grid min-w-0 content-start gap-4 rounded-md border border-line bg-surface p-4 lg:absolute lg:inset-0 lg:overflow-y-auto"
      aria-busy={query.isFetching || refreshing}
    >
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="m-0 text-body font-semibold">The reading</h2>
        {data?.status === 'ok' && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Rewrite the reading"
            title="Rewrite the reading"
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
        <Loading />
      ) : (
        <Body data={data} onShow={onShow} />
      )}
    </aside>
  )
}

function Loading() {
  return (
    <div className="grid gap-3" role="status">
      <span className="text-label text-muted">Reading the numbers…</span>
      {[92, 100, 76, 88].map((w) => (
        <div
          key={w}
          className="h-4 animate-pulse rounded-xs bg-sunken"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  )
}

function Body({ data, onShow }: { data: ReadingResult; onShow: (filters: Filters) => void }) {
  const byId = new Map(data.findings.map((f) => [f.id, f]))
  const reading = data.reading
  return (
    <>
      {reading && (
        <div className="grid gap-3 font-serif">
          {reading.headline && <p className="m-0 text-lead font-semibold">{reading.headline}</p>}
          {reading.claims.map((claim) => (
            <div key={claim.text} className="grid gap-1.5">
              <p className="m-0 text-note">{claim.text}</p>
              <div className="flex flex-wrap gap-1.5 font-sans">
                {claim.evidence.map((id) => {
                  const f = byId.get(id)
                  return f && <Evidence key={id} finding={f} onShow={onShow} />
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.status === 'unconfigured' && (
        <p className="m-0 text-muted">
          Set <code className="font-mono text-path">ANTHROPIC_API_KEY</code> in{' '}
          <code className="font-mono text-path">.env</code> to have these changes explained.
        </p>
      )}
      {data.status === 'key_rejected' && (
        <p className="m-0 text-muted" title={data.error}>
          The API key was refused; it may have expired or been revoked. Create a new one in the
          Claude Console and replace <code className="font-mono text-path">ANTHROPIC_API_KEY</code>{' '}
          in <code className="font-mono text-path">.env</code>.
        </p>
      )}
      {data.status === 'no_credit' && (
        <p className="m-0 text-muted" title={data.error}>
          The Claude account is out of credit. Add credit in the Claude Console to have these
          changes explained.
        </p>
      )}
      {data.status === 'error' && (
        <p className="m-0 text-muted" title={data.error}>
          The reading could not be written this time. The changes below are still current.
        </p>
      )}

      <div className="grid gap-1">
        <h3 className="m-0 text-label font-medium text-muted">What changed</h3>
        {data.findings.length === 0 ? (
          <p className="m-0 text-muted">Nothing moved enough to report.</p>
        ) : (
          <ul className="m-0 grid list-none p-0">
            {data.findings.map((f) => (
              <li key={f.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  onClick={() => onShow(f.filters)}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_3.5rem] items-baseline gap-2 py-1.5 text-left tabular-nums hover:bg-sunken"
                >
                  <span className="flex min-w-0 flex-col">
                    <Subject finding={f} />
                    {f.baseline !== undefined && (
                      <span className="text-label text-muted">
                        vs {formatted(f, f.baseline)} for all visitors
                      </span>
                    )}
                    {f.since && (
                      <span className="text-label text-muted">
                        since {day.format(new Date(f.since))}
                      </span>
                    )}
                  </span>
                  <span className="font-medium">{formatted(f, f.current)}</span>
                  <span className="text-right">
                    <Change finding={f} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {reading && (
        <p className="m-0 text-label text-muted">
          Written by {reading.model} at {time.format(new Date(reading.generatedAt))}. Every figure
          comes from the changes listed above.
        </p>
      )}
    </>
  )
}

function Evidence({
  finding: f,
  onShow,
}: {
  finding: Finding
  onShow: (filters: Filters) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onShow(f.filters)}
      title="Show this on the dashboard"
      className="inline-flex h-6 max-w-full cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 text-label hover:bg-sunken"
    >
      <Subject finding={f} />
      <Change finding={f} />
    </button>
  )
}
