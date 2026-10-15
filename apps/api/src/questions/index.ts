import { createHash } from 'node:crypto'
import type { SiteSemantics } from '@recount/semantic'
import { and, eq, gt } from 'drizzle-orm'
import { AiUnavailable, structured } from '../ai/claude'
import { withinBudget } from '../ai/usage'
import { db } from '../db/postgres'
import { readings } from '../db/schema'
import { env } from '../env'
import { CLOSED_TTL_MS, OPEN_TTL_MS, type ReadingResponse } from '../reading'
import { describe, shortDay } from '../reading/format'
import { Output, type Reading, vetted } from '../reading/write'
import { conversionDefinition, semanticsOf } from '../semantics/store'
import type { Scope } from '../stats/queries'
import { days, isOpen } from '../stats/range'
import { type Facts, factsFor, QUESTIONS, type Question } from './facts'

export { QUESTIONS, type Question } from './facts'

/** Bump when a prompt, the facts or the output shape changes, so cached answers are rewritten. */
const PROMPT_VERSION = 1

export interface AnswerResponse extends Omit<ReadingResponse, 'reading'> {
  question: Question
  title: string
  definition: string
  answer: Reading | null
}

const SYSTEM = (
  question: string,
  extra: string,
) => `You answer one fixed question about a website's analytics for its owner: "${question}"

Rules:
- Use only the facts you are given. Never compute, estimate or round a number yourself; copy figures exactly as written in the facts you cite.
- Each claim cites the ids of the facts it rests on. A claim that compares facts cites all of them.
- The headline answers the question directly in one sentence a reader could stop at.
- The definition is shown to the reader next to your answer, so do not restate it; use its terms.
- Say plainly when a change is small, or when a segment has too few visitors (under about 50) for its rate to mean much.
- Explanations of why are hypotheses: phrase them as "likely" or "suggests", and only when the facts support them.
- 2 to 4 claims, each one or two sentences. Plain, specific English. No preamble, no advice section, no markdown.
${extra}`

const EXTRA: Record<Question, string> = {
  traffic:
    '- Lead with visitors and how they moved, then which channels or referrers drove the change. Mention pageviews, bounce rate or session time only when they moved noticeably or tell a different story.',
  conversion:
    '- Lead with the conversion rate and how it moved. Then say which segments convert better or worse than all visitors, comparing each with its baseline. If several conversions are given, the first is the main one.',
  channels:
    '- Name the channel that brings the best visitors by the comparison the definition names, and why; then the runner-up or the channel that brings many visitors but converts poorly. A channel is not best on its rate alone when it has few visitors: say so.',
}

function prompt(domain: string, scope: Scope, facts: Facts, semantics: SiteSemantics | undefined) {
  const n = days(scope.range)
  return `Site: ${domain}
Range: ${shortDay(scope.range.from)} to ${shortDay(scope.range.to)} (${n} days), compared with the ${n} days before.
${semantics ? `About the site: ${semantics.about}` : 'No site description is available.'}

Definition: ${facts.definition}

Facts:
${facts.findings.map(describe).join('\n')}`
}

const inFlight = new Map<string, Promise<AnswerResponse>>()

/** The facts are part of the key: their figures and the definition pin what an answer explains. */
function cacheKey(question: Question, scope: Scope, facts: Facts) {
  const filters = Object.entries(scope.filters).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(
      JSON.stringify([
        'question',
        question,
        scope.site.id,
        scope.range,
        filters,
        facts.definition,
        facts.findings.map((f) => [f.subject, f.metric]),
        env.READING_MODEL,
        PROMPT_VERSION,
      ]),
    )
    .digest('hex')
}

/**
 * The answer to one built-in question for a scope: the facts are always computed fresh; the
 * model's explanation of them is cached like a reading, and written only with AI on.
 */
export async function answerFor(
  question: Question,
  scope: Scope,
  { refresh = false } = {},
): Promise<AnswerResponse> {
  const [semantics, definition] = await Promise.all([
    semanticsOf(scope.site),
    conversionDefinition(scope.site, scope.goals),
  ])
  const facts = await factsFor(question, scope, definition)
  const base = {
    question,
    title: QUESTIONS[question],
    definition: facts.definition,
    findings: facts.findings,
  }
  if (!scope.site.ai || !env.ANTHROPIC_API_KEY)
    return { ...base, answer: null, status: scope.site.ai ? 'unconfigured' : 'off' }

  const key = cacheKey(question, scope, facts)
  if (!refresh || !(await withinBudget(scope.site.orgId))) {
    const ttl = isOpen(scope.range, scope.site.timezone) ? OPEN_TTL_MS : CLOSED_TTL_MS
    const cached = await db.query.readings.findFirst({
      where: and(eq(readings.key, key), gt(readings.createdAt, new Date(Date.now() - ttl))),
    })
    // Cached with the facts it was written from, so its evidence ids point at those figures.
    if (cached) return cached.body as AnswerResponse
  }

  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<AnswerResponse> => {
    try {
      const output = await structured({
        site: scope.site,
        kind: 'question',
        model: env.READING_MODEL,
        system: SYSTEM(QUESTIONS[question], EXTRA[question]),
        user: prompt(scope.site.domain, scope, facts, semantics),
        schema: Output,
      })
      const answer = vetted(output, facts.findings, scope.range, env.READING_MODEL)
      const body: AnswerResponse = { ...base, answer, status: 'ok' }
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body })
        .onConflictDoUpdate({ target: readings.key, set: { body, createdAt: new Date() } })
      return body
    } catch (err) {
      console.error(`question ${question} failed:`, err)
      const status = err instanceof AiUnavailable ? err.kind : 'error'
      return { ...base, answer: null, status, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}
