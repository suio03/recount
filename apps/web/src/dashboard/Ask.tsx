import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircleQuestionMark } from 'lucide-react'
import { useState } from 'react'
import { type AskAnswer, type AskResult, type AskStep, api, type Scope } from '../api'
import { cx } from '../ui/cx'
import { Button, inputClass } from '../ui/Form'
import { rangeLabel } from './format'
import { KindTag } from './KindTag'

/** Kept in step with the API's limit. */
const MAX_QUESTION = 300

/** Offered before anyone has asked about the period. */
const SUGGESTIONS = [
  'Where do the visitors who convert come from?',
  'What changed against the period before, and why?',
  'Which pages lose the most people before they pay?',
]

const STATUS: Record<Exclude<AskResult['status'], 'ok'>, string> = {
  off: 'AI analysis is off for this site.',
  unconfigured: 'Set ANTHROPIC_API_KEY in .env to ask a question.',
  key_rejected: 'The API key was refused. Replace ANTHROPIC_API_KEY in .env.',
  no_credit: 'The Claude account is out of credit.',
  over_budget: "Today's AI budget is spent; ask again tomorrow (UTC).",
  error: 'The answer could not be written this time. Try again in a moment.',
}

const written = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * Ask: a free question about the period, answered by the model from the same read-only queries
 * the MCP server offers, in lines marked fact or guess with the queries it ran. Admins ask;
 * everyone sees the answers already written for the period. Reads the whole site, whatever the
 * filters.
 */
