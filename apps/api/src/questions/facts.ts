import { type Finding, relChange, type SessionDimension } from '../reading/changes'
import { shortDay } from '../reading/format'
import type { ConversionDefinition } from '../semantics/store'
import {
  type GoalRow,
  goalsOf,
  type Revenue,
  revenueOf,
  rows,
  type Scope,
  sessions,
  type Totals,
  totalsOf,
} from '../stats/queries'
import { type DateRange, days, previousRange } from '../stats/range'

/**
 * Built-in questions: each one is a fixed set of queries, and the model only explains the
 * figures they return. The definition each answer uses is written here by code, so a reader
 * knows what "conversion" or "best" meant without trusting the model to say it.
 */
export const QUESTIONS = {
  traffic: 'How is traffic?',
  conversion: 'How is conversion?',
  channels: 'Which channel brings the best visitors?',
} as const
export type Question = keyof typeof QUESTIONS

export interface Facts {
  /** What the answer counts, in plain words. */
  definition: string
  findings: Finding[]
}

type Fact = Omit<Finding, 'id'>

/** Segments with fewer visitors than this are left out: their rates are mostly noise. */
const MIN_SEGMENT = 10
const TOP_CHANNELS = 5
const TOP_REFERRERS = 3
const TOP_DEVICES = 3
/** Conversions reported per answer, when several are defined. */
const MAX_CONVERSIONS = 3

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ')

function topValues(scope: Scope, dimension: SessionDimension, limit: number) {
  const s = sessions(scope)
  return rows<{ value: string; visitors: number }>(
    `SELECT ${dimension} AS value, uniqExact(visitor_id) AS visitors
     FROM (${s.sql}) WHERE value != ''
     GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`,
    { ...s.params, limit },
  ).then((r) => r.filter((v) => v.visitors >= MIN_SEGMENT))
}

interface Period {
  totals: Totals
  revenue: Revenue
  goals: Map<string, number>
}

async function periodOf(scope: Scope, range: DateRange): Promise<Period> {
  const [totals, revenue, goals] = await Promise.all([
    totalsOf(scope, range),
    revenueOf(scope, range),
    goalsOf(scope, range),
  ])
  return { totals, revenue, goals: byName(goals) }
}

const byName = (goals: GoalRow[]) => new Map(goals.map((g) => [g.name, g.visitors]))

/** One scope, now and in the period before, for the facts built from it. */
async function both(scope: Scope) {
  const [now, before] = await Promise.all([
    periodOf(scope, scope.range),
    periodOf(scope, previousRange(scope.range)),
  ])
  return { now, before }
}

type Both = Awaited<ReturnType<typeof both>>

const rate = (p: Period, goal: string) =>
  p.totals.visitors ? (p.goals.get(goal) ?? 0) / p.totals.visitors : 0

function totalFact(
  scope: Scope,
  metric: 'visitors' | 'pageviews' | 'bounce_rate' | 'avg_session_seconds',
  b: Both,
): Fact {
  return {
    subject: { kind: 'total' },
    metric,
    current: b.now.totals[metric],
    previous: b.before.totals[metric],
    change: relChange(b.now.totals[metric], b.before.totals[metric]),
    filters: scope.filters,
  }
}

function revenueFact(scope: Scope, b: Both, segment?: Segment): Fact {
  return {
    subject: segment ? { kind: 'segment', ...segment } : { kind: 'total' },
    metric: 'revenue',
    current: b.now.revenue.revenue,
    previous: b.before.revenue.revenue,
    change: relChange(b.now.revenue.revenue, b.before.revenue.revenue),
    currency: scope.site.currency,
    filters: segment ? { ...scope.filters, [segment.dimension]: segment.value } : scope.filters,
  }
}

function goalFact(scope: Scope, b: Both, goal: string): Fact {
  return {
    subject: { kind: 'goal', name: goal },
    metric: 'conversion_rate',
    current: rate(b.now, goal),
    previous: rate(b.before, goal),
    change: relChange(rate(b.now, goal), rate(b.before, goal)),
    filters: { ...scope.filters, goal },
  }
}

interface Segment {
  dimension: SessionDimension
  value: string
}

/** A segment's own figures, with all visitors in scope as the baseline for rates. */
async function segmentFacts(
  scope: Scope,
  all: Both,
  segment: Segment,
  { goal, bounce, revenue }: { goal?: string; bounce: boolean; revenue: boolean },
): Promise<Fact[]> {
  const filters = { ...scope.filters, [segment.dimension]: segment.value }
  const b = await both({ ...scope, filters })
  const subject = { kind: 'segment', ...segment } as const
  const facts: Fact[] = [
    {
      subject,
      metric: 'visitors',
      current: b.now.totals.visitors,
      previous: b.before.totals.visitors,
      change: relChange(b.now.totals.visitors, b.before.totals.visitors),
      filters,
    },
  ]
  if (goal)
    facts.push({
      subject: { kind: 'segment_goal', ...segment, name: goal },
      metric: 'conversion_rate',
      current: rate(b.now, goal),
      previous: rate(b.before, goal),
      change: relChange(rate(b.now, goal), rate(b.before, goal)),
      baseline: rate(all.now, goal),
      filters,
    })
  if (bounce)
    facts.push({
      subject,
      metric: 'bounce_rate',
      current: b.now.totals.bounce_rate,
      previous: b.before.totals.bounce_rate,
      change: relChange(b.now.totals.bounce_rate, b.before.totals.bounce_rate),
      baseline: all.now.totals.bounce_rate,
      filters,
    })
  if (revenue && (b.now.revenue.revenue || b.before.revenue.revenue)) {
    facts.push(revenueFact(scope, b, segment))
    const now = perVisitor(b.now)
    facts.push({
      subject,
      metric: 'revenue_per_visitor',
      current: now,
      previous: perVisitor(b.before),
      change: relChange(now, perVisitor(b.before)),
      baseline: perVisitor(all.now),
      currency: scope.site.currency,
      filters,
    })
  }
  return facts
}

