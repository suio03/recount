import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, NotebookPen } from 'lucide-react'
import {
  api,
  type BriefResult,
  type BriefSection,
  type Filters,
  type Scope,
  type Site,
} from '../api'
import { Button } from '../ui/Form'
import { AiSwitch } from './AiSwitch'
import { rangeLabel } from './format'
import { KindTag } from './KindTag'
import { useOpenSection } from './sections'

const SECTIONS: Record<BriefSection, string> = {
  traffic: 'Traffic',
  tried: 'Tried to pay',
  paths: 'Paths',
  quiet: 'Went quiet',
}

const written = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

/**
 * The brief: a few lines on the range, each marked as a fact or a guess and linked to the
 * section that shows it. It is written only when an admin asks, never on open, and reads the
 * whole site whatever the filters, so following a line's filters keeps it in place.
 */
export function Brief({
  site,
  scope,
  canWrite,
  onShow,
}: {
  site: Pick<Site, 'id' | 'ai'>
  scope: Scope
  /** Whether the viewer is an admin, who can write the brief and switch AI on. */
  canWrite: boolean
  /** Replaces the dashboard's filters with a line's, to show its evidence. */
  onShow: (filters: Filters) => void
}) {
  const queryClient = useQueryClient()
  const { from, to } = scope.range
  const whole = { ...scope, filters: {} }
  const key = ['brief', site.id, from, to]
  const brief = useQuery({ queryKey: key, queryFn: () => api.brief(whole) })
  const write = useMutation({
    mutationFn: () => api.writeBrief(whole),
    onSuccess: (data) => queryClient.setQueryData<BriefResult>(key, data),
  })

  const data = write.data?.status && write.data.status !== 'ok' ? write.data : brief.data
  const lines = data?.brief?.lines
  const filtered = Object.values(scope.filters).some(Boolean)

  return (
    <section
      id="brief"
      className="grid min-w-0 scroll-mt-20 content-start gap-4 rounded-md border border-line bg-surface p-4"
      aria-busy={brief.isFetching || write.isPending}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h2 className="m-0 flex items-center gap-2 text-body font-semibold">
            <NotebookPen className="size-4 text-muted" strokeWidth={1.75} aria-hidden="true" />
            The brief
            {data?.brief && (
              <span className="font-normal text-muted">· {rangeLabel(data.brief.range)}</span>
            )}
          </h2>
          {data?.brief && (
            <p className="m-0 text-label text-muted">
              Written {written.format(new Date(data.brief.generatedAt))} by {data.brief.model}, from
              the whole site{filtered ? ', not only the filters set above' : ''}.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {canWrite && data?.brief && data.status === 'ok' && (
            <Button variant="quiet" onClick={() => write.mutate()} disabled={write.isPending}>
              Rewrite
            </Button>
          )}
          {canWrite && <AiSwitch site={site} />}
        </div>
      </header>

      {brief.isError ? (
        <p className="m-0 text-muted">Could not load the brief: {String(brief.error)}</p>
      ) : write.isError ? (
        <p className="m-0 text-muted">Could not write the brief: {String(write.error)}</p>
      ) : !data ? (
        <div className="h-10 animate-pulse rounded-sm bg-sunken/40" />
      ) : write.isPending ? (
        <Writing />
      ) : (
        <>
          <Status data={data} canWrite={canWrite} />
          {lines && lines.length > 0 && <Lines lines={lines} onShow={onShow} />}
          {lines && lines.length === 0 && (
            <p className="m-0 text-muted">
              Nothing in the brief held up against the numbers, so it is empty. Write it again.
            </p>
          )}
          {!data.brief && data.status === 'ok' && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 max-w-[60ch] text-muted">
                {canWrite
                  ? 'Want this period in a few lines? Recount reads the numbers below and writes them down, each line marked as a fact or a guess and linked to the section that shows it.'
                  : 'No brief for this period yet. An admin of this site can write one.'}
              </p>
              {canWrite && <Button onClick={() => write.mutate()}>Write the brief</Button>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Writing() {
  return (
    <div className="grid gap-3" role="status">
      <span className="text-label text-muted">Reading the numbers below…</span>
      {[92, 100, 76].map((w) => (
        <div
          key={w}
          className="h-4 animate-pulse rounded-xs bg-sunken"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  )
}

/** Why no brief can be written, or why the last try failed. */
function Status({ data, canWrite }: { data: BriefResult; canWrite: boolean }) {
  const message = {
    ok: null,
    off: canWrite
      ? 'AI analysis is off for this site. Switch it on above to have the numbers below written up in a few lines.'
      : 'AI analysis is off for this site. An admin can switch it on.',
    unconfigured: (
      <>
        Set <code className="font-mono text-path">ANTHROPIC_API_KEY</code> in{' '}
        <code className="font-mono text-path">.env</code> to write the brief.
      </>
    ),
    key_rejected:
      'The API key was refused; it may have expired or been revoked. Create a new one in the Claude Console and replace ANTHROPIC_API_KEY in .env.',
    no_credit: 'The Claude account is out of credit. Add credit in the Claude Console.',
    over_budget:
      "Today's AI budget is spent, so the brief can be written again tomorrow (UTC). The day's spend is under Account → Usage.",
    error: 'The brief could not be written this time. Try again in a moment.',
  }[data.status]
  if (!message) return null
  return (
    <p className="m-0 text-muted" title={data.error}>
      {message}
    </p>
  )
}

function Lines({
  lines,
  onShow,
}: {
  lines: NonNullable<BriefResult['brief']>['lines']
  onShow: (filters: Filters) => void
}) {
  const open = useOpenSection()
  function follow(section: BriefSection, filters?: Filters) {
    if (filters) onShow(filters)
    // Filters re-render the sections first, so opening waits for them.
    setTimeout(() => open(section), filters ? 150 : 0)
  }
  return (
    <ol className="m-0 grid list-none gap-3 p-0">
      {lines.map((line, i) => (
        <li
          key={`${i}-${line.text}`}
          className="grid items-baseline gap-x-3 gap-y-1 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]"
        >
          <KindTag kind={line.kind} />
          <p className="m-0 font-serif text-note">{line.text}</p>
          <button
            type="button"
            onClick={() => follow(line.section, line.filters)}
            title={line.filters ? 'Show this with its filters' : 'Show this below'}
            className="inline-flex w-fit cursor-pointer items-center gap-1 whitespace-nowrap text-label text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {SECTIONS[line.section]}
            <ArrowDown className="size-3" strokeWidth={2} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ol>
  )
}
