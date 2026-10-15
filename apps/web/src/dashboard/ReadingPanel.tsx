import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import {
  type AnswerResult,
  api,
  type Filters,
  type Finding,
  QUESTIONS,
  type Question,
  type ReadingResult,
  type Scope,
  type Site,
} from '../api'
import { cx } from '../ui/cx'
import { Delta } from '../ui/Delta'
import { AiSwitch } from './AiSwitch'
import { FILTER_LABELS, filterValueLabel, MONO_FILTERS } from './filters'
import { compact, duration, money, percent } from './format'

const TOTAL_LABELS = {
  visitors: 'Visitors',
  pageviews: 'Pageviews',
  bounce_rate: 'Bounce rate',
  avg_session_seconds: 'Session time',
  conversion_rate: 'Conversion',
  revenue: 'Revenue',
  revenue_per_visitor: 'Revenue per visitor',
} as const

/** What a segment's figure is, after its name; visitors need no word. */
const SEGMENT_METRICS: Partial<Record<Finding['metric'], string>> = {
  pageviews: 'pageviews',
  bounce_rate: 'bounce rate',
  avg_session_seconds: 'session time',
  revenue: 'revenue',
  revenue_per_visitor: 'revenue per visitor',
}

/** Short labels for the question picker; the full question heads its answer. */
const ASKS: Array<{ value: Question | 'changes'; label: string }> = [
  { value: 'changes', label: 'What changed' },
  { value: 'traffic', label: 'Traffic' },
  { value: 'conversion', label: 'Conversion' },
  { value: 'channels', label: 'Best channel' },
]

const day = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' })

/** Cents matter per visitor, so this keeps the currency's minor digits. */
function perVisitor(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en', { style: 'currency', currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return format.format(minor / 10 ** digits)
}