const perVisitor = (p: Period) => (p.totals.visitors ? p.revenue.revenue / p.totals.visitors : 0)

const hasRevenue = (b: Both) => Boolean(b.now.revenue.revenue || b.before.revenue.revenue)

/**
 * The conversions an answer counts: the site's defined ones, else the goals and custom events
 * with the most visitors, and the sentence that says which it used.
 */
function conversionsOf(definition: ConversionDefinition, all: Both) {
  const reached = [...all.now.goals.entries(), ...all.before.goals.entries()]
  const exists = new Set(reached.map(([name]) => name))
  const names = definition.names.filter((n) => exists.has(n)).slice(0, MAX_CONVERSIONS)
  const notYet = definition.skipped.length
    ? ` The draft's ${quote(definition.skipped)} ${definition.skipped.length === 1 ? 'is not added as a goal' : 'are not added as goals'} yet, so not counted.`
    : ''
  if (names.length) {
    const from =
      definition.source === 'catalog'
        ? 'events marked key for the site'
        : `marked primary in the AI draft of ${shortDay((definition.draftedAt ?? '').slice(0, 10))}`
    return {
      names,
      text: `Conversion is the share of visitors who reached ${quote(names)} (${from}).${notYet}`,
    }
  }
  const top = [...all.now.goals.entries()]
    .filter(([, visitors]) => visitors > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CONVERSIONS)
    .map(([name]) => name)
  if (!top.length) return { names: [], text: `No goal or custom event was reached.${notYet}` }
  return {
    names: top,
    text: `No conversion is marked primary, so this uses the goals and custom events with the most visitors: ${quote(top)}.${notYet}`,
  }
}

/** The facts behind one question, numbered for the model to cite. */
export async function factsFor(
  question: Question,
  scope: Scope,
  definition: ConversionDefinition,
): Promise<Facts> {
  const n = days(scope.range)
  const period = `from ${shortDay(scope.range.from)} to ${shortDay(scope.range.to)}, compared with the ${n} days before`
  const all = await both(scope)
  const facts: Fact[] = []
  let text: string

  if (question === 'traffic') {
    text = `Visitors, pageviews, bounce rate and session time ${period}. A visit's channel is where its first event came from.`
    for (const metric of ['visitors', 'pageviews', 'bounce_rate', 'avg_session_seconds'] as const)
      facts.push(totalFact(scope, metric, all))
    const [channels, referrers] = await Promise.all([
      topValues(scope, 'channel', TOP_CHANNELS),
      topValues(scope, 'referrer', TOP_REFERRERS),
    ])
    const segments = await Promise.all(
      [
        ...channels.map((c) => ({ dimension: 'channel' as const, value: c.value })),
        ...referrers.map((r) => ({ dimension: 'referrer' as const, value: r.value })),
      ].map((s) => segmentFacts(scope, all, s, { bounce: false, revenue: false })),
    )
    facts.push(...segments.flat())
    if (hasRevenue(all)) facts.push(revenueFact(scope, all))
  } else {
    const conversions = conversionsOf(definition, all)
    const goal = conversions.names[0]
    if (question === 'conversion') {
      text = `${conversions.text} Rates are ${period}; each segment is compared with all visitors.`
      facts.push(totalFact(scope, 'visitors', all))
      for (const name of conversions.names) facts.push(goalFact(scope, all, name))
      if (goal) {
        const [channels, devices] = await Promise.all([
          topValues(scope, 'channel', TOP_CHANNELS),
          topValues(scope, 'device', TOP_DEVICES),
        ])
        const segments = await Promise.all(
          [
            ...channels.map((c) => ({ dimension: 'channel' as const, value: c.value })),
            ...devices.map((d) => ({ dimension: 'device' as const, value: d.value })),
          ].map((s) => segmentFacts(scope, all, s, { goal, bounce: false, revenue: false })),
        )
        facts.push(...segments.flat())
      }
      if (hasRevenue(all)) facts.push(revenueFact(scope, all))
    } else {
      const revenue = hasRevenue(all)
      const by = [
        goal && `conversion to "${goal}"`,
        revenue && 'revenue per visitor',
        !goal && 'bounce rate',
      ].filter(Boolean)
      text = `${goal ? conversions.text : 'No goal or custom event was reached.'} Channels are compared by ${by.join(' and ')}, ${period}. A visit's channel is where its first event came from; channels with fewer than ${MIN_SEGMENT} visitors are left out.`
      facts.push(totalFact(scope, 'visitors', all))
      if (goal) facts.push(goalFact(scope, all, goal))
      facts.push(totalFact(scope, 'bounce_rate', all))
      if (revenue) facts.push(revenueFact(scope, all))
      const channels = await topValues(scope, 'channel', TOP_CHANNELS + 1)
      const segments = await Promise.all(
        channels.map((c) =>
          segmentFacts(
            scope,
            all,
            { dimension: 'channel', value: c.value },
            { goal, bounce: true, revenue },
          ),
        ),
      )
      facts.push(...segments.flat())
    }
  }
  return { definition: text, findings: facts.map((f, i) => ({ id: `f${i + 1}`, ...f })) }
}
