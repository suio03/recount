import { createHash } from 'node:crypto'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AiUnavailable, type ContentBlock, converse, type Message } from '../ai/claude'
import { db } from '../db/postgres'
import { readings } from '../db/schema'
import { env } from '../env'
import { shortDay, unsupportedNumbers } from '../reading/format'
import { semanticsOf } from '../semantics/store'
import type { Scope } from '../stats/queries'
import { type DateRange, days } from '../stats/range'
import { type QueryContext, QueryError, runTool, toolNamed, toolSpecs } from './tools'

/**
 * Ask: a free question about one site, answered by a model that reads the numbers through the
 * same read-only query tools the MCP server exposes. It may call them a few times, then answers
 * in lines marked fact or guess, each citing the results it rests on; code drops a line quoting
 * a number its results lack. Kept per site, range and question until asked again.
 */

/** Bump when the prompt, the tools or the output shape changes, so old answers are not shown. */
const VERSION = 1
/** Rounds of tool calls before the model must answer. */
const MAX_ROUNDS = 6
/** Tool calls in all. */
const MAX_CALLS = 12
const MAX_LINES = 6
export const MAX_QUESTION = 300
/** Answers listed under the question box. */
const RECENT = 8

export interface AskStep {
  /** Cited by the answer's lines. */
  id: string
  tool: string
  input: Record<string, unknown>
  /** False when the query failed or its input was refused. */
  ok: boolean
}

export interface AskLine {
  kind: 'fact' | 'guess'
  text: string
  /** The steps it rests on. */
  evidence: string[]
}

export interface AskAnswer {
  kind: 'ask'
  question: string
  range: DateRange
  lines: AskLine[]
  steps: AskStep[]
  model: string
  generatedAt: string
}

export interface AskResponse {
  answer: AskAnswer | null
  /** As for the brief: whether an answer can be written, or why the last try failed. */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

/** The same question however it is spaced or cased. */
export const normalizeQuestion = (q: string) => q.trim().replace(/\s+/g, ' ').slice(0, MAX_QUESTION)

function keyOf(scope: Scope, question: string) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'ask',
        scope.site.id,
        scope.range.from,
        scope.range.to,
        normalizeQuestion(question).toLowerCase(),
        VERSION,
      ]),
    )
    .digest('hex')
}

function statusOf(scope: Scope): AskResponse['status'] {
  if (!scope.site.ai) return 'off'
  return env.ANTHROPIC_API_KEY ? 'ok' : 'unconfigured'
}

/** The answer last written to this question in this range, if any. Never calls the model. */
export async function askOf(scope: Scope, question: string): Promise<AskResponse> {
  const cached = await db.query.readings.findFirst({
    where: eq(readings.key, keyOf(scope, question)),
  })
  return { answer: (cached?.body as AskAnswer | undefined) ?? null, status: statusOf(scope) }
}

/** The questions last answered for this range, newest first. */
export async function recentAsks(scope: Scope): Promise<AskAnswer[]> {
  const found = await db
    .select({ body: readings.body })
    .from(readings)
    .where(
      and(
        eq(readings.siteId, scope.site.id),
        sql`${readings.body}->>'kind' = 'ask'`,
        sql`${readings.body}->'range'->>'from' = ${scope.range.from}`,
        sql`${readings.body}->'range'->>'to' = ${scope.range.to}`,
      ),
    )
    .orderBy(desc(readings.createdAt))
    .limit(RECENT)
  return found.map((r) => r.body as AskAnswer)
}

const inFlight = new Map<string, Promise<AskResponse>>()