/** A value of the finding's metric, formatted like the rest of the dashboard. */
function formatted(f: Finding, x: number) {
  if (f.metric === 'conversion_rate') return percent(x, 1)
  if (f.metric === 'bounce_rate') return percent(x)
  if (f.metric === 'avg_session_seconds') return duration(x)
  if (f.metric === 'revenue') return money(x, f.currency ?? 'USD', { compact: true })
  if (f.metric === 'revenue_per_visitor') return perVisitor(x, f.currency ?? 'USD')
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
      {SEGMENT_METRICS[f.metric] && (
        <span className="text-muted"> {SEGMENT_METRICS[f.metric]}</span>
      )}
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
  site,
  scope,
  canEnable,
  onShow,
}: {
  site: Pick<Site, 'id' | 'ai' | 'timezone'>
  scope: Scope
  /** Whether the viewer is an admin, who can switch AI on and rewrite the reading. */
  canEnable: boolean
  /** Replaces the dashboard's filters with a finding's, to show its evidence. */
  onShow: (filters: Filters) => void
}) {
  const queryClient = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [asked, setAsked] = useState<Question | 'changes'>('changes')
  const reading = useQuery({
    queryKey: ['reading', scope],
    queryFn: () => api.reading(scope),
    // Asking again is cheap: the server returns its cached reading until that one expires.
    staleTime: 5 * 60_000,
    enabled: asked === 'changes',
  })
  // A question is answered only once asked, since each answer costs a model call.
  const question = asked === 'changes' ? undefined : asked
  const answer = useQuery({
    queryKey: ['question', scope, question],
    queryFn: () => api.question(scope, question as Question),
    staleTime: 5 * 60_000,
    enabled: question !== undefined,
  })
  const query = question ? answer : reading

  async function refresh() {
    setRefreshing(true)
    try {
      if (question)
        queryClient.setQueryData(
          ['question', scope, question],
          await api.question(scope, question, true),
        )
      else queryClient.setQueryData(['reading', scope], await api.reading(scope, true))
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
      <header className="grid gap-3">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 className="m-0 text-body font-semibold">The reading</h2>
          <div className="flex items-center gap-1">
            {data?.status === 'ok' && canEnable && (
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                aria-label={question ? 'Rewrite the answer' : 'Rewrite the reading'}
                title={question ? 'Rewrite the answer' : 'Rewrite the reading'}
                className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink disabled:cursor-default"
              >
                <RefreshCw
                  className={cx('size-3.5', refreshing && 'animate-spin')}
                  strokeWidth={1.75}
                />
              </button>
            )}
            {canEnable && <AiSwitch site={site} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to read">
          {ASKS.map((a) => (
            <button
              key={a.value}
              type="button"
              aria-pressed={asked === a.value}
              title={a.value === 'changes' ? 'What changed and why' : QUESTIONS[a.value]}
              onClick={() => setAsked(a.value)}
              className={cx(
                'h-7 cursor-pointer rounded-sm border px-2.5 text-label',
                asked === a.value
                  ? 'border-ink bg-ink font-medium text-surface'
                  : 'border-line text-muted hover:bg-sunken hover:text-ink',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </header>

      {query.isError ? (
        <p className="m-0 text-muted">Could not load: {String(query.error)}</p>
      ) : !data || refreshing ? (
        <Loading />
      ) : (
        <Body
          data={data}
          open={isOpen(scope.range.to, site.timezone)}
          canEnable={canEnable}
          onShow={onShow}
        />
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

/** Whether the range ends today or later in the site's timezone, so its numbers still move. */
function isOpen(to: string, timezone: string) {
  return to >= new Date().toLocaleDateString('en-CA', { timeZone: timezone })
}

/**
 * A reading or an answer: the model's claims, then the figures they cite. An answer also says
 * what it counts, in the definition code wrote, between the question and the figures.
 */
function Body({
  data,
  open,
  canEnable,
  onShow,
}: {
  data: ReadingResult | AnswerResult
  /** The range includes today, so the totals above keep moving after the reading was written. */
  open: boolean
  canEnable: boolean
  onShow: (filters: Filters) => void
}) {
  const byId = new Map(data.findings.map((f) => [f.id, f]))
  const answer = 'question' in data ? data : undefined
  const reading = answer ? answer.answer : (data as ReadingResult).reading
  const what = answer ? 'these numbers' : 'these changes'
  return (
    <>
      {answer && <h3 className="m-0 text-body font-semibold">{answer.title}</h3>}
      {reading && (
        <div className="grid min-w-0 gap-3 font-serif">
          {reading.headline && <p className="m-0 text-lead font-semibold">{reading.headline}</p>}
          {reading.claims.map((claim) => (
            <div key={claim.text} className="grid min-w-0 gap-1.5">
              <p className="m-0 text-note">{claim.text}</p>
              <div className="flex min-w-0 flex-wrap gap-1.5 font-sans">
                {claim.evidence.map((id) => {
                  const f = byId.get(id)
                  return f && <Evidence key={id} finding={f} onShow={onShow} />
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.status === 'off' && (
        <p className="m-0 text-muted">
          AI analysis is off for this site, so {what} are not explained.{' '}
          {canEnable ? 'Switch it on above.' : 'An admin of this site can turn it on.'}
        </p>
      )}
      {data.status === 'unconfigured' && (
        <p className="m-0 text-muted">
          Set <code className="font-mono text-path">ANTHROPIC_API_KEY</code> in{' '}
          <code className="font-mono text-path">.env</code> to have {what} explained.
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
          The Claude account is out of credit. Add credit in the Claude Console to have {what}{' '}
          explained.
        </p>
      )}
      {data.status === 'over_budget' && (
        <p className="m-0 text-muted">
          Today&apos;s AI budget is spent, so {what} are explained again tomorrow (UTC). The
          day&apos;s spend is under Account → Usage.
        </p>
      )}
      {data.status === 'error' && (
        <p className="m-0 text-muted" title={data.error}>
          The {answer ? 'answer' : 'reading'} could not be written this time. The{' '}
          {answer ? 'numbers' : 'changes'} below are still current.
        </p>
      )}

      {answer && <p className="m-0 text-label text-muted">{answer.definition}</p>}

      <div className="grid gap-1">
        <h3 className="m-0 text-label font-medium text-muted">
          {answer ? 'The numbers' : 'What changed'}
        </h3>
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
          comes from the {answer ? 'numbers' : 'changes'} listed above
          {open
            ? `, counted at that time; the totals above include visits since, and the ${answer ? 'answer is rewritten when asked after an hour' : 'reading is rewritten every hour'}.`
            : '.'}
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
