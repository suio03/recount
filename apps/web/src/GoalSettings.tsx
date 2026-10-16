import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Funnel, Plus, Target, X } from 'lucide-react'
import { useState } from 'react'
import {
  api,
  type FunnelStep,
  type GoalDefinition,
  type GoalMatch,
  type Match,
  type Scope,
  type Site,
} from './api'
import { Button, ConfirmButton, ErrorText, Field, inputClass } from './ui/Form'
import { Panel } from './ui/Panel'
import { SegmentedControl } from './ui/SegmentedControl'

const errorOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A goal's or step's rule in a few words. */
export function describe(match: Match) {
  if (match.kind === 'event') return `Custom event ${match.name}`
  if (match.kind === 'page') return `Visited ${match.path}`
  return [
    match.text ? `Click on “${match.text}”` : 'Click',
    match.section && `in ${match.section}`,
    match.page && `on ${match.page}`,
    match.href && `linking to ${match.href}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Dashboard queries keyed by a scope that a goal's rule can change: through the goal filter,
 * which every panel applies, or the goal findings the reading and its cache key carry.
 */
const SCOPED_BY_GOALS = new Set([
  'main',
  'breakdown',
  'goals',
  'intent',
  'funnel',
  'reading',
  'question',
  'replays',
  'replayDigest',
])

/** Refetches what a change to goals or funnels shows up in: these settings and the dashboard. */
export function useRefresh(siteId: string, changed: 'goals' | 'funnels') {
  const queryClient = useQueryClient()
  return () => {
    // Drafted goals and funnels say whether they are added or were removed.
    queryClient.invalidateQueries({ queryKey: ['semantics', siteId] })
    if (changed === 'goals') {
      queryClient.invalidateQueries({ queryKey: ['defined-goals', siteId] })
      queryClient.invalidateQueries({
        predicate: ({ queryKey: [kind, scope] }) =>
          SCOPED_BY_GOALS.has(kind as string) && (scope as Scope | undefined)?.siteId === siteId,
      })
    } else {
      queryClient.invalidateQueries({ queryKey: ['defined-funnels', siteId] })
      queryClient.invalidateQueries({ queryKey: ['funnels', siteId] })
      queryClient.invalidateQueries({
        predicate: ({ queryKey: [kind, scope] }) =>
          kind === 'funnel' && (scope as Scope | undefined)?.siteId === siteId,
      })
    }
  }
}

const useDefinedGoals = (siteId: string) =>
  useQuery({ queryKey: ['defined-goals', siteId], queryFn: () => api.definedGoals(siteId) })

type Kind = GoalMatch['kind']

/** Goals defined by a page visit or a click, next to the custom events that are goals already. */
export function GoalSettings({ site }: { site: Site }) {
  const refresh = useRefresh(site.id, 'goals')
  const defined = useDefinedGoals(site.id)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('click')
  const [path, setPath] = useState('')
  const [click, setClick] = useState({ text: '', section: '', page: '', href: '' })
  const match: GoalMatch =
    kind === 'page'
      ? { kind, path: path.trim() }
      : {
          kind,
          ...Object.fromEntries(
            Object.entries(click)
              .map(([k, v]) => [k, v.trim()])
              .filter(([, v]) => v),
          ),
        }
  const ready =
    name.trim() && (kind === 'page' ? path.trim() : click.text || click.section || click.href)
  const create = useMutation({
    mutationFn: () => api.createGoal(site.id, { name: name.trim(), match }),
    onSuccess: () => {
      setName('')
      setPath('')
      setClick({ text: '', section: '', page: '', href: '' })
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGoal(site.id, id),
    onSuccess: refresh,
  })
  const goals = defined.data?.goals ?? []
  const events = defined.data?.events ?? []
  const clickField = (key: keyof typeof click) => ({
    value: click[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setClick((c) => ({ ...c, [key]: e.target.value })),
  })
  return (
    <Panel title="Goals">
      <p className="m-0 text-body text-muted">
        Custom events are goals already
        {events.length > 0 && (
          <>
            {' '}
            (
            {events.slice(0, 6).map((e, i) => (
              <span key={e}>
                {i > 0 && ', '}
                <code className="font-mono text-path">{e}</code>
              </span>
            ))}
            {events.length > 6 && `, ${events.length - 6} more`})
          </>
        )}
        . Define one here for a page visit or a click without changing the site&apos;s code. A goal
        counts past visits too.
      </p>
      {defined.isError && <ErrorText>{errorOf(defined.error)}</ErrorText>}
      {goals.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {goals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              busy={remove.isPending}
              onDelete={() => remove.mutate(g.id)}
            />
          ))}
        </ul>
      )}
      {remove.isError && <ErrorText>{errorOf(remove.error)}</ErrorText>}
      <form
        className="grid gap-3 border-line border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field
              label="Name"
              required
              maxLength={120}
              placeholder={kind === 'page' ? 'Saw pricing' : 'Started checkout'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <span className="flex h-9 items-center">
            <SegmentedControl
              label="What reaches the goal"
              options={[
                { value: 'click', label: 'Click' },
                { value: 'page', label: 'Page visit' },
              ]}
              value={kind}
              onChange={setKind}
            />
          </span>
        </div>
        {kind === 'page' ? (
          <Field
            label="Page path"
            required
            placeholder="/pricing"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            hint={
              <>
                <code className="font-mono">*</code> matches anything:{' '}
                <code className="font-mono">/blog/*</code> is every post.
              </>
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Button or link text contains"
                placeholder="Get started"
                maxLength={120}
                {...clickField('text')}
              />
              <Field
                label="In section"
                placeholder="hero"
                maxLength={80}
                {...clickField('section')}
              />
              <Field label="On page (optional)" placeholder="/pricing" {...clickField('page')} />
              <Field
                label="Link address contains (optional)"
                placeholder="checkout.paddle.com"
                {...clickField('href')}
              />
            </div>
            <p className="m-0 text-label text-muted">
              Fill in at least one of text, section or link. Text is matched without case and also
              against the element&apos;s aria-label. Sections come from{' '}
              <code className="font-mono">data-rc-section</code>, a section&apos;s id or label, or
              header, nav, main and footer.
            </p>
          </>
        )}
        {create.isError && <ErrorText>{errorOf(create.error)}</ErrorText>}
        <div>
          <Button
            type="submit"
            disabled={create.isPending || !ready}
            className="inline-flex items-center gap-1.5"
          >
            <Target className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Add goal
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function GoalRow({
  goal,
  busy,
  onDelete,
}: {
  goal: GoalDefinition
  busy: boolean
  onDelete: () => void
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-line border-t py-2 first:border-t-0">
      <span className="min-w-0">
        <span className="block text-body font-medium">{goal.name}</span>
        <span className="block truncate text-label text-muted">
          {describe(goal.match)}
          {goal.drafted && ' · drafted by AI'}
        </span>
      </span>
      <ConfirmButton label="Delete" confirm="Confirm delete" disabled={busy} onConfirm={onDelete} />
    </li>
  )
}

/** A step being picked: a defined goal, a custom event, or a page path typed in. */
interface Draft {
  choice: string
  path: string
}

const MAX_STEPS = 8
const emptyDraft = (): Draft => ({ choice: '', path: '' })

/** Funnels: ordered steps a visit goes through, shown on the dashboard. */
export function FunnelSettings({ site }: { site: Site }) {
  const refresh = useRefresh(site.id, 'funnels')
  const defined = useDefinedGoals(site.id)
  const funnels = useQuery({
    queryKey: ['defined-funnels', site.id],
    queryFn: () => api.definedFunnels(site.id),
  })
  const [name, setName] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([emptyDraft(), emptyDraft()])
  const goals = defined.data?.goals ?? []
  const events = defined.data?.events ?? []

  const stepOf = (d: Draft): FunnelStep | undefined => {
    if (d.choice === 'page') {
      const path = d.path.trim()
      return path ? { name: path, match: { kind: 'page', path } } : undefined
    }
    if (d.choice.startsWith('event:')) {
      const event = d.choice.slice(6)
      return { name: event, match: { kind: 'event', name: event } }
    }
    const goal = goals.find((g) => `goal:${g.id}` === d.choice)
    return goal && { name: goal.name, match: goal.match }
  }
  const steps = drafts.map(stepOf)
  const ready = name.trim() && steps.every(Boolean)

  const create = useMutation({
    mutationFn: () =>
      api.createFunnel(site.id, { name: name.trim(), steps: steps as FunnelStep[] }),
    onSuccess: () => {
      setName('')
      setDrafts([emptyDraft(), emptyDraft()])
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFunnel(site.id, id),
    onSuccess: refresh,
  })
  const setDraft = (i: number, change: Partial<Draft>) =>
    setDrafts((all) => all.map((d, j) => (j === i ? { ...d, ...change } : d)))

  return (
    <Panel title="Funnels">
      <p className="m-0 text-body text-muted">
        A funnel counts the visitors who reach each step in order within one visit, and where the
        rest leave. Steps can be goals, custom events or pages.
      </p>
      {funnels.isError && <ErrorText>{errorOf(funnels.error)}</ErrorText>}
      {(funnels.data?.length ?? 0) > 0 && (
        <ul className="m-0 grid list-none p-0">
          {funnels.data?.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 border-line border-t py-2 first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block text-body font-medium">{f.name}</span>
                <span className="block truncate text-label text-muted">
                  {f.steps.map((s) => s.name).join(' → ')}
                  {f.drafted && ' · drafted by AI'}
                </span>
              </span>
              <ConfirmButton
                label="Delete"
                confirm="Confirm delete"
                disabled={remove.isPending}
                onConfirm={() => remove.mutate(f.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <ErrorText>{errorOf(remove.error)}</ErrorText>}
      <form
        className="grid gap-3 border-line border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <Field
          label="Name"
          required
          maxLength={120}
          placeholder="Signup"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <ol className="m-0 grid list-none gap-2 p-0">
          {drafts.map((d, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-12 text-label text-muted">Step {i + 1}</span>
              <select
                aria-label={`Step ${i + 1}`}
                className={`${inputClass} min-w-48 flex-1`}
                value={d.choice}
                onChange={(e) => setDraft(i, { choice: e.target.value })}
              >
                <option value="" disabled>
                  Choose…
                </option>
                <option value="page">A page…</option>
                {goals.length > 0 && (
                  <optgroup label="Goals">
                    {goals.map((g) => (
                      <option key={g.id} value={`goal:${g.id}`}>
                        {g.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {events.length > 0 && (
                  <optgroup label="Custom events">
                    {events.map((e) => (
                      <option key={e} value={`event:${e}`}>
                        {e}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {d.choice === 'page' && (
                <input
                  aria-label={`Step ${i + 1} page path`}
                  className={`${inputClass} min-w-40 flex-1 font-mono`}
                  placeholder="/pricing"
                  value={d.path}
                  onChange={(e) => setDraft(i, { path: e.target.value })}
                />
              )}
              <button
                type="button"
                aria-label={`Remove step ${i + 1}`}
                title="Remove step"
                disabled={drafts.length <= 2}
                onClick={() => setDrafts((all) => all.filter((_, j) => j !== i))}
                className="grid size-7 cursor-pointer place-items-center rounded-sm text-muted hover:bg-sunken hover:text-ink disabled:invisible"
              >
                <X className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ol>
        {create.isError && <ErrorText>{errorOf(create.error)}</ErrorText>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={create.isPending || !ready}
            className="inline-flex items-center gap-1.5"
          >
            <Funnel className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Add funnel
          </Button>
          <Button
            variant="quiet"
            disabled={drafts.length >= MAX_STEPS}
            onClick={() => setDrafts((all) => [...all, emptyDraft()])}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden="true" />
            Add step
          </Button>
        </div>
      </form>
    </Panel>
  )
}
