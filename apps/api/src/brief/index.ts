import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { AiUnavailable, structured } from '../ai/claude'
import { db } from '../db/postgres'
import { readings, type Site } from '../db/schema'
import { env } from '../env'
import { detectChanges } from '../reading/detect'
import { shortDay } from '../reading/format'
import { semanticsOf } from '../semantics/store'
import { intentOf } from '../stats/intent'
import { pathsFor } from '../stats/lanes'
import { revenueOf, type Scope, totalsOf } from '../stats/queries'
import { type DateRange, days, isOpen, previousRange } from '../stats/range'
import { usualVisitors } from '../stats/usual'
import {
  type BriefLine,
  type Fact,
  factLines,
  factsOf,
  MAX_LINES,
  MIN_LINES,
  Output,
  vettedLines,
} from './facts'

export type { BriefLine } from './facts'

/**
 * The brief: a few lines on what the owner should know about a range, written only when someone
 * asks for it. It reads the whole site, whatever the filters, so applying a line's filters keeps
 * it on screen. It is kept per site and range until it is rewritten.
 */

/** Bump when the prompt, the facts or the output shape changes, so old briefs are not shown. */
const VERSION = 1

export interface Brief {
  range: DateRange
  lines: BriefLine[]
  model: string
  generatedAt: string
}

export interface BriefResponse {
  brief: Brief | null
  /**
   * Whether a brief can be written: AI analysis is off for the site, there is no API key, or,
   * after a write, the key was refused, credit or today's budget ran out, or the call failed.
   */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

const SYSTEM = `You write the brief at the top of a website's analytics dashboard, for its owner. They look every day for two things: whether something broke, and whether anybody tried to pay. The brief tells them, in ${MIN_LINES} to ${MAX_LINES} lines, what they should know about this period.

Rules:
- Use only the facts you are given. Never compute, estimate or round a number yourself; copy figures exactly as written in the facts you cite.
- Each line cites the ids of the facts it rests on. A line that combines facts cites all of them.
- Mark a line "fact" when the facts it cites state it directly. Mark it "guess" when it explains why, or connects facts in a way they do not state; phrase a guess as "likely" or "suggests", or give the two likely explanations ("Either ... or ...").
- Order by what matters: who tried to pay and what stopped them, then anything that looks broken (failures along a path, a step most people do not get past, events that went quiet), then traffic.
- An event that went quiet may be a broken tag or a broken feature; say which only when the facts show it.
- Say plainly when numbers are small, and when nothing needs attention.
- Each line is one or two sentences of plain, specific English. Name events as written. No preamble, no advice section, no markdown.`

function prompt(site: Site, range: DateRange, facts: Fact[], about: string | undefined) {
  const n = days(range)
  return `Site: ${site.domain}
Range: ${shortDay(range.from)} to ${shortDay(range.to)} (${n} days), compared with the ${n} days before.
${about ? `About the site: ${about}` : 'No site description is available.'}

${factLines(facts)}`
}

function keyOf(site: Site, range: DateRange) {
  return createHash('sha256')
    .update(JSON.stringify(['brief', site.id, range.from, range.to, VERSION]))
    .digest('hex')
}

function statusOf(site: Site): BriefResponse['status'] {
  if (!site.ai) return 'off'
  return env.ANTHROPIC_API_KEY ? 'ok' : 'unconfigured'
}

/** The brief last written for this range, if any. Never calls the model. */
export async function briefOf(scope: Scope): Promise<BriefResponse> {
  const cached = await db.query.readings.findFirst({
    where: eq(readings.key, keyOf(scope.site, scope.range)),
  })
  return { brief: (cached?.body as Brief | undefined) ?? null, status: statusOf(scope.site) }
}

const inFlight = new Map<string, Promise<BriefResponse>>()

/** Writes the brief for this range from the whole site's numbers, replacing the last one. */
export async function writeBrief(scope: Scope): Promise<BriefResponse> {
  const status = statusOf(scope.site)
  if (status !== 'ok') return { ...(await briefOf(scope)), status }
  const key = keyOf(scope.site, scope.range)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<BriefResponse> => {
    try {
      const brief = await compose({ ...scope, filters: {} })
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body: brief })
        .onConflictDoUpdate({ target: readings.key, set: { body: brief, createdAt: new Date() } })
      return { brief, status: 'ok' }
    } catch (err) {
      console.error('brief failed:', err)
      const failed = err instanceof AiUnavailable ? err.kind : 'error'
      return { ...(await briefOf(scope)), status: failed, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}

async function compose(scope: Scope): Promise<Brief> {
  const { site, range } = scope
  const before = previousRange(range)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: site.timezone })
  const semantics = await semanticsOf(site)
  const [totals, previous, revenue, previousRevenue, usual, todays, findings, intent, paths] =
    await Promise.all([
      totalsOf(scope, range),
      totalsOf(scope, before),
      revenueOf(scope, range),
      revenueOf(scope, before),
      usualVisitors(scope),
      isOpen(range, site.timezone)
        ? totalsOf(scope, { from: today, to: today }).then((t) => Number(t.visitors))
        : null,
      detectChanges(scope, semantics),
      intentOf(scope),
      pathsFor(scope),
    ])
  const facts = factsOf({
    currency: site.currency,
    traffic: {
      totals: numbers({ ...totals, ...revenue }),
      previous: numbers({ ...previous, ...previousRevenue }),
      usual,
      today: todays,
    },
    findings,
    intent,
    paths,
  })
  const output = await structured({
    site,
    kind: 'brief',
    model: env.READING_MODEL,
    system: SYSTEM,
    user: prompt(site, range, facts, semantics?.about),
    schema: Output,
  })
  return {
    range: { from: range.from, to: range.to },
    lines: vettedLines(output, facts, range),
    model: env.READING_MODEL,
    generatedAt: new Date().toISOString(),
  }
}

/** ClickHouse returns 64-bit counts as strings. */
function numbers<T extends object>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'string' ? Number(v) : v]),
  ) as T
}
