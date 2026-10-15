import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { api, type DraftItemStatus, type SemanticDraft, type Semantics, type Site } from './api'
import { describe, useRefresh } from './GoalSettings'
import { Button, CopyBox, ErrorText } from './ui/Form'
import { Panel } from './ui/Panel'
import { SegmentedControl } from './ui/SegmentedControl'

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const day = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const count = (n: number) => n.toLocaleString('en')
const next = (iso: string, schedule: 'daily' | 'weekly') =>
  new Date(Date.parse(iso) + (schedule === 'daily' ? 1 : 7) * 86_400_000).toISOString()

/**
 * Goals and funnels the model drafted from the site's last 30 days, each checked against the data,
 * with what the browser cannot see. Admins pick how often a draft is made and whether its goals
 * and funnels wait for review, and add or turn down each one.
 */
export function DraftSettings({ site }: { site: Site }) {
  const queryClient = useQueryClient()
  const refreshGoals = useRefresh(site.id, 'goals')
  const refreshFunnels = useRefresh(site.id, 'funnels')
  const admin = site.role !== 'viewer'
  const semantics = useQuery({
    queryKey: ['semantics', site.id],
    queryFn: () => api.semantics(site.id),
    // A scheduled draft may be running when the page opens.
    refetchInterval: (q) => (q.state.data?.drafting ? 5000 : false),
  })
  const settle = (data: Semantics) => {
    queryClient.setQueryData(['semantics', site.id], data)
    refreshGoals()
    refreshFunnels()
  }
  const draft = useMutation({ mutationFn: () => api.draftSemantics(site.id), onSuccess: settle })
  const decide = useMutation({
    mutationFn: ({ add, kind, name }: { add: boolean; kind: 'goal' | 'funnel'; name: string }) =>
      add ? api.applyDrafted(site.id, kind, name) : api.dismissDrafted(site.id, kind, name),
    onSuccess: settle,
  })
  const change = useMutation({
    mutationFn: (c: Pick<Partial<Site>, 'draftSchedule' | 'draftApply'>) =>
      api.updateSite(site.id, c),
    onSuccess: (updated) =>
      queryClient.setQueryData<Site[]>(['sites'], (all) =>
        all?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
      ),
  })
  const schedule = change.isPending
    ? (change.variables.draftSchedule ?? site.draftSchedule)
    : site.draftSchedule
  const apply = change.isPending
    ? (change.variables.draftApply ?? site.draftApply)
    : site.draftApply
  const latest = semantics.data?.latest
  const drafting = draft.isPending || semantics.data?.drafting

  return (
    <Panel title="Drafted by AI">
      <p className="m-0 text-body text-muted">
        The model reads the last 30 days of {site.domain} and drafts what conversion means here and
        the paths to it. Code checks every part against the data and drops what matches nothing.
        Removing a drafted goal or funnel keeps later drafts from adding it again.
      </p>
      {!site.ai && (
        <p className="m-0 text-label text-muted">
          AI is off for this site. Turn it on with the AI switch on its dashboard to draft.
        </p>
      )}
      {semantics.data && !semantics.data.configured && (
        <p className="m-0 text-label text-muted">
          The server has no model key: set <code className="font-mono">ANTHROPIC_API_KEY</code>.
        </p>
      )}
      {admin && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className="flex items-center gap-2 text-label font-medium text-muted">
            Draft
            <SegmentedControl
              label="How often to draft"
              options={[
                { value: 'off', label: 'Off' },
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
              ]}
              value={schedule}
              onChange={(draftSchedule) => change.mutate({ draftSchedule })}
            />
          </span>
          <span className="flex items-center gap-2 text-label font-medium text-muted">
            New goals and funnels
            <SegmentedControl
              label="What happens to a draft's new goals and funnels"
              options={[
                { value: 'review', label: 'Wait for review' },
                { value: 'auto', label: 'Add on their own' },
              ]}
              value={apply}
              onChange={(draftApply) => change.mutate({ draftApply })}
            />
          </span>
          <Button
            variant="quiet"
            disabled={!site.ai || !semantics.data?.configured || Boolean(drafting)}
            onClick={() => draft.mutate()}
            className="inline-flex items-center gap-1.5"
          >
            {drafting && (
              <LoaderCircle className="size-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
            )}
            {drafting ? 'Drafting…' : 'Draft now'}
          </Button>
        </div>
      )}
      {change.isError && <ErrorText>{errorOf(change.error)}</ErrorText>}
      {draft.isError && <ErrorText>{errorOf(draft.error)}</ErrorText>}
      {semantics.isError && <ErrorText>{errorOf(semantics.error)}</ErrorText>}
      {drafting && (
        <p className="m-0 text-label text-muted" aria-live="polite">
          Reading the data and checking the draft. This takes up to a minute.
        </p>
      )}
      {latest && (
        <div className="grid gap-4 border-line border-t pt-3">
          <p className="m-0 text-label text-muted">
            {latest.error ? 'Tried' : 'Drafted'} {when(latest.createdAt)} from{' '}
            {day(latest.range.from)} to {day(latest.range.to)}
            {latest.draft && ` · ${latest.draft.model}`}
            {site.draftSchedule !== 'off' &&
              site.ai &&
              `. Next around ${when(next(latest.createdAt, site.draftSchedule))}`}
          </p>
          {latest.error && <ErrorText>No draft: {latest.error}</ErrorText>}
          {latest.draft && (
            <DraftBody
              draft={latest.draft}
              admin={admin}
              busy={decide.isPending}
              onDecide={(kind, name, add) => decide.mutate({ kind, name, add })}
            />
          )}
          {decide.isError && <ErrorText>{errorOf(decide.error)}</ErrorText>}
        </div>
      )}
      {semantics.data && !latest && !drafting && (
        <p className="m-0 text-label text-muted">No draft yet.</p>
      )}
    </Panel>
  )
}

