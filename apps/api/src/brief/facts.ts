import { z } from 'zod'
import type { KeyEvents } from '../db/schema'
import type { Finding } from '../reading/changes'
import {
  count,
  describe,
  money,
  percent,
  seconds,
  shortDay,
  signed,
  unsupportedNumbers,
} from '../reading/format'
import type { Filters } from '../stats/filters'
import type { Ending, Person } from '../stats/intent'
import type { PathsResult } from '../stats/lanes'
import type { Revenue, Totals } from '../stats/queries'
import { STEADY_DAYS } from '../stats/quiet'
import { type DateRange, days } from '../stats/range'

/**
 * The brief's facts: the sections of the dashboard written out as plain lines, every figure
 * pre-formatted so the model can copy it and `unsupportedNumbers` can check that it did. Each
 * fact belongs to the section that shows it, so a line of the brief links there.
 */

export type Section = 'traffic' | 'tried' | 'paths' | 'quiet'

export interface Fact {
  /** Cited by the model as evidence. */
  id: string
  section: Section
  text: string
  /** Filters that show the fact on the dashboard, for the detected changes. */
  filters?: Filters
}

export interface BriefInputs {
  currency: string
  traffic: {
    totals: Totals & Revenue
    previous: Totals & Revenue
    /** Visitors on a usual day before the range. */
    usual: number | null
    /** Visitors so far today, when the range reaches today. */
    today: number | null
  }
  findings: Finding[]
  intent: {
    events: KeyEvents
    provider: boolean
    totals: { activated: number; tried: number; paid: number }
    previous: { activated: number; tried: number; paid: number }
    people: Person[]
  }
  paths: PathsResult
}

/** People written out; the rest are counted in the totals. */
export const MAX_PEOPLE = 8
/** Events per person, the latest. */
const MAX_TRAIL = 15

const ENDINGS: Record<Ending, string> = {
  paid: 'paid',
  failed: 'a payment failure',
  closed: 'closing the checkout',
  none: 'nothing after',
}

const nowBefore = (now: string, before: string) => `now ${now}, before ${before}`

export function trafficFacts({
  traffic: t,
  currency,
}: Pick<BriefInputs, 'traffic' | 'currency'>): Fact[] {
  const lines = [
    `Visitors: ${nowBefore(count(t.totals.visitors), count(t.previous.visitors))}, change ${signed(change(t.totals.visitors, t.previous.visitors))}`,
    `Pageviews: ${nowBefore(count(t.totals.pageviews), count(t.previous.pageviews))}`,
    `Bounce rate (left after one page): ${nowBefore(percent(t.totals.bounce_rate), percent(t.previous.bounce_rate))}`,
    `Average visit length: ${nowBefore(seconds(t.totals.avg_session_seconds), seconds(t.previous.avg_session_seconds))}`,
  ]
  if (t.totals.revenue || t.previous.revenue)
    lines.push(
      `Revenue (net of refunds): ${nowBefore(money(t.totals.revenue, currency), money(t.previous.revenue, currency))}`,
    )
  if (t.today !== null)
    lines.push(
      `Visitors so far today: ${count(t.today)}${t.usual !== null ? `; a usual day has about ${count(t.usual)}` : ''}`,
    )
  return lines.map((text, i) => ({ id: `t${i + 1}`, section: 'traffic', text }))
}

const change = (now: number, before: number) => (before ? (now - before) / before : null)

export function triedFacts({ intent }: Pick<BriefInputs, 'intent'>): Fact[] {
  const { events, totals: n, previous: b } = intent
  const facts: Fact[] = []
  const add = (text: string) => facts.push({ id: `i${facts.length + 1}`, section: 'tried', text })
  if (events.activation.length)
    add(
      `Visitors who activated (${events.activation.join(', ')}): ${nowBefore(count(n.activated), count(b.activated))}`,
    )
  add(
    `Visitors who tried to pay (${[...events.start, ...events.failed, ...events.closed, ...events.paid].join(', ') || 'no payment events set'}): ${nowBefore(count(n.tried), count(b.tried))}`,
  )
  add(
    `Visitors who paid, ${intent.provider ? 'from the payment provider' : `from ${events.paid.join(', ') || 'no paid event'}`}: ${nowBefore(count(n.paid), count(b.paid))}`,
  )
  intent.people.slice(0, MAX_PEOPLE).forEach((p, i) => {
    const trail = p.trail
      .slice(-MAX_TRAIL)
      .map((e) => `${e.name}${e.n > 1 ? ` ×${e.n}` : ''}`)
      .join(' → ')
    facts.push({
      id: `v${i + 1}`,
      section: 'tried',
      text: `Person who tried to pay: ${[p.country, p.device, p.browser].filter(Boolean).join(', ')}; came from ${p.referrer || p.channel || 'direct'}, entered at ${p.entry || 'unknown'}; ${p.visits} visits; events in order: ${trail || 'none'}; ended with ${ENDINGS[p.ending]}`,
    })
  })
  return facts
}

