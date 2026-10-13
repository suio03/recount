import { and, between, desc, eq } from 'drizzle-orm'
import { db } from '../db/postgres'
import { replaySummaries } from '../db/schema'
import { rows, type Scope, sessions } from '../stats/queries'
import type { Reason, Summary } from './brief'

/** The most summaries one listing returns, newest first. */
const LIMIT = 50
/** Summaries are dated in UTC and ranges in the site's timezone; this covers any offset. */
const SLACK_MS = 36 * 60 * 60 * 1000

export interface ListedSession {
  id: string
  startedAt: string
  reasons: Reason[]
  summary: Summary
  entry: string
  channel: string
  referrer: string
  country: string
  device: string
  browser: string
  /** Seconds, from the visit's events. */
  duration: number
  pages: number
  /** Minor units of the site's currency, all the session's payments net of refunds. */
  revenue: number
}

export interface ReplayListing {
  currency: string
  /** Recorded sessions in scope, summarized or not. */
  recorded: number
  sessions: ListedSession[]
}

interface Context {
  session_id: string
  entry: string
  channel: string
  referrer: string
  country: string
  device: string
  browser: string
  duration: number
  session_pageviews: number
}

/** Summarized sessions in the range that match the dashboard's filters, newest first. */
export async function replaysFor(scope: Scope): Promise<ReplayListing> {
  const s = sessions(scope)
  const summaries = await db
    .select()
    .from(replaySummaries)
    .where(
      and(
        eq(replaySummaries.siteId, scope.site.id),
        between(
          replaySummaries.startedAt,
          new Date(Date.parse(scope.range.from) - SLACK_MS),
          new Date(Date.parse(scope.range.to) + SLACK_MS),
        ),
      ),
    )
    .orderBy(desc(replaySummaries.startedAt))
  const ids = summaries.map((r) => BigInt(r.sessionId))

  const [[recorded], context, revenue] = await Promise.all([
    rows<{ n: number }>(
      `SELECT count() AS n FROM replay_sessions FINAL
       WHERE site_id = {site:UUID} AND session_id IN (SELECT session_id FROM (${s.sql}))`,
      s.params,
    ),
    ids.length
      ? rows<Context>(
          `SELECT toString(session_id) AS session_id, entry, channel, referrer, country, device,
             browser, duration, session_pageviews
           FROM (${s.sql}) WHERE session_id IN {ids:Array(UInt64)}`,
          { ...s.params, ids },
        )
      : [],
    ids.length
      ? rows<{ session_id: string; revenue: number }>(
          `SELECT toString(session_id) AS session_id, sum(amount) AS revenue FROM payments FINAL
           WHERE site_id = {site:UUID} AND session_id IN {ids:Array(UInt64)} GROUP BY session_id`,
          { site: scope.site.id, ids },
        )
      : [],
  ])

  // Sessions outside the range or the filters have no context row, and are left out.
  const contextById = new Map(context.map((c) => [c.session_id, c]))
  const revenueById = new Map(revenue.map((r) => [r.session_id, r.revenue]))
  const listed: ListedSession[] = []
  for (const r of summaries) {
    const c = contextById.get(r.sessionId)
    if (!c) continue
    listed.push({
      id: r.sessionId,
      startedAt: r.startedAt.toISOString(),
      reasons: r.reasons as Reason[],
      summary: r.body as Summary,
      entry: c.entry,
      channel: c.channel,
      referrer: c.referrer,
      country: c.country,
      device: c.device,
      browser: c.browser,
      duration: c.duration,
      pages: c.session_pageviews,
      revenue: revenueById.get(r.sessionId) ?? 0,
    })
    if (listed.length === LIMIT) break
  }
  return { currency: scope.site.currency, recorded: recorded?.n ?? 0, sessions: listed }
}
