import type { Site } from '../db/schema'
import { triesOf } from './intent'
import { rows, type Scope, sessions, totalsOf } from './queries'
import { quietEvents } from './quiet'
import { previousRange } from './range'
import { usualVisitors } from './usual'

/**
 * One site at a glance for the sites list: its last 30 days against a usual day, who tried to pay
 * this week, its events that went quiet, and what of that needs a look. Code decides; no model.
 */

const DAY = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Days in the trend. */
export const TREND_DAYS = 30
/** A usual day below this is too small to call a drop or a spike. */
const MIN_USUAL = 10
/** Yesterday under this share of a usual day is a drop; over the other, a spike. */
const DROP = 0.5
const SPIKE = 2

export type Attention =
  | { kind: 'silent' }
  | { kind: 'drop'; yesterday: number; usual: number }
  | { kind: 'spike'; yesterday: number; usual: number }
  | { kind: 'quiet'; events: number }
  | { kind: 'unpaid'; tried: number; paid: number }

export interface Activity {
  siteId: string
  /** Visitors per day in the site's timezone, oldest first, ending today so far. */
  days: Array<{ day: string; visitors: number }>
  /** A usual day: the median over the 28 days before this week. */
  usual: number | null
  /** This week (the last 7 days with today) and the 7 before. */
  week: { visitors: number; previous: number }
  /** Who tried to pay and paid this week and the week before, when payment events are known. */
  tries: { tried: number; paid: number; triedBefore: number; paidBefore: number } | null
  quiet: Array<{ name: string; days: number }>
  /** What needs a look, most pressing first; empty when nothing does. */
  attention: Attention[]
}

/**
 * What needs a look: nothing recorded yesterday or today on a site that usually has visitors,
 * yesterday far below or above a usual day, events gone quiet, and people who tried to pay this
 * week without paying.
 */
export function attentionOf(a: Omit<Activity, 'attention' | 'siteId'>): Attention[] {
  const out: Attention[] = []
  const today = a.days.at(-1)?.visitors ?? 0
  const yesterday = a.days.at(-2)?.visitors ?? 0
  const usual = a.usual ?? 0
  if (usual >= MIN_USUAL && today === 0 && yesterday === 0) out.push({ kind: 'silent' })
  else if (usual >= MIN_USUAL && yesterday < usual * DROP)
    out.push({ kind: 'drop', yesterday, usual })
  if (a.quiet.length) out.push({ kind: 'quiet', events: a.quiet.length })
  if (a.tries && a.tries.tried > a.tries.paid)
    out.push({ kind: 'unpaid', tried: a.tries.tried, paid: a.tries.paid })
  if (usual >= MIN_USUAL && yesterday > usual * SPIKE) out.push({ kind: 'spike', yesterday, usual })
  return out
}

/** How much a site needs a look, for sorting: what is broken weighs most. */
export function urgencyOf(a: Pick<Activity, 'attention'>) {
  const weight = { silent: 100, drop: 40, quiet: 30, unpaid: 20, spike: 5 } as const
  return a.attention.reduce((sum, x) => sum + weight[x.kind], 0)
}

/** Sites that need a look first, then the ones with most people trying to pay, then visitors. */
export function byUrgency(a: Activity, b: Activity) {
  return (
    urgencyOf(b) - urgencyOf(a) ||
    (b.tries?.tried ?? 0) - (a.tries?.tried ?? 0) ||
    b.week.visitors - a.week.visitors
  )
}

export async function activityOf(site: Site): Promise<Activity> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: site.timezone })
  const end = Date.parse(today)
  const week = { from: isoDay(end - 6 * DAY), to: today }
  const scope: Scope = { site, range: week, filters: {}, goals: [] }
  const trend = { from: isoDay(end - (TREND_DAYS - 1) * DAY), to: today }
  const s = sessions(scope, trend)
  const [daily, usual, now, before, tries, quiet] = await Promise.all([
    rows<{ day: string; visitors: number }>(
      `SELECT toString(day) AS day, uniqExact(visitor_id) AS visitors FROM (${s.sql}) GROUP BY day`,
      s.params,
    ),
    usualVisitors(scope),
    totalsOf(scope, week),
    totalsOf(scope, previousRange(week)),
    triesOf(scope),
    quietEvents(site, week),
  ])
  const byDay = new Map(daily.map((d) => [d.day, Number(d.visitors)]))
  const a = {
    days: Array.from({ length: TREND_DAYS }, (_, i) => {
      const day = isoDay(end - (TREND_DAYS - 1 - i) * DAY)
      return { day, visitors: byDay.get(day) ?? 0 }
    }),
    usual,
    week: { visitors: Number(now.visitors), previous: Number(before.visitors) },
    tries: tries && {
      tried: tries.now.tried,
      paid: tries.now.paid,
      triedBefore: tries.before.tried,
      paidBefore: tries.before.paid,
    },
    quiet: quiet.map((q) => ({ name: q.name, days: q.days })),
  }
  return { siteId: site.id, ...a, attention: attentionOf(a) }
}