/** Answers the question for this range, replacing the last answer to it. */
export async function writeAsk(scope: Scope, question: string): Promise<AskResponse> {
  const status = statusOf(scope)
  if (status !== 'ok') return { ...(await askOf(scope, question)), status }
  const key = keyOf(scope, question)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<AskResponse> => {
    try {
      const answer = await compose(scope, normalizeQuestion(question))
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body: answer })
        .onConflictDoUpdate({ target: readings.key, set: { body: answer, createdAt: new Date() } })
      return { answer, status: 'ok' }
    } catch (err) {
      console.error('ask failed:', err)
      const failed = err instanceof AiUnavailable ? err.kind : 'error'
      return { ...(await askOf(scope, question)), status: failed, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}

const Answer = z.object({
  lines: z.array(
    z.object({
      kind: z.enum(['fact', 'guess']),
      text: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
})

const SYSTEM = (site: string, today: string, timezone: string, range: DateRange) =>
  `You answer one question from the owner of ${site} about its analytics. Today is ${today} in the site's time zone (${timezone}). The dashboard is showing ${range.from} to ${range.to}; use that range unless the question names another.

Read the numbers with the tools. Every tool result is labelled with an id such as r1. Call several tools in one turn when they do not depend on each other. Prefer one or two well-chosen queries over many; you have at most ${MAX_ROUNDS} turns of calls. When you have what you need, reply with the answer as JSON: its lines, each with its kind, text and evidence.

Rules for the answer:
- Use only numbers from the tool results. Never compute, estimate or round a number yourself; copy figures exactly as the results write them. A line quoting a number its cited results lack is dropped.
- Each line cites the result ids it rests on as evidence.
- Lead with the direct answer, marked "fact". Then, only if useful, the likely reasons, marked "guess", phrased as "likely" or "suggests".
- Say plainly when the data cannot answer the question, or when the numbers are too small to tell.
- 1 to ${MAX_LINES} lines, each one or two sentences of plain, specific English. Name events, pages and sources as written. No preamble, no markdown.`

async function compose(scope: Scope, question: string): Promise<AskAnswer> {
  const { site, range } = scope
  const ctx: QueryContext = { site, goals: scope.goals, range }
  const semantics = await semanticsOf(site)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: site.timezone })
  const system = SYSTEM(site.domain, today, site.timezone, range)
  const about = semantics?.about
  const messages: Message[] = [
    {
      role: 'user',
      content: `${about ? `About the site: ${about}\n\n` : ''}Question: ${question}`,
    },
  ]
  const tools = toolSpecs()
  const steps: AskStep[] = []
  const results = new Map<string, string>()
  let ids = 0

  for (let round = 0; ; round++) {
    const last = round >= MAX_ROUNDS || ids >= MAX_CALLS
    const reply = await converse({
      site,
      kind: 'ask',
      model: env.READING_MODEL,
      system,
      messages,
      tools,
      schema: Answer,
      choice: last ? 'none' : 'auto',
    })
    messages.push({ role: 'assistant', content: reply.content })
    const calls = reply.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    )
    if (!calls.length) {
      const text = reply.content.find((b) => b.type === 'text')
      if (text?.type !== 'text')
        throw new Error(`the model stopped without answering (${reply.stop_reason})`)
      return finish(scope, question, JSON.parse(text.text), steps, results)
    }
    // Ids count every call, so a result keeps the id the model was shown.
    const base = ids
    ids += calls.length
    const outputs = await Promise.all(
      calls.map(async (c, i): Promise<ContentBlock> => {
        const id = `r${base + i + 1}`
        try {
          const text = await runTool(ctx, c.name, c.input)
          results.set(id, text)
          return { type: 'tool_result', tool_use_id: c.id, content: `[${id}]\n${text}` }
        } catch (e) {
          if (!(e instanceof QueryError)) throw e
          return { type: 'tool_result', tool_use_id: c.id, content: e.message, is_error: true }
        }
      }),
    )
    // A tool the model made up is answered as an error but not listed as a step.
    calls.forEach((c, i) => {
      const id = `r${base + i + 1}`
      if (toolNamed(c.name)) steps.push({ id, tool: c.name, input: c.input, ok: results.has(id) })
    })
    messages.push({ role: 'user', content: outputs })
  }
}

/**
 * Keeps the lines whose numbers are in the results they cite, or in the range or the question;
 * evidence naming no result is dropped from the line.
 */
export function vetLines(
  lines: z.infer<typeof Answer>['lines'],
  results: Map<string, string>,
  context: string[],
): AskLine[] {
  return lines.slice(0, MAX_LINES).flatMap((line): AskLine[] => {
    const evidence = line.evidence.filter((id) => results.has(id))
    const text = line.text.trim()
    if (!text) return []
    // A line that says the data cannot tell needs no result; one quoting a number does.
    const cited = evidence.map((id) => results.get(id) ?? '')
    const unsupported = unsupportedNumbers(text, [...context, ...cited])
    if (unsupported.length) {
      console.warn(`ask: dropped line quoting ${unsupported.join(', ')}: ${text}`)
      return []
    }
    return [{ kind: line.kind, text, evidence }]
  })
}

function finish(
  scope: Scope,
  question: string,
  input: unknown,
  steps: AskStep[],
  results: Map<string, string>,
): AskAnswer {
  const range = scope.range
  const rangeText = `${days(range)} days ${shortDay(range.from)} ${shortDay(range.to)} ${range.from} ${range.to}`
  return {
    kind: 'ask',
    question,
    range: { from: range.from, to: range.to },
    lines: vetLines(Answer.parse(input).lines, results, [rangeText, question]),
    steps,
    model: env.READING_MODEL,
    generatedAt: new Date().toISOString(),
  }
}