export function pathFacts({ paths }: Pick<BriefInputs, 'paths'>): Fact[] {
  const facts: Fact[] = paths.lanes.map((lane, i) => {
    const steps = lane.steps.map((s, j) => {
      const before = lane.steps[j - 1]?.visitors
      const kept = j > 0 && before ? `, ${percent(s.visitors / before)} of step ${j}` : ''
      return `step ${j + 1} "${s.name}" ${count(s.visitors)} visitors${kept} (before ${count(s.previous)})`
    })
    const side = lane.side.length
      ? `; along the way, among those who started: ${lane.side.map((e) => `${e.name} ${count(e.visitors)} visitors`).join(', ')}`
      : ''
    return {
      id: `l${i + 1}`,
      section: 'paths' as const,
      text: `Path "${lane.name}"${lane.source === 'draft' ? ' (drafted, not added yet)' : ''}, counted per visitor: ${steps.join('; ')}${side}`,
    }
  })
  if (!paths.lanes.length && paths.events?.length)
    facts.push({
      id: 'e1',
      section: 'paths',
      text: `No paths are defined. Custom events by visitors, now (before): ${paths.events.map((e) => `${e.name} ${count(e.visitors)} (${count(e.previous)})`).join(', ')}`,
    })
  return facts
}

export function quietFacts({ paths }: Pick<BriefInputs, 'paths'>): Fact[] {
  if (!paths.quiet.length)
    return [
      {
        id: 'q1',
        section: 'quiet',
        text: 'No event went quiet: every event that fired nearly every day still does',
      },
    ]
  return paths.quiet.map((q, i) => ({
    id: `q${i + 1}`,
    section: 'quiet',
    text: `Event ${q.name} went quiet: it fired on ${q.active} of ${STEADY_DAYS} days, about ${q.perDay} a day, then nothing for ${q.days} full days; last seen ${shortDay(q.last)}`,
  }))
}

/** The detected changes keep their ids and filters, and sit with traffic. */
function changeFacts({ findings }: BriefInputs): Fact[] {
  return findings.map((f) => ({
    id: f.id,
    section: 'traffic',
    text: describe(f).replace(/^\[[^\]]+\] /, ''),
    filters: f.filters,
  }))
}

export function factsOf(inputs: BriefInputs): Fact[] {
  return [
    ...triedFacts(inputs),
    ...pathFacts(inputs),
    ...quietFacts(inputs),
    ...trafficFacts(inputs),
    ...changeFacts(inputs),
  ]
}

/** The facts as the model sees them, grouped by section. */
export function factLines(facts: Fact[]): string {
  const titles: Record<Section, string> = {
    tried: 'People who tried to pay',
    paths: 'How far people got',
    quiet: 'Events that went quiet',
    traffic: 'Traffic and what changed',
  }
  return (Object.keys(titles) as Section[])
    .map((s) => {
      const lines = facts.filter((f) => f.section === s).map((f) => `[${f.id}] ${f.text}`)
      return lines.length ? `${titles[s]}:\n${lines.join('\n')}` : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export const MIN_LINES = 3
export const MAX_LINES = 6

export interface BriefLine {
  kind: 'fact' | 'guess'
  text: string
  /** The section of the dashboard that shows it. */
  section: Section
  /** Filters that show it, for a line resting on a detected change. */
  filters?: Filters
}

/** Structure only: structured outputs reject length and count limits, so those are applied below. */
export const Output = z.object({
  lines: z.array(
    z.object({
      kind: z.enum(['fact', 'guess']),
      text: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
})

/** The lines that hold up: each cites known facts and quotes only numbers they contain. */
export function vettedLines(
  output: z.infer<typeof Output>,
  facts: Fact[],
  range: DateRange,
): BriefLine[] {
  const byId = new Map(facts.map((f) => [f.id, f]))
  const rangeText = `${days(range)} days ${shortDay(range.from)} ${shortDay(range.to)}`
  return output.lines.slice(0, MAX_LINES).flatMap((line) => {
    const cited = line.evidence.flatMap((id) => byId.get(id) ?? [])
    const first = cited[0]
    if (!line.text.trim() || !first) return []
    const unsupported = unsupportedNumbers(line.text, [rangeText, ...cited.map((f) => f.text)])
    if (unsupported.length) {
      console.warn(`brief: dropped line quoting ${unsupported.join(', ')}: ${line.text}`)
      return []
    }
    const filters = cited.find((f) => f.filters && Object.keys(f.filters).length)?.filters
    return [{ kind: line.kind, text: line.text.trim(), section: first.section, filters }]
  })
}
