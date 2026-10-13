import type { SiteSemantics } from '@recount/semantic'
import { z } from 'zod'
import { unsupportedNumbers } from '../reading/format'
import type { Moment } from './brief'
import type { ListedSession } from './list'

/**
 * What the model is told about a range's summarized sessions, and what is kept of the patterns
 * it finds across them. Kept apart from the calls and the cache in digest.ts so it can be tested
 * without either.
 */

/** Bump when the prompt or output shape changes, so cached digests are rewritten. */
export const DIGEST_VERSION = 2

/** Fewer sessions than this have nothing in common worth a model call; the list says it all. */
export const MIN_SESSIONS = 3
/** A pattern is something several visitors did; one session is just its own summary. */
const MIN_SUPPORT = 2
const MAX_PATTERNS = 5

export const Output = z.object({
  headline: z.string(),
  patterns: z.array(
    z.object({
      kind: z.enum(['friction', 'intent', 'progress']),
      title: z.string(),
      text: z.string(),
      evidence: z.array(z.object({ session: z.string(), moment: z.number() })),
    }),
  ),
})

export interface Evidence {
  session: string
  /** Where the cited moment happens, in ms from the session's start; null cites the whole visit. */
  t: number | null
}

export interface Pattern {
  kind: Moment['kind']
  title: string
  text: string
  /** Distinct sessions the pattern rests on. */
  sessions: number
  evidence: Evidence[]
}

export interface Digest {
  headline: string
  patterns: Pattern[]
}

export const SYSTEM = `You read the AI summaries of a website's notable recorded visits over a period and tell the site's owner what several visitors had in common, so they never have to read the visits one by one.

Each visit has a label like [s3], its outcome, why it was picked, where it came from, a headline, the visitor's likely intent, and numbered moments like (m2).

Rules:
- Find the patterns: the same friction, intent or path showing up in more than one visit. A pattern rests on at least two visits; a lone visit, however striking, is not a pattern.
- kind is "friction" when something got in the way, "intent" when it shows what visitors came for, "progress" when it is a path that led to converting.
- Cite every visit the pattern rests on, each once, by its label. Cite the moment that shows it by number, or 0 when the visit as a whole shows it.
- Lead with friction that cost conversions, then intent, then what worked. 1 to 5 patterns.
- title is a short phrase naming the pattern, like "Pricing table read as links". text is one or two sentences: what visitors did, on which page or element, and what it likely means.
- Never say how many visits or visitors did something, in digits or in words ("two of them", "in most visits", "all three"); the dashboard shows the count next to each pattern. Say "visitors" or "some visitors". Copy any other figure exactly from the summaries.
- Use only what the summaries say; anything inferred is "likely" or "seems".
- The headline is one sentence across all the visits that the owner could stop at.
- Plain, specific English. No advice, no markdown.`

const label = (i: number) => `s${i + 1}`

function clock(ms: number) {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** One visit as the model sees it. */
export function describeSession(s: ListedSession, i: number) {
  const from = [s.channel, s.referrer].filter(Boolean).join(' · ') || 'unknown source'
  const where = [s.country, s.device].filter(Boolean).join(', ')
  return [
    `[${label(i)}] ${s.summary.outcome}; picked for: ${s.reasons.join(', ') || 'nothing'}; from ${from}${where ? `; ${where}` : ''}; landed on ${s.entry || '/'}; ${s.pages} page${s.pages === 1 ? '' : 's'}`,
    `Headline: ${s.summary.headline}`,
    `Intent: ${s.summary.intent}`,
    ...s.summary.moments.map((m, j) => `(m${j + 1}) ${clock(m.t)} ${m.kind}: ${m.text}`),
  ].join('\n')
}

export function prompt(
  domain: string,
  period: string,
  sessions: ListedSession[],
  semantics: SiteSemantics | undefined,
) {
  const about = semantics
    ? `About the site: ${semantics.about}`
    : 'No site description is available.'
  return `Site: ${domain}\nPeriod: ${period}\n${about}\n\nVisits:\n\n${sessions.map(describeSession).join('\n\n')}`
}

/**
 * The model's patterns that rest on enough real sessions, with each citation resolved to a
 * session id and moment time. Patterns quoting numbers their sessions do not contain are
 * dropped; the rest are ordered by how many sessions show them.
 */
export function keepPatterns(
  output: z.infer<typeof Output>,
  sessions: ListedSession[],
  period: string,
): Digest {
  const byLabel = new Map(sessions.map((s, i) => [label(i), { s, text: describeSession(s, i) }]))
  const patterns = output.patterns.flatMap((p): Pattern[] => {
    const seen = new Set<string>()
    const cited: string[] = []
    const evidence = p.evidence.flatMap((e): Evidence[] => {
      const found = byLabel.get(e.session.trim().replace(/^\[|\]$/g, ''))
      if (!found || seen.has(found.s.id)) return []
      seen.add(found.s.id)
      cited.push(found.text)
      const moment = Number.isInteger(e.moment) ? found.s.summary.moments[e.moment - 1] : undefined
      return [{ session: found.s.id, t: moment?.t ?? null }]
    })
    const title = p.title.trim()
    const text = p.text.trim()
    if (evidence.length < MIN_SUPPORT || !title || !text) return []
    const unsupported = unsupportedNumbers(`${title} ${text}`, [period, ...cited])
    if (unsupported.length) {
      console.warn(`replay digest: dropped pattern quoting ${unsupported.join(', ')}: ${title}`)
      return []
    }
    return [{ kind: p.kind, title, text, sessions: evidence.length, evidence }]
  })
  const kept = patterns
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.sessions - a.p.sessions || a.i - b.i)
    .slice(0, MAX_PATTERNS)
    .map(({ p }) => p)
  // A headline with a number no summary contains falls back to the strongest pattern.
  const all = [period, ...sessions.map(describeSession)]
  const headline =
    output.headline.trim() && !unsupportedNumbers(output.headline, all).length
      ? output.headline.trim()
      : (kept[0]?.title ?? '')
  return { headline, patterns: kept }
}
