import type { SiteSemantics } from '@recount/semantic'
import { semanticsFor } from '@recount/sites'
import { and, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '../db/postgres'
import {
  type Funnel,
  funnels,
  type Goal,
  goals,
  type Site,
  semanticDismissals,
  semanticDrafts,
  sites,
} from '../db/schema'
import { GoalMatch, MAX_FUNNELS, MAX_GOALS, type Match } from '../stats/goals'
import type { DateRange } from '../stats/range'
import { type Conversion, type Draft, type DraftFunnel, draftSemantics } from './draft'
import { inventoryOf } from './inventory'

/**
 * Drafts kept in PostgreSQL, made on the schedule a site picks or when an admin asks, and the
 * goals and funnels they propose. A drafted goal or funnel is added only when nothing a person
 * made is in its way: a name a person removed or turned down is never added again on its own,
 * and an existing goal or funnel is never replaced.
 */

const DAY = 86_400_000
/** How long after a draft the next one is due. An hour less, so the hourly check is not late. */
const INTERVAL = { daily: DAY - 3_600_000, weekly: 7 * DAY - 3_600_000 }
const KEEP = 10

export function last30Days(timezone: string, now = Date.now()): DateRange {
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: timezone })
  return { from: day(now - 29 * DAY), to: day(now) }
}

/**
 * Where a drafted goal or funnel stands: `event` for a custom event, which is a goal already;
 * `added` when one with its name or rule exists; `taken` when its name is used by a different
 * rule; `dismissed` when a person removed or turned down its name; `new` otherwise.
 */
export type ItemStatus = 'new' | 'added' | 'taken' | 'dismissed' | 'event'

const key = (name: string) => name.trim().toLowerCase()

/** The same rule written with its fields in any order. */
export const sameRule = (a: unknown, b: unknown) => canonical(a) === canonical(b)
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

interface Defined {
  goals: Goal[]
  funnels: Funnel[]
  dismissed: Set<string>
}

async function definedOf(siteId: string): Promise<Defined> {
  const [g, f, d] = await Promise.all([
    db.select().from(goals).where(eq(goals.siteId, siteId)),
    db.select().from(funnels).where(eq(funnels.siteId, siteId)),
    db.select().from(semanticDismissals).where(eq(semanticDismissals.siteId, siteId)),
  ])
  return { goals: g, funnels: f, dismissed: new Set(d.map((x) => `${x.kind}:${x.name}`)) }
}

function conversionStatus(c: Conversion, d: Defined): { status: ItemStatus; as?: string } {
  if (c.match.kind === 'event') return { status: 'event' }
  const same = d.goals.find((g) => sameRule(g.match, c.match))
  if (same) return { status: 'added', as: same.name }
  const named = d.goals.find((g) => key(g.name) === key(c.name))
  if (named) return { status: 'taken' }
  if (d.dismissed.has(`goal:${key(c.name)}`)) return { status: 'dismissed' }
  return { status: 'new' }
}

function funnelStatus(f: DraftFunnel, d: Defined): { status: ItemStatus; as?: string } {
  const rules = f.steps.map((s) => s.match)
  const same = d.funnels.find((x) =>
    sameRule(
      x.steps.map((s) => s.match),
      rules,
    ),
  )
  if (same) return { status: 'added', as: same.name }
  if (d.funnels.some((x) => key(x.name) === key(f.name))) return { status: 'taken' }
  if (d.dismissed.has(`funnel:${key(f.name)}`)) return { status: 'dismissed' }
  return { status: 'new' }
}

export type DraftRow = typeof semanticDrafts.$inferSelect

export const latestDraft = async (siteId: string) =>
  db.query.semanticDrafts.findFirst({
    where: eq(semanticDrafts.siteId, siteId),
    orderBy: desc(semanticDrafts.createdAt),
  })

