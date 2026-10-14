import { createHash } from 'node:crypto'
import { semanticsFor } from '@recount/sites'
import { and, eq, gt } from 'drizzle-orm'
import { AiUnavailable } from '../ai/claude'
import { withinBudget } from '../ai/usage'
import { db } from '../db/postgres'
import { readings } from '../db/schema'
import { env } from '../env'
import type { Scope } from '../stats/queries'
import type { Finding } from './changes'
import { detectChanges } from './detect'
import { PROMPT_VERSION, type Reading, writeReading } from './write'

export type { Finding } from './changes'
export type { Reading } from './write'

export interface ReadingResponse {
  findings: Finding[]
  reading: Reading | null
  /**
   * Why there is no reading: AI analysis is off for the site, no API key, a key the API
   * refused, no credit left, today's AI budget spent, or another failure of the model call.
   */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

/** Readings are rewritten after this long, so today's partial data is not frozen for a day. */
const TTL_MS = 6 * 60 * 60 * 1000

const inFlight = new Map<string, Promise<ReadingResponse>>()

function cacheKey(scope: Scope) {
  const filters = Object.entries(scope.filters).sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256')
    .update(
      JSON.stringify([scope.site.id, scope.range, filters, env.READING_MODEL, PROMPT_VERSION]),
    )
    .digest('hex')
}

/**
 * The findings and reading for a scope. With AI off or no API key the findings are computed fresh;
 * with one, both are cached together so evidence ids keep pointing at the numbers the model saw.
 */
export async function readingFor(scope: Scope, { refresh = false } = {}): Promise<ReadingResponse> {
  const semantics = semanticsFor(scope.site.domain)
  if (!scope.site.ai || !env.ANTHROPIC_API_KEY) {
    return {
      findings: await detectChanges(scope, semantics),
      reading: null,
      status: scope.site.ai ? 'unconfigured' : 'off',
    }
  }

  const key = cacheKey(scope)
  // Past today's budget a refresh keeps the cached copy rather than replacing it with nothing.
  if (!refresh || !(await withinBudget(scope.site.orgId))) {
    const cached = await db.query.readings.findFirst({
      where: and(eq(readings.key, key), gt(readings.createdAt, new Date(Date.now() - TTL_MS))),
    })
    if (cached) return cached.body as ReadingResponse
  }

  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<ReadingResponse> => {
    const findings = await detectChanges(scope, semantics)
    try {
      const reading = await writeReading(scope.site, scope.range, findings, semantics)
      const body: ReadingResponse = { findings, reading, status: 'ok' }
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body })
        .onConflictDoUpdate({ target: readings.key, set: { body, createdAt: new Date() } })
      return body
    } catch (err) {
      console.error('reading failed:', err)
      // Failures are not cached, so the next request tries again.
      const status = err instanceof AiUnavailable ? err.kind : 'error'
      return { findings, reading: null, status, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}
