import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { budgetMicros, spentToday } from './ai/usage'
import { db } from './db/postgres'
import { aiUsage, sites } from './db/schema'
import { monthBounds } from './month'
import { rows } from './stats/queries'

export interface SiteUsage {
  /** Null for model calls of a site deleted since. */
  siteId: string | null
  domain: string | null
  pageviews: number
  recordings: number
  aiCalls: number
  aiCostMicros: number
}

export interface Usage {
  /** The calendar month in UTC, `YYYY-MM`. */
  month: string
  sites: SiteUsage[]
  ai: { todayMicros: number; dailyBudgetMicros: number }
}

const chTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')

/**
 * What an org's sites used in a month: pageviews and recorded sessions counted in ClickHouse,
 * model calls and their cost from the usage log, plus today's AI spend against the budget.
 */
export async function usageOf(orgId: string, month: string): Promise<Usage> {
  const { from, to } = monthBounds(month)
  const owned = await db
    .select({ id: sites.id, domain: sites.domain })
    .from(sites)
    .where(eq(sites.orgId, orgId))
    .orderBy(sites.domain)
  const ids = owned.map((s) => s.id)
  const window = { ids, from: chTime(from), to: chTime(to) }
  const [views, recorded, calls, todayMicros] = await Promise.all([
    ids.length
      ? rows<{ site: string; n: number }>(
          `SELECT toString(site_id) AS site, count() AS n FROM events
           WHERE site_id IN {ids:Array(UUID)} AND name = 'pageview'
             AND timestamp >= {from:DateTime64(3)} AND timestamp < {to:DateTime64(3)}
           GROUP BY site_id`,
          window,
        )
      : [],
    ids.length
      ? rows<{ site: string; n: number }>(
          `SELECT toString(site_id) AS site, count() AS n FROM replay_sessions FINAL
           WHERE site_id IN {ids:Array(UUID)}
             AND started_at >= {from:DateTime64(3)} AND started_at < {to:DateTime64(3)}
           GROUP BY site_id`,
          window,
        )
      : [],
    db
      .select({
        siteId: aiUsage.siteId,
        calls: sql<number>`count(*)::int`,
        micros: sql<number>`sum(${aiUsage.costMicros})::bigint`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, from), lt(aiUsage.createdAt, to)))
      .groupBy(aiUsage.siteId),
    spentToday(orgId),
  ])
  const viewsBy = new Map(views.map((r) => [r.site, Number(r.n)]))
  const recordedBy = new Map(recorded.map((r) => [r.site, Number(r.n)]))
  const callsBy = new Map(calls.map((r) => [r.siteId, r]))
  const usage: SiteUsage[] = owned.map((s) => ({
    siteId: s.id,
    domain: s.domain,
    pageviews: viewsBy.get(s.id) ?? 0,
    recordings: recordedBy.get(s.id) ?? 0,
    aiCalls: callsBy.get(s.id)?.calls ?? 0,
    aiCostMicros: Number(callsBy.get(s.id)?.micros ?? 0),
  }))
  const gone = callsBy.get(null)
  if (gone)
    usage.push({
      siteId: null,
      domain: null,
      pageviews: 0,
      recordings: 0,
      aiCalls: gone.calls,
      aiCostMicros: Number(gone.micros),
    })
  return { month, sites: usage, ai: { todayMicros, dailyBudgetMicros: budgetMicros() } }
}
