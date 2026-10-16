import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleQuestionMark } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Scope, type WhyResult, type WhySubject } from '../api'
import { cx } from '../ui/cx'
import { KindTag } from './KindTag'

/** What "Why?" needs from the dashboard. Left out where AI is off or on a public link. */
export interface WhyContext {
  siteId: string
  scope: Scope
  /** Whether the viewer is an admin, who can have an answer written. */
  canWrite: boolean
}

const STATUS: Record<Exclude<WhyResult['status'], 'ok'>, string> = {
  off: 'AI analysis is off for this site.',
  unconfigured: 'Set ANTHROPIC_API_KEY in .env to ask why.',
  key_rejected: 'The API key was refused. Replace ANTHROPIC_API_KEY in .env.',
  no_credit: 'The Claude account is out of credit.',
  over_budget: "Today's AI budget is spent; ask again tomorrow (UTC).",
  error: 'The answer could not be written this time. Try again in a moment.',
}

/**
 * A "Why?" button and, once pressed, its answer: the one last written for this range, or a new
 * one when there is none and the viewer is an admin.
 */
export function useWhy(context: WhyContext | undefined, subject: WhySubject) {
  const [open, setOpen] = useState(false)
  const button = context ? (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className={cx(
        'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-sm border px-2 text-label font-medium',
        open ? 'border-ink bg-ink text-on-ink' : 'border-line text-ink hover:bg-sunken',
      )}
    >
      <CircleQuestionMark className="size-3.5" strokeWidth={2} aria-hidden="true" />
      Why?
    </button>
  ) : null
  const answer = context && open ? <Answer context={context} subject={subject} /> : null
  return { button, answer }
}

function Answer({ context, subject }: { context: WhyContext; subject: WhySubject }) {
  const queryClient = useQueryClient()
  const { siteId, canWrite } = context
  // A visitor's events are read whatever the filters; a lane is counted under them.
  const scope = 'visitor' in subject ? { ...context.scope, filters: {} } : context.scope
  const key = ['why', siteId, scope.range.from, scope.range.to, scope.filters, subject]
  const cached = useQuery({ queryKey: key, queryFn: () => api.why(scope, subject) })
  const write = useMutation({
    mutationFn: () => api.writeWhy(scope, subject),
    onSuccess: (data) => queryClient.setQueryData<WhyResult>(key, data),
  })
  const missing = cached.data && !cached.data.answer && cached.data.status === 'ok'
  const { mutate, isIdle } = write
  useEffect(() => {
    if (missing && canWrite && isIdle) mutate()
  }, [missing, canWrite, isIdle, mutate])

  const data = write.data?.status && write.data.status !== 'ok' ? write.data : cached.data
  const lines = data?.answer?.lines
  return (
    <div
      className="grid gap-2.5 rounded-sm border border-line bg-sunken/30 p-3"
      aria-busy={cached.isFetching || write.isPending}
    >
      {cached.isError ? (
        <p className="m-0 text-label text-muted">
          Could not load the answer: {String(cached.error)}
        </p>
      ) : write.isError ? (
        <p className="m-0 text-label text-muted">
          Could not write the answer: {String(write.error)}
        </p>
      ) : !data || write.isPending ? (
        <div className="grid gap-2" role="status">
          <span className="text-label text-muted">Reading the numbers behind this…</span>
          {[90, 70].map((w) => (
            <div
              key={w}
              className="h-3.5 animate-pulse rounded-xs bg-sunken"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : (
        <>
          {data.status !== 'ok' && (
            <p className="m-0 text-label text-muted" title={data.error}>
              {STATUS[data.status]}
            </p>
          )}
          {!data.answer && data.status === 'ok' && !canWrite && (
            <p className="m-0 text-label text-muted">
              Nobody has asked yet. An admin of this site can.
            </p>
          )}
          {lines && lines.length === 0 && (
            <p className="m-0 text-label text-muted">
              Nothing in the answer held up against the numbers. Ask again.
            </p>
          )}
          {lines && lines.length > 0 && (
            <ol className="m-0 grid list-none gap-2 p-0">
              {lines.map((line, i) => (
                <li key={`${i}-${line.text}`} className="grid items-baseline gap-1">
                  <KindTag kind={line.kind} />
                  <p className="m-0 font-serif text-body">{line.text}</p>
                </li>
              ))}
            </ol>
          )}
          {data.answer && (
            <p className="m-0 flex flex-wrap items-center gap-x-2 text-tick text-muted">
              Written{' '}
              {new Date(data.answer.generatedAt).toLocaleString('en', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              by {data.answer.model}
              {canWrite && data.status === 'ok' && (
                <button
                  type="button"
                  onClick={() => write.mutate()}
                  className="cursor-pointer text-ink underline underline-offset-2"
                >
                  Ask again
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}