/** The latest draft with where each of its goals and funnels stands now. */
export async function draftView(site: Site) {
  const row = await latestDraft(site.id)
  if (!row) return null
  const defined = await definedOf(site.id)
  const body = row.body
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    range: { from: row.rangeFrom, to: row.rangeTo },
    error: row.error,
    draft: body && {
      ...body,
      conversions: body.conversions.map((c) => ({ ...c, ...conversionStatus(c, defined) })),
      funnels: body.funnels.map((f) => ({ ...f, ...funnelStatus(f, defined) })),
    },
  }
}

/**
 * What the model is told about a site: the catalog in `sites/` when it has one, which a person
 * wrote and which overrides any draft; otherwise the latest draft's description, with the custom
 * events it names as conversions, the primary ones as key events.
 */
export async function semanticsOf(site: Site): Promise<SiteSemantics | undefined> {
  const written = semanticsFor(site.domain)
  if (written) return written
  const row = await db.query.semanticDrafts.findFirst({
    where: and(eq(semanticDrafts.siteId, site.id), isNotNull(semanticDrafts.body)),
    orderBy: desc(semanticDrafts.createdAt),
  })
  const draft = row?.body
  if (!draft?.about) return undefined
  return {
    domain: site.domain,
    about: draft.about,
    events: draft.conversions.flatMap((c) =>
      c.match.kind === 'event'
        ? [{ name: c.match.name, description: c.why, key: c.primary, stage: 'conversion' as const }]
        : [],
    ),
    metrics: [],
  }
}

export class DraftError extends Error {}

/** Adds one drafted goal or funnel by name, from the latest draft; a person asking clears a dismissal. */
export async function applyItem(site: Site, kind: 'goal' | 'funnel', name: string) {
  const row = await latestDraft(site.id)
  if (!row?.body) throw new DraftError('There is no draft')
  const defined = await definedOf(site.id)
  defined.dismissed.delete(`${kind}:${key(name)}`)
  const added =
    kind === 'goal'
      ? await addGoal(
          site,
          row.body.conversions.find((c) => key(c.name) === key(name)),
          defined,
        )
      : await addFunnel(
          site,
          row.body.funnels.find((f) => key(f.name) === key(name)),
          defined,
        )
  await db
    .delete(semanticDismissals)
    .where(
      and(
        eq(semanticDismissals.siteId, site.id),
        eq(semanticDismissals.kind, kind),
        eq(semanticDismissals.name, key(name)),
      ),
    )
  return added
}

async function addGoal(site: Site, c: Conversion | undefined, d: Defined) {
  if (!c) throw new DraftError('The draft has no goal by that name')
  const { status } = conversionStatus(c, d)
  if (status !== 'new') throw new DraftError(statusError(status))
  if (d.goals.length >= MAX_GOALS) throw new DraftError(`A site can have up to ${MAX_GOALS} goals`)
  const match = GoalMatch.parse(c.match)
  const [goal] = await db
    .insert(goals)
    .values({ siteId: site.id, name: c.name, match, drafted: true })
    .onConflictDoNothing()
    .returning()
  if (!goal) throw new DraftError(statusError('taken'))
  d.goals.push(goal)
  return goal
}

async function addFunnel(site: Site, f: DraftFunnel | undefined, d: Defined) {
  if (!f) throw new DraftError('The draft has no funnel by that name')
  const { status } = funnelStatus(f, d)
  if (status !== 'new') throw new DraftError(statusError(status))
  if (d.funnels.length >= MAX_FUNNELS)
    throw new DraftError(`A site can have up to ${MAX_FUNNELS} funnels`)
  const steps = f.steps.map((s) => ({ name: s.name, match: s.match as Match }))
  const [funnel] = await db
    .insert(funnels)
    .values({ siteId: site.id, name: f.name, steps, drafted: true })
    .onConflictDoNothing()
    .returning()
  if (!funnel) throw new DraftError(statusError('taken'))
  d.funnels.push(funnel)
  return funnel
}

function statusError(status: ItemStatus) {
  switch (status) {
    case 'event':
      return 'A custom event is a goal already'
    case 'added':
      return 'It is added already'
    case 'taken':
      return 'That name is used by another rule'
    case 'dismissed':
      return 'It was turned down'
    case 'new':
      return ''
  }
}

