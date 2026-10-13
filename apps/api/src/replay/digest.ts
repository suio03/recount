import { createHash } from 'node:crypto'
import { semanticsFor } from '@recount/sites'
import { and, eq, gt } from 'drizzle-orm'
import { KeyProblem, structured } from '../ai/claude'
import { db } from '../db/postgres'
import { readings } from '../db/schema'
import { env } from '../env'
import { shortDay } from '../reading/format'
import type { Scope } from '../stats/queries'
import { days } from '../stats/range'
import { replaysFor } from './list'
import {
  DIGEST_VERSION,
  type Digest,
  keepPatterns,
  MIN_SESSIONS,
  Output,
  prompt,
  SYSTEM,
} from './patterns'

export type { Digest, Evidence, Pattern } from './patterns'

export interface DigestResponse {
  digest: Digest | null
  /** Summarized sessions the digest reads. */
  sessions: number
  /** Why there is no digest: AI off, too few sessions to compare, no key, or a failed call. */
  status: 'ok' | 'off' | 'too_few' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'error'
  error?: string
  generatedAt?: string
}

/** Digests are rewritten after this long, or as soon as a new session is summarized. */
const TTL_MS = 6 * 60 * 60 * 1000

const inFlight = new Map<string, Promise<DigestResponse>>()

/**
 * The patterns across a range's summarized sessions: what several visitors had in common, each
 * pattern citing the sessions and moments that show it. Cached beside readings, keyed by the
 * sessions it read, so a newly summarized session brings a fresh digest.
 */
export async function digestFor(scope: Scope, { refresh = false } = {}): Promise<DigestResponse> {
  const { sessions } = await replaysFor(scope)
  if (!scope.site.ai) return { digest: null, sessions: sessions.length, status: 'off' }
  if (sessions.length < MIN_SESSIONS)
    return { digest: null, sessions: sessions.length, status: 'too_few' }
  if (!env.ANTHROPIC_API_KEY)
    return { digest: null, sessions: sessions.length, status: 'unconfigured' }

  const filters = Object.entries(scope.filters).sort(([a], [b]) => a.localeCompare(b))
  const ids = sessions.map((s) => s.id).sort()
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        'replay-digest',
        scope.site.id,
        scope.range,
        filters,
        ids,
        env.READING_MODEL,
        DIGEST_VERSION,
      ]),
    )
    .digest('hex')

  if (!refresh) {
    const cached = await db.query.readings.findFirst({
      where: and(eq(readings.key, key), gt(readings.createdAt, new Date(Date.now() - TTL_MS))),
    })
    if (cached) return cached.body as DigestResponse
  }

  const pending = inFlight.get(key)
  if (pending) return pending
  const run = (async (): Promise<DigestResponse> => {
    const period = `${shortDay(scope.range.from)} to ${shortDay(scope.range.to)} (${days(scope.range)} days)`
    try {
      const output = await structured({
        model: env.READING_MODEL,
        system: SYSTEM,
        user: prompt(scope.site.domain, period, sessions, semanticsFor(scope.site.domain)),
        schema: Output,
        maxTokens: 2500,
      })
      const body: DigestResponse = {
        digest: keepPatterns(output, sessions, period),
        sessions: sessions.length,
        status: 'ok',
        generatedAt: new Date().toISOString(),
      }
      await db
        .insert(readings)
        .values({ key, siteId: scope.site.id, body })
        .onConflictDoUpdate({ target: readings.key, set: { body, createdAt: new Date() } })
      return body
    } catch (err) {
      console.error('replay digest failed:', err)
      // Failures are not cached, so the next request tries again.
      const status = err instanceof KeyProblem ? err.kind : 'error'
      return { digest: null, sessions: sessions.length, status, error: String(err) }
    }
  })()
  inFlight.set(key, run)
  try {
    return await run
  } finally {
    inFlight.delete(key)
  }
}
