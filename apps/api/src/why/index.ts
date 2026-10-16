import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { AiUnavailable, structured } from '../ai/claude'
import { type Fact, factLines, Output, vettedLines } from '../brief/facts'
import { db } from '../db/postgres'
import { readings } from '../db/schema'
import { env } from '../env'
import { shortDay } from '../reading/format'
import { semanticsOf } from '../semantics/store'
import { compress, endingOf, hasProvider, keyEventsOf } from '../stats/intent'
import { laneDefinitionsOf } from '../stats/lanes'
import { lanesOf, MAX_STEPS, sideNames } from '../stats/paths'
import type { Scope } from '../stats/queries'
import { type DateRange, days, previousRange } from '../stats/range'
import { biggestDrop, laneFacts, personFacts } from './facts'
import { laneSplitOf, paidBy, SPLITS, senders, sidePropsOf, stuckAt, visitorOf } from './queries'

/**
 * "Why?": a few lines on one lane of the paths or one visitor who tried to pay, written when
 * someone asks and kept per range until it is rewritten. Code gathers the numbers, including the
 * property values the failures carried; the model only explains them, each line a fact or a
 * guess citing them.
 */

/** Bump when the prompt, the facts or the output shape changes, so old answers are not shown. */
const VERSION = 1
const MAX_LINES = 5

export type Subject = { kind: 'lane'; name: string } | { kind: 'visitor'; visitor: string }

export interface WhyAnswer {
  subject: Subject
  range: DateRange
  lines: Array<{ kind: 'fact' | 'guess'; text: string }>
  model: string
  generatedAt: string
}