export function Ask({
  siteId,
  scope,
  canWrite,
}: {
  siteId: string
  scope: Scope
  /** Whether the viewer is an admin, who can ask. */
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { from, to } = scope.range
  const whole = { ...scope, filters: {} }
  const key = ['asks', siteId, from, to]
  const asks = useQuery({ queryKey: key, queryFn: () => api.asks(whole) })
  const [draft, setDraft] = useState('')
  // The answer shown; the newest when none is picked.
  const [picked, setPicked] = useState<string>()
  const ask = useMutation({
    mutationFn: (question: string) => api.ask(whole, question),
    onSuccess: (data) => {
      if (!data.answer) return
      setPicked(data.answer.question)
      setDraft('')
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })

  const list = asks.data?.asks ?? []
  const shown = list.find((a) => a.question === picked) ?? (picked ? undefined : list[0])
  // A fresh answer shows before the list is fetched again.
  const answer = ask.data?.answer?.question === picked ? (ask.data?.answer ?? shown) : shown
  const failed = ask.data && ask.data.status !== 'ok' ? ask.data : undefined
  const status = asks.data?.status
  const canAsk = canWrite && status === 'ok'

  function submit(question: string) {
    const q = question.trim()
    if (q.length < 3 || ask.isPending) return
    setPicked(q)
    ask.mutate(q)
  }

  return (
    <section
      id="ask"
      className="grid min-w-0 scroll-mt-20 content-start gap-4 rounded-md border border-line bg-surface p-4"
      aria-busy={asks.isFetching || ask.isPending}
    >
      <div className="grid gap-0.5">
        <h2 className="m-0 flex items-center gap-2 text-body font-semibold">
          <MessageCircleQuestionMark
            className="size-4 text-muted"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          Ask
          <span className="font-normal text-muted">· {rangeLabel({ from, to })}</span>
        </h2>
        <p className="m-0 text-label text-muted">
          Answered from the same queries as the numbers below, each line marked as a fact or a
          guess, with the queries it ran.
        </p>
      </div>

      {canAsk && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit(draft)
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Your question</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_QUESTION}
                placeholder="Why did nobody pay this week?"
                className={cx(inputClass, 'w-full')}
                disabled={ask.isPending}
              />
            </label>
            <Button type="submit" disabled={ask.isPending || draft.trim().length < 3}>
              {ask.isPending ? 'Reading…' : 'Ask'}
            </Button>
          </div>
          {list.length === 0 && !ask.isPending && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="cursor-pointer rounded-full border border-line px-2.5 py-0.5 text-label text-muted hover:bg-sunken hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </form>
      )}

      {asks.isError ? (
        <p className="m-0 text-muted">Could not load the answers: {String(asks.error)}</p>
      ) : ask.isError ? (
        <p className="m-0 text-muted">Could not ask: {String(ask.error)}</p>
      ) : !asks.data ? (
        <div className="h-10 animate-pulse rounded-sm bg-sunken/40" />
      ) : (
        <>
          {failed && (
            <p className="m-0 text-muted" title={failed.error}>
              {STATUS[failed.status as keyof typeof STATUS]}
            </p>
          )}
          {!failed && status && status !== 'ok' && canWrite && (
            <p className="m-0 text-muted">{STATUS[status]}</p>
          )}
          {ask.isPending ? (
            <Reading question={picked ?? ''} />
          ) : answer ? (
            <Answer answer={answer} onAgain={canAsk ? () => submit(answer.question) : undefined} />
          ) : (
            !canWrite && (
              <p className="m-0 text-muted">
                Nobody has asked about this period yet. An admin of this site can.
              </p>
            )
          )}
          {list.length > 1 && (
            <div className="grid gap-1.5 border-t border-line pt-3">
              <h3 className="m-0 text-label font-medium text-muted">Asked about this period</h3>
              <ul className="m-0 grid list-none gap-0.5 p-0">
                {list.map((a) => (
                  <li key={a.question}>
                    <button
                      type="button"
                      onClick={() => setPicked(a.question)}
                      aria-current={a.question === answer?.question}
                      className={cx(
                        'w-full cursor-pointer truncate rounded-xs px-1.5 py-1 text-left text-label hover:bg-sunken',
                        a.question === answer?.question ? 'font-medium text-ink' : 'text-muted',
                      )}
                    >
                      {a.question}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Reading({ question }: { question: string }) {
  return (
    <div className="grid gap-3" role="status">
      <p className="m-0 font-medium">{question}</p>
      <span className="text-label text-muted">Running the queries this needs…</span>
      {[92, 100, 70].map((w) => (
        <div
          key={w}
          className="h-4 animate-pulse rounded-xs bg-sunken"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  )
}

function Answer({ answer, onAgain }: { answer: AskAnswer; onAgain?: () => void }) {
  return (
    <article className="grid gap-3">
      <p className="m-0 font-medium">{answer.question}</p>
      {answer.lines.length === 0 ? (
        <p className="m-0 text-muted">
          Nothing in the answer held up against the numbers. Ask again.
        </p>
      ) : (
        <ol className="m-0 grid list-none gap-3 p-0">
          {answer.lines.map((line, i) => (
            <li
              key={`${i}-${line.text}`}
              className="grid items-baseline gap-x-3 gap-y-1 sm:grid-cols-[3.5rem_minmax(0,1fr)]"
            >
              <KindTag kind={line.kind} />
              <p className="m-0 font-serif text-note">
                {line.text}
                {line.evidence.length > 0 && (
                  <span className="ml-1.5 font-sans text-tick text-muted">
                    {line.evidence.join(' ')}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
      {answer.steps.length > 0 && (
        <details className="text-label text-muted">
          <summary className="cursor-pointer">
            {answer.steps.length === 1 ? '1 query' : `${answer.steps.length} queries`} run
          </summary>
          <ol className="m-0 mt-1.5 grid list-none gap-1 p-0">
            {answer.steps.map((s) => (
              <li key={s.id} className="flex min-w-0 gap-2 font-mono text-tick">
                <span className="shrink-0">{s.id}</span>
                <span className={cx('min-w-0 break-words', !s.ok && 'line-through')}>
                  {describe(s, answer.range)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="m-0 flex flex-wrap items-center gap-x-2 text-tick text-muted">
        Written {written.format(new Date(answer.generatedAt))} by {answer.model}
        {onAgain && (
          <button
            type="button"
            onClick={onAgain}
            className="cursor-pointer text-ink underline underline-offset-2"
          >
            Ask again
          </button>
        )}
      </p>
    </article>
  )
}

/** A query in one line: its name and what it was asked, leaving out the answer's own range. */
function describe(step: AskStep, range: AskAnswer['range']) {
  const { from, to, filters, ...rest } = step.input as Record<string, unknown>
  const parts = Object.entries(rest).map(([k, v]) => `${k}=${String(v)}`)
  if ((from && from !== range.from) || (to && to !== range.to))
    parts.push(`${String(from ?? range.from)}…${String(to ?? range.to)}`)
  if (filters && typeof filters === 'object')
    for (const [k, v] of Object.entries(filters)) if (v) parts.push(`${k}:${String(v)}`)
  return `${step.tool}(${parts.join(', ')})`
}