function DraftBody({
  draft,
  admin,
  busy,
  onDecide,
}: {
  draft: SemanticDraft
  admin: boolean
  busy: boolean
  onDecide: (kind: 'goal' | 'funnel', name: string, add: boolean) => void
}) {
  return (
    <>
      {draft.about && <p className="m-0 text-body">{draft.about}</p>}
      <Section title="Conversions" empty="None held up against the data.">
        {draft.conversions.map((c) => (
          <Row
            key={c.name}
            title={c.name}
            tag={c.primary ? 'Primary' : undefined}
            rule={describe(c.match)}
            why={c.why}
            figure={`${count(c.visitors)} visitors`}
            action={
              <Decision
                status={c.status}
                as={c.as === c.name ? undefined : c.as}
                admin={admin}
                busy={busy}
                onDecide={(add) => onDecide('goal', c.name, add)}
              />
            }
          />
        ))}
      </Section>
      <Section title="Funnels" empty="None held up against the data.">
        {draft.funnels.map((f) => (
          <Row
            key={f.name}
            title={f.name}
            rule={f.steps.map((s) => `${s.name} (${count(s.visitors)})`).join(' → ')}
            why={f.why}
            action={
              <Decision
                status={f.status}
                as={f.as === f.name ? undefined : f.as}
                admin={admin}
                busy={busy}
                onDecide={(add) => onDecide('funnel', f.name, add)}
              />
            }
          />
        ))}
      </Section>
      {draft.gaps.length > 0 && (
        <Section title="What the data cannot show" empty="">
          {draft.gaps.map((g) => (
            <li key={g.title} className="grid gap-1.5 border-line border-t py-2 first:border-t-0">
              <span className="text-body font-medium">{g.title}</span>
              <span className="text-label text-muted">{g.why}</span>
              <CopyBox label="Add to the site" value={g.code} />
            </li>
          ))}
        </Section>
      )}
      {draft.dropped.length > 0 && (
        <details className="text-label text-muted">
          <summary className="cursor-pointer">
            {draft.dropped.length} {draft.dropped.length === 1 ? 'part' : 'parts'} dropped by the
            checks
          </summary>
          <ul className="m-0 mt-1.5 grid gap-1 pl-4">
            {draft.dropped.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function Section({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: React.ReactNode[]
}) {
  return (
    <section className="grid gap-1">
      <h3 className="m-0 text-label font-medium text-muted">{title}</h3>
      {children.length ? (
        <ul className="m-0 grid list-none p-0">{children}</ul>
      ) : (
        <p className="m-0 text-label text-muted">{empty}</p>
      )}
    </section>
  )
}

function Row({
  title,
  tag,
  rule,
  why,
  figure,
  action,
}: {
  title: string
  tag?: string
  rule: string
  why: string
  figure?: string
  action: React.ReactNode
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-line border-t py-2 first:border-t-0">
      <span className="grid min-w-0 flex-1 basis-72 gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 text-body font-medium">
          {title}
          {tag && (
            <span className="rounded-xs bg-sunken px-1.5 text-label font-normal text-muted">
              {tag}
            </span>
          )}
          {figure && (
            <span className="text-label font-normal text-muted tabular-nums">{figure}</span>
          )}
        </span>
        <span className="text-label text-muted">{rule}</span>
        <span className="text-label">{why}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">{action}</span>
    </li>
  )
}

const STATUS: Record<Exclude<DraftItemStatus, 'new'>, string> = {
  added: 'Added',
  taken: 'Name in use by another rule',
  dismissed: 'Turned down',
  event: 'A custom event, counted already',
}

function Decision({
  status,
  as,
  admin,
  busy,
  onDecide,
}: {
  status: DraftItemStatus
  as?: string
  admin: boolean
  busy: boolean
  onDecide: (add: boolean) => void
}) {
  if (status === 'new')
    return admin ? (
      <>
        <Button variant="quiet" disabled={busy} onClick={() => onDecide(false)}>
          Turn down
        </Button>
        <Button disabled={busy} onClick={() => onDecide(true)}>
          Add
        </Button>
      </>
    ) : (
      <span className="text-label text-muted">Waiting for review</span>
    )
  return (
    <>
      <span className="text-label text-muted">
        {STATUS[status]}
        {status === 'added' && as && ` as ${as}`}
      </span>
      {status === 'dismissed' && admin && (
        <Button variant="quiet" disabled={busy} onClick={() => onDecide(true)}>
          Add anyway
        </Button>
      )}
    </>
  )
}
