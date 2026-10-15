import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { AiUnavailable, structured } from '../ai/claude'
import { db } from '../db/postgres'
import { replaySummaries, type Site, sites } from '../db/schema'
import { env } from '../env'
import { semanticsOf } from '../semantics/store'
import { rows } from '../stats/queries'
import {
  type Candidate,
  keepMoments,
  Output,
  prompt,
  type Reason,
  rank,
  reasonsOf,
  SUMMARY_VERSION,
  type Summary,
  SYSTEM,
} from './brief'
import type { Interaction } from './extract'

/**
 * AI summaries of recorded sessions worth reading: the visits that paid, converted, or ran into
 * trouble. The model reads the extracted timeline, never the recording, and every moment it
 * points at is a line of that timeline, so it links to a time in the replay.
 */

/** Sessions are summarized for this long after they start. */
const LOOKBACK_DAYS = 3

/** Writes one session's summary. */
export async function writeSummary(site: Site, c: Candidate, reasons: Reason[]): Promise<Summary> {
  const timeline = JSON.parse(c.timeline) as Interaction[]
  const output = await structured({
    site,
    kind: 'summary',
    model: env.REPLAY_MODEL,
    system: SYSTEM,
    user: prompt(site, c, timeline, reasons, await semanticsOf(site)),
    schema: Output,
    maxTokens: 1500,
  })
  const moments = keepMoments(output.moments, timeline)
  return { headline: output.headline, intent: output.intent, outcome: output.outcome, moments }
}

/** Extracted sessions of the last few days, with what the tracker and payments know of them. */
export function candidates(siteId: string, sessionId?: string) {
  const recent = `site_id = {site:UUID} AND started_at > now64(3) - INTERVAL ${LOOKBACK_DAYS} DAY${
    sessionId ? ' AND session_id = {session:UInt64}' : ''
  }`
  return rows<Candidate>(
    `SELECT toString(r.session_id) AS session_id, r.started_at AS started_at, r.ended_at AS ended_at,
       r.pages AS pages, r.rage_clicks AS rage_clicks, r.dead_clicks AS dead_clicks,
       r.errors AS errors, r.abandoned_forms AS abandoned_forms, r.timeline AS timeline,
       p.revenue AS revenue, e.event_names AS event_names, e.channel AS channel,
       e.referrer AS referrer, e.campaign AS campaign, e.country AS country, e.device AS device,
       e.browser AS browser
     FROM (SELECT * FROM replay_sessions FINAL WHERE ${recent}) AS r
     LEFT JOIN (
       SELECT session_id, sum(amount) AS revenue FROM payments FINAL
       WHERE site_id = {site:UUID} AND kind != 'refund' GROUP BY session_id
     ) AS p ON p.session_id = r.session_id
     LEFT JOIN (
       SELECT session_id,
         groupUniqArrayIf(name, name != 'pageview') AS event_names,
         argMin(channel, timestamp) AS channel,
         argMin(referrer_source, timestamp) AS referrer,
         argMin(utm_campaign, timestamp) AS campaign,
         argMin(replaceAll(toString(country_code), '\\0', ''), timestamp) AS country,
         argMin(device, timestamp) AS device,
         argMin(browser, timestamp) AS browser
       FROM events
       WHERE site_id = {site:UUID} AND timestamp > now64(3) - INTERVAL ${LOOKBACK_DAYS + 1} DAY
         AND session_id IN (SELECT session_id FROM replay_sessions WHERE ${recent})
       GROUP BY session_id
     ) AS e ON e.session_id = r.session_id`,
    { site: siteId, ...(sessionId && { session: sessionId }) },
  )
}

async function save(site: Site, c: Candidate, reasons: Reason[], summary: Summary) {
  const values = {
    siteId: site.id,
    sessionId: c.session_id,
    startedAt: new Date(`${c.started_at}Z`),
    reasons,
    body: summary,
    model: env.REPLAY_MODEL,
    promptVersion: SUMMARY_VERSION,
  }
  await db
    .insert(replaySummaries)
    .values(values)
    .onConflictDoUpdate({
      target: [replaySummaries.siteId, replaySummaries.sessionId],
      set: { ...values, createdAt: new Date() },
    })
}

/**
 * Summarizes a site's notable sessions that have no summary yet, or whose summary predates the
 * prompt or a new reason (a payment synced after the first summary). Returns how many it wrote.
 */
export async function summarizeSite(site: Site) {
  const keyEvents = new Set(
    (await semanticsOf(site))?.events.filter((e) => e.key).map((e) => e.name),
  )
  const found = (await candidates(site.id))
    .map((c) => ({ c, reasons: reasonsOf(c, keyEvents) }))
    .filter((x) => x.reasons.length)
  if (!found.length) return 0

  const existing = await db
    .select({
      sessionId: replaySummaries.sessionId,
      reasons: replaySummaries.reasons,
      version: replaySummaries.promptVersion,
    })
    .from(replaySummaries)
    .where(
      and(
        eq(replaySummaries.siteId, site.id),
        inArray(
          replaySummaries.sessionId,
          found.map((x) => x.c.session_id),
        ),
      ),
    )
  const byId = new Map(existing.map((e) => [e.sessionId, e]))
  const due = found
    .filter(({ c, reasons }) => {
      const e = byId.get(c.session_id)
      return !e || e.version < SUMMARY_VERSION || reasons.some((r) => !e.reasons.includes(r))
    })
    .sort((a, b) => rank(a.reasons) - rank(b.reasons) || b.reasons.length - a.reasons.length)

  const [today] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(replaySummaries)
    .where(
      and(
        eq(replaySummaries.siteId, site.id),
        gte(replaySummaries.createdAt, new Date(new Date().toISOString().slice(0, 10))),
      ),
    )
  const budget = Math.max(0, env.REPLAY_SUMMARIES_PER_DAY - (today?.n ?? 0))

  let written = 0
  for (const { c, reasons } of due.slice(0, budget)) {
    try {
      await save(site, c, reasons, await writeSummary(site, c, reasons))
      written++
    } catch (e) {
      // A refused key or empty account fails every call, so stop rather than retry each one.
      if (e instanceof AiUnavailable) throw e
      console.error(`replay summary ${site.domain}/${c.session_id}:`, e)
    }
  }
  return written
}

/** Summarizes notable sessions on every site with AI analysis on, when an API key is set. */
export async function summarizeAll() {
  if (!env.ANTHROPIC_API_KEY) return 0
  let written = 0
  for (const site of await db.select().from(sites).where(eq(sites.ai, true))) {
    try {
      written += await summarizeSite(site)
    } catch (e) {
      // An org past today's budget waits for tomorrow; other orgs' sites still get theirs.
      if (e instanceof AiUnavailable && e.kind === 'over_budget') continue
      throw e
    }
  }
  return written
}

/** One session, notable or not, now: for trying the prompt from the command line. */
export async function summarizeSession(site: Site, sessionId: string) {
  const [c] = await candidates(site.id, sessionId)
  if (!c)
    throw new Error(
      `session ${sessionId} has no extracted timeline in the last ${LOOKBACK_DAYS} days`,
    )
  const keyEvents = new Set(
    (await semanticsOf(site))?.events.filter((e) => e.key).map((e) => e.name),
  )
  const reasons = reasonsOf(c, keyEvents)
  const summary = await writeSummary(site, c, reasons)
  await save(site, c, reasons, summary)
  return { reasons, summary, timeline: JSON.parse(c.timeline) as Interaction[] }
}