/** Records that a person removed or turned down a goal or funnel, so drafts leave it out. */
export async function dismiss(siteId: string, kind: 'goal' | 'funnel', name: string) {
  await db
    .insert(semanticDismissals)
    .values({ siteId, kind, name: key(name) })
    .onConflictDoNothing()
}

/** A person defining a goal or funnel by hand undoes an earlier removal of its name. */
export async function undismiss(siteId: string, kind: 'goal' | 'funnel', name: string) {
  await db
    .delete(semanticDismissals)
    .where(
      and(
        eq(semanticDismissals.siteId, siteId),
        eq(semanticDismissals.kind, kind),
        eq(semanticDismissals.name, key(name)),
      ),
    )
}

/** Adds every new goal and funnel of a draft, goals first, as far as the limits allow. */
async function applyAll(site: Site, draft: Draft) {
  const defined = await definedOf(site.id)
  for (const c of draft.conversions)
    if (conversionStatus(c, defined).status === 'new' && defined.goals.length < MAX_GOALS)
      await addGoal(site, c, defined).catch(() => undefined)
  for (const f of draft.funnels)
    if (funnelStatus(f, defined).status === 'new' && defined.funnels.length < MAX_FUNNELS)
      await addFunnel(site, f, defined).catch(() => undefined)
}

const running = new Map<string, Promise<DraftRow>>()

export const isDrafting = (siteId: string) => running.has(siteId)

/**
 * Drafts the site's semantics from its last 30 days and stores the result, or the reason there
 * is none. With `draft_apply` set to `auto`, adds the new goals and funnels. One draft runs per
 * site at a time; asking again while it runs waits for the same one.
 */
export function runDraft(site: Site): Promise<DraftRow> {
  const current = running.get(site.id)
  if (current) return current
  const run = (async () => {
    const range = last30Days(site.timezone)
    let body: Draft | null = null
    let error: string | null = null
    try {
      body = await draftSemantics(site, await inventoryOf(site, range), semanticsFor(site.domain))
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    const [row] = await db
      .insert(semanticDrafts)
      .values({ siteId: site.id, rangeFrom: range.from, rangeTo: range.to, body, error })
      .returning()
    await prune(site.id)
    if (body && site.draftApply === 'auto') await applyAll(site, body)
    return row as DraftRow
  })().finally(() => running.delete(site.id))
  running.set(site.id, run)
  return run
}

async function prune(siteId: string) {
  const keep = db
    .select({ id: semanticDrafts.id })
    .from(semanticDrafts)
    .where(eq(semanticDrafts.siteId, siteId))
    .orderBy(desc(semanticDrafts.createdAt))
    .limit(KEEP)
  await db
    .delete(semanticDrafts)
    .where(and(eq(semanticDrafts.siteId, siteId), sql`${semanticDrafts.id} NOT IN (${keep})`))
}

/** Drafts every site whose schedule says one is due, one site at a time. */
export async function draftDue(now = Date.now()) {
  const scheduled = await db
    .select()
    .from(sites)
    .where(and(eq(sites.ai, true), ne(sites.draftSchedule, 'off')))
  if (!scheduled.length) return
  const lastRows = await db
    .select({
      siteId: semanticDrafts.siteId,
      last: sql<string>`max(${semanticDrafts.createdAt})`,
    })
    .from(semanticDrafts)
    .where(
      inArray(
        semanticDrafts.siteId,
        scheduled.map((s) => s.id),
      ),
    )
    .groupBy(semanticDrafts.siteId)
  const last = new Map(lastRows.map((r) => [r.siteId, new Date(r.last).getTime()]))
  for (const site of scheduled) {
    if (site.draftSchedule === 'off') continue
    const at = last.get(site.id)
    if (at !== undefined && now - at < INTERVAL[site.draftSchedule]) continue
    await runDraft(site).catch((e) => console.error('semantics draft', site.domain, e))
  }
}
