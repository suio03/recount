import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/postgres'
import { type AiKind, aiUsage, type Site } from '../db/schema'
import { env } from '../env'
import { costMicros } from './prices'

/** Midnight UTC today, when the daily budget starts again. */
export const startOfDay = (now = new Date()) => new Date(now.toISOString().slice(0, 10))

/** What an org's model calls have cost since midnight UTC, in micros. */
export async function spentToday(orgId: string) {
  const [row] = await db
    .select({ micros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
    .from(aiUsage)
    .where(and(eq(aiUsage.orgId, orgId), gte(aiUsage.createdAt, startOfDay())))
  return Number(row?.micros ?? 0)
}

export const budgetMicros = () => Math.round(env.AI_DAILY_BUDGET_USD * 1_000_000)

/** Whether the org may make another call today. A call already running can go past the budget. */
export async function withinBudget(orgId: string) {
  return (await spentToday(orgId)) < budgetMicros()
}

export async function recordUsage(
  site: Site,
  kind: AiKind,
  model: string,
  inputTokens: number,
  outputTokens: number,
) {
  await db.insert(aiUsage).values({
    orgId: site.orgId,
    siteId: site.id,
    kind,
    model,
    inputTokens,
    outputTokens,
    costMicros: costMicros(model, inputTokens, outputTokens),
  })
}
