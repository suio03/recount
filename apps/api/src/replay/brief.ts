import { semanticsFor } from '@recount/sites'
import { z } from 'zod'
import type { Site } from '../db/schema'
import { money } from '../reading/format'
import type { Interaction } from './extract'
import { renderTimeline } from './render'

/**
 * What the model is told about one recorded session and what is kept of its answer. Kept apart
 * from the calls and storage in summarize.ts so it can be tested without either.
 */

/** Bump when the prompt or output shape changes, so summaries are written again. */
export const SUMMARY_VERSION = 1

/** Longer timelines are cut, keeping the start and the end, where intent and outcome show. */
const MAX_LINES = 300
const MAX_MOMENTS = 4
/** Two clicks that do nothing can be chance; more say something on the page looks clickable. */
const DEAD_CLICKS = 2

export type Reason =
  | 'paid'
  | 'abandoned_form'
  | 'error'
  | 'rage_click'
  | 'dead_clicks'
  | 'key_event'

/** Most notable first: what gets summarized when the day's budget runs short. */
const REASONS: Reason[] = [
  'paid',
  'abandoned_form',
  'error',
  'rage_click',
  'dead_clicks',
  'key_event',
]

export interface Candidate {
  session_id: string
  started_at: string
  ended_at: string
  pages: number
  rage_clicks: number
  dead_clicks: number
  errors: number
  abandoned_forms: number
  timeline: string
  revenue: number
  event_names: string[]
  channel: string
  referrer: string
  campaign: string
  country: string
  device: string
  browser: string
}

export function reasonsOf(c: Candidate, keyEvents: Set<string>): Reason[] {
  const found = new Set<Reason>()
  if (c.revenue > 0) found.add('paid')
  if (c.abandoned_forms > 0) found.add('abandoned_form')
  if (c.errors > 0) found.add('error')
  if (c.rage_clicks > 0) found.add('rage_click')
  if (c.dead_clicks >= DEAD_CLICKS) found.add('dead_clicks')
  if (c.event_names.some((n) => keyEvents.has(n))) found.add('key_event')
  return REASONS.filter((r) => found.has(r))
}

export const rank = (reasons: Reason[]) =>
  reasons[0] ? REASONS.indexOf(reasons[0]) : REASONS.length

export const Output = z.object({
  headline: z.string(),
  intent: z.string(),
  outcome: z.enum(['purchased', 'converted', 'gave_up', 'stuck', 'browsed', 'left_quickly']),
  moments: z.array(
    z.object({
      line: z.number(),
      kind: z.enum(['friction', 'intent', 'progress']),
      text: z.string(),
    }),
  ),
})

export interface Moment {
  /** Milliseconds from the session's start. */
  t: number
  kind: 'friction' | 'intent' | 'progress'
  text: string
}

export interface Summary {
  headline: string
  intent: string
  outcome: z.infer<typeof Output>['outcome']
  moments: Moment[]
}

export const SYSTEM = `You summarize one recorded visit to a website for the site's owner, who will not watch the recording.

You get the visit's details and its timeline: pages, what the visitor clicked, which fields they edited (never what they typed), sections they scrolled to, pauses, errors, and two frustration signals: "rage click" (rapid repeated clicks on one thing) and "nothing happened" (a click the page did not react to). Body text on the site is hidden from you; element names, headings and section names are all you know about the page.

Rules:
- Use only the details and timeline. Never invent page content, prices or reasons the timeline does not show.
- Say what the visitor most likely came to do, what they did, where they hesitated or got stuck, and how the visit ended. Anything inferred is "likely" or "seems".
- Keep events in the order the timeline gives them. Do not claim what the visitor read or looked at beyond the sections they reached.
- Point at the 1 to 4 moments that matter most, by their [line] numbers: the clicks, edits, pauses and errors that show something, not page lines unless the page itself is the point. kind is "friction" when something got in the way, "intent" when it shows what they wanted, "progress" when it is a step toward converting. Each moment's text is one sentence on what happened and why it matters, without line numbers or timestamps.
- outcome: "purchased" when they paid, "converted" when a key event fired without payment, "gave_up" when they started something (a form, a checkout) and left it, "stuck" when friction ended the visit, "browsed" when they read without a clear goal, "left_quickly" when the visit was too short to say more.
- The headline is one sentence the owner could stop at. Lead with the friction when there was any, else with the outcome.
- intent is one short sentence.
- Plain, specific English. No advice, no markdown.`

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/** The timeline as numbered lines, cut in the middle when long. */
export function numbered(timeline: Interaction[]) {
  const lines = renderTimeline(timeline).split('\n')
  const kept =
    lines.length <= MAX_LINES
      ? lines.map((l, i) => ({ l, i }))
      : [
          ...lines.slice(0, MAX_LINES / 2).map((l, i) => ({ l, i })),
          { l: `… ${lines.length - MAX_LINES} lines omitted …`, i: -1 },
          ...lines
            .slice(-MAX_LINES / 2)
            .map((l, j) => ({ l, i: lines.length - MAX_LINES / 2 + j })),
        ]
  return kept.map(({ l, i }) => (i < 0 ? l : `[${i}] ${l}`)).join('\n')
}

export function prompt(site: Site, c: Candidate, timeline: Interaction[], reasons: Reason[]) {
  const semantics = semanticsFor(site.domain)
  const about = semantics
    ? [
        `About the site: ${semantics.about}`,
        'Events:',
        ...semantics.events.map(
          (e) => `- ${e.name}${e.key ? ' (key event)' : ''}: ${e.description}`,
        ),
      ].join('\n')
    : 'No site description is available.'
  const duration = Date.parse(`${c.ended_at}Z`) - Date.parse(`${c.started_at}Z`)
  const visit = [
    `Came from: ${c.channel || 'unknown'}${c.referrer ? ` (${c.referrer})` : ''}${c.campaign ? `, campaign ${c.campaign}` : ''}`,
    `Where: ${[c.country, c.device, c.browser].filter(Boolean).join(', ') || 'unknown'}`,
    `Length: ${clock(duration)}, ${c.pages} page${c.pages === 1 ? '' : 's'}`,
    c.event_names.length ? `Events fired: ${c.event_names.join(', ')}` : 'Events fired: none',
    c.revenue > 0 ? `Paid: ${money(c.revenue, site.currency)}` : 'Paid: nothing',
    `Picked for review because: ${reasons.join(', ')}`,
  ].join('\n')
  return `Site: ${site.domain}\n${about}\n\nVisit:\n${visit}\n\nTimeline:\n${numbered(timeline)}`
}

/**
 * The model's moments that point at real lines, once each, in time order, with the time of the
 * line they cite so they can open the replay there.
 */
export function keepMoments(
  moments: z.infer<typeof Output>['moments'],
  timeline: Interaction[],
): Moment[] {
  const seen = new Set<number>()
  return moments
    .filter((m) => {
      if (!Number.isInteger(m.line) || !timeline[m.line] || seen.has(m.line) || !m.text.trim())
        return false
      seen.add(m.line)
      return true
    })
    .slice(0, MAX_MOMENTS)
    .map((m) => ({ t: timeline[m.line]?.t ?? 0, kind: m.kind, text: m.text.trim() }))
    .sort((a, b) => a.t - b.t)
}