export interface WhyResponse {
  answer: WhyAnswer | null
  /** As for the brief: whether an answer can be written, or why the last try failed. */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

/** The lane or visitor is not in this range, or no longer exists. */
export class WhyMissing extends Error {}

const RULES = `Rules:
- Use only the facts you are given. Never compute, estimate or round a number yourself; copy figures exactly as written in the facts you cite.
- Each line cites the ids of the facts it rests on.
- Start with what the facts show, marked "fact". Then the likely reasons, marked "guess", phrased as "likely" or "suggests", or as the two likely explanations ("Either ... or ..."). Property values on failure events, a split where one device, browser or channel does far worse, or the page people stopped on are the strongest leads; say when they point the same way.
- If one check would tell the guesses apart (for example, trying the checkout in a named browser), end with it as a guess.
- Say plainly when the numbers are too small to tell.
- 2 to ${MAX_LINES} lines, each one or two sentences of plain, specific English. Name events and pages as written. No preamble, no markdown.`

const LANE_SYSTEM = `You answer "Why?" for one path on a website's analytics dashboard: a funnel counted per visitor across the range. The owner wants to know why people stop where they do, and whether something is broken.

${RULES}`

const VISITOR_SYSTEM = `You answer "Why?" for one visitor who tried to pay on a website, shown on its analytics dashboard with their events in order. The owner wants to know why it ended the way it did: what this person was after, what got in the way, and whether something is broken.

${RULES}`

function keyOf(scope: Scope, subject: Subject) {
  // A lane is counted under the filters; a visitor's events are read whatever they are.
  const filters =
    subject.kind === 'lane'
      ? Object.entries(scope.filters)
          .filter(([, v]) => v)
          .sort()
      : []
  return createHash('sha256')
    .update(
      JSON.stringify([
        'why',
        scope.site.id,
        scope.range.from,
        scope.range.to,
        filters,
        subject,
        VERSION,
      ]),
    )
    .digest('hex')
}

function statusOf(scope: Scope): WhyResponse['status'] {
  if (!scope.site.ai) return 'off'
  return env.ANTHROPIC_API_KEY ? 'ok' : 'unconfigured'
}

/** The answer last written for this subject and range, if any. Never calls the model. */
export async function whyOf(scope: Scope, subject: Subject): Promise<WhyResponse> {
  const cached = await db.query.readings.findFirst({
    where: eq(readings.key, keyOf(scope, subject)),
  })
  return { answer: (cached?.body as WhyAnswer | undefined) ?? null, status: statusOf(scope) }
}

const inFlight = new Map<string, Promise<WhyResponse>>()

/** Writes the answer for this subject and range, replacing the last one. */
export async function writeWhy(scope: Scope, subject: Subject): Promise<WhyResponse> {
  const status = statusOf(scope)
  if (status !== 'ok') return { ...(await whyOf(scope, subject)), status }
  const key = keyOf(scope, subject)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<WhyResponse> => {
    try {
      const answer = await compose(scope, subject)
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body: answer })
        .onConflictDoUpdate({ target: readings.key, set: { body: answer, createdAt: new Date() } })
      return { answer, status: 'ok' }
    } catch (err) {
      if (err instanceof WhyMissing) throw err
      console.error('why failed:', err)
      const failed = err instanceof AiUnavailable ? err.kind : 'error'
      return { ...(await whyOf(scope, subject)), status: failed, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}

async function laneFactsOf(scope: Scope, name: string): Promise<Fact[]> {
  const { definitions, names } = await laneDefinitionsOf(scope.site)
  const definition = definitions.find((d) => d.name === name)
  if (!definition) throw new WhyMissing(`no path named "${name}"`)
  const { events } = await keyEventsOf(scope.site, names)
  const [lane] = await lanesOf(scope, [definition], sideNames(events, names))
  if (!lane?.steps[0]?.visitors) throw new WhyMissing(`nobody started "${name}" in this range`)
  const matches = definition.steps.slice(0, MAX_STEPS).map((s) => s.match)
  const own = matches.flatMap((m) => (m.kind === 'event' ? [m.name] : []))
  const drop = biggestDrop(lane.steps.map((s) => s.visitors))
  const [splits, props, stuck] = await Promise.all([
    Promise.all(SPLITS.map((s) => laneSplitOf(scope, matches, s))),
    matches[0]
      ? sidePropsOf(
          scope,
          matches[0],
          lane.side.map((s) => s.name),
        )
      : [],
    drop ? stuckAt(scope, matches, drop, own) : null,
  ])
  return laneFacts({
    lane,
    splits: Object.fromEntries(SPLITS.map((s, i) => [s, splits[i] ?? []])),
    props,
    stuck,
  })
}

async function visitorFactsOf(scope: Scope, visitor: string): Promise<Fact[]> {
  const { site, range } = scope
  const [{ events: key }, { events, profile }, paid, provider] = await Promise.all([
    keyEventsOf(site),
    visitorOf(scope, visitor),
    paidBy(scope, visitor),
    hasProvider(site),
  ])
  if (!events.length) throw new WhyMissing('this visitor has no events in this range')
  const custom = events.filter((e) => e.name !== 'pageview' && e.name !== 'click')
  const trail = compress(
    custom.map((e) => e.name),
    custom.map((e) => e.at),
    key,
  )
  const ending = endingOf(
    trail.map((t) => t.role),
    provider && paid.payments > 0,
  )
  const faults = [
    ...new Set(
      trail.filter((t) => t.role === 'failed' || t.role === 'closed' || t.fault).map((t) => t.name),
    ),
  ]
  const [now, before] = await Promise.all([
    senders(scope, faults, range),
    senders(scope, faults, previousRange(range)),
  ])
  return personFacts({
    profile,
    events,
    ending,
    amount: paid.amount,
    currency: site.currency,
    timezone: site.timezone,
    faults: faults.map((name) => ({
      name,
      visitors: now.get(name) ?? 0,
      previous: before.get(name) ?? 0,
    })),
  })
}

async function compose(scope: Scope, subject: Subject): Promise<WhyAnswer> {
  const { site, range } = scope
  const [facts, semantics] = await Promise.all([
    subject.kind === 'lane'
      ? laneFactsOf(scope, subject.name)
      : visitorFactsOf(scope, subject.visitor),
    semanticsOf(site),
  ])
  const n = days(range)
  const about = semantics?.about
  const output = await structured({
    site,
    kind: 'why',
    model: env.READING_MODEL,
    system: subject.kind === 'lane' ? LANE_SYSTEM : VISITOR_SYSTEM,
    user: `Site: ${site.domain}
Range: ${shortDay(range.from)} to ${shortDay(range.to)} (${n} days), compared with the ${n} days before.
${about ? `About the site: ${about}` : 'No site description is available.'}
${subject.kind === 'lane' ? `Path: "${subject.name}"` : 'One visitor who tried to pay.'}

${factLines(facts)}`,
    schema: Output,
  })
  return {
    subject,
    range: { from: range.from, to: range.to },
    lines: vettedLines(output, facts, range)
      .slice(0, MAX_LINES)
      .map(({ kind, text }) => ({ kind, text })),
    model: env.READING_MODEL,
    generatedAt: new Date().toISOString(),
  }
}
