import type { SiteSemantics } from '@recount/semantic'
import { z } from 'zod'
import { structured } from '../ai/claude'
import type { Site } from '../db/schema'
import { env } from '../env'
import { unsupportedNumbers } from '../reading/format'
import { BUILT_IN_EVENTS, Match, matchSql } from '../stats/goals'
import { funnelOf, inRange, rows, type Scope } from '../stats/queries'
import { rangeParams } from '../stats/range'
import { describeItem, type Inventory } from './inventory'
import { describeSignal, type Signal } from './signals'

/**
 * A site's semantics as the model drafts them from its inventory, after code has checked every
 * part against the data: what conversion is (goals), the paths to it (funnels), and what the
 * browser cannot see (tracking gaps), which start from the blind spots code found in the data.
 * The model writes definitions only; every count here comes from a query.
 */
export interface Draft {
  about: string
  conversions: Conversion[]
  funnels: DraftFunnel[]
  gaps: Gap[]
  /** The blind spots found in the data, whether or not a gap was drafted for each. */
  signals: Signal[]
  /** Parts the checks dropped, and why. */
  dropped: string[]
  model: string
  generatedAt: string
}

export interface Conversion {
  name: string
  /** What the business lives on, as opposed to a step on the way. */
  primary: boolean
  why: string
  evidence: string[]
  match: Match
  visitors: number
}

export interface DraftFunnel {
  name: string
  why: string
  evidence: string[]
  steps: Array<{ name: string; match: Match; visitors: number }>
}

export interface Gap {
  title: string
  why: string
  /** The line to add to the site. */
  code: string
  /** The id of the signal it starts from; null when it rests on no signal and is a guess. */
  signal: string | null
}

/** Structure only: structured outputs reject length and count limits, so those apply below. */
const MatchOutput = z.object({
  kind: z.enum(['page', 'click', 'event']),
  path: z.string().nullable(),
  text: z.string().nullable(),
  section: z.string().nullable(),
  page: z.string().nullable(),
  href: z.string().nullable(),
  name: z.string().nullable(),
})
const Output = z.object({
  about: z.string(),
  conversions: z.array(
    z.object({
      name: z.string(),
      primary: z.boolean(),
      why: z.string(),
      evidence: z.array(z.string()),
      match: MatchOutput,
    }),
  ),
  funnels: z.array(
    z.object({
      name: z.string(),
      why: z.string(),
      evidence: z.array(z.string()),
      steps: z.array(z.object({ name: z.string(), match: MatchOutput })),
    }),
  ),
  gaps: z.array(
    z.object({
      title: z.string(),
      why: z.string(),
      code: z.string(),
      signal: z.string().nullable(),
    }),
  ),
})

const MAX_CONVERSIONS = 6
const MAX_FUNNELS = 2
const MAX_GAPS = 8
/** Gaps no signal points at: the model's guesses of what a site of its kind should track. */
const MAX_GUESSES = 2

const SYSTEM = `You define what matters on a website for its analytics: what counts as a conversion, the paths visitors take to it, and what the data cannot show. You get an inventory of the site's data from the last 30 days. Each item has an id.

How a definition matches events:
- page: a pageview whose path matches "path". "*" stands for any characters, "/" included ("/blog/*").
- click: a click whose element text or aria-label contains "text" (ignoring case), inside the page section named "section" (exact, ignoring case), on a page matching "page" (a path pattern), linking to an address containing "href". Set at least one of text, section or href; leave the others null.
- event: a custom event the site already sends, by "name". Only names listed in the inventory.
Fields that do not apply to the kind are null.

Conversions:
- A conversion is an outcome the site exists for: a payment, a signup, a submitted form, a visitor sent on to where the site wants them to go. Not a page view on the way.
- Prefer the most direct evidence of the outcome: a custom event the site sends for it, then a confirmation or thank-you page, then the click that completes it (a submit button), and only then a page visit.
- Use the paying-session items to see which steps lead to payment: something in most paying sessions but few sessions overall is a strong step. Never name a payment itself as a conversion; payments are counted already.
- When the same action repeats across many items (a "Visit" link on every tool page, a "Buy" button on every product), define one conversion for all of them, using what they share (section, common text, page pattern), not one per item.
- Mark as primary the one or two conversions the business lives on. 1 to 6 conversions, each defined once.
- Name each in a few words of plain English, as an action ("Submitted a tool", "Chose Pro").

Funnels:
- 1 or 2 funnels, each 2 to 5 steps a converting visitor really takes, in order, ending at a primary conversion. A step may use a path pattern for a group of pages ("/tools/*").
- Every step must be something listed in the inventory. A click and the page it opens are one step, not two: use the page.
- Steps of a funnel use the same definitions as the conversions where they are the same thing.

Tracking gaps:
- Start from the blind-spot signals: code found each in the data, and each is something visitors do that the events do not show. One gap per signal, with "signal" set to its id; "why" says what visitors are likely doing there that goes unrecorded. Skip a signal only when an inventory item already records what it points at.
  - long stay: visitors spend minutes on the page with nothing tracked. Record the action inside it (a game started, a video played, a result exported).
  - clicks on an element with no text or label: likely an icon. Name what it does with data-rc-event on the element.
  - checkout with no payments recorded: the purchase completes where the browser cannot see it. Send an event when the order is confirmed, with its plan or amount.
  - form sent with nothing after it: the result shows in place. Send an event when the form succeeds.
- Then at most 2 outcomes that matter to this business that no signal points at and nothing in the inventory shows: a result only the server knows (signup confirmed), or a value (plan, amount). Set "signal" to null; these are shown as guesses.
- For each gap, the one line of code to add, using recount('Event name', { props: { ... } }) in the site's JavaScript, or the attribute data-rc-event="Event name" on an element. Use variables for values the page knows (plan, category), not made-up literals. No gap for something already in the inventory, or for an event the owner already describes: it is sent, just not seen in this range.

Each "why" is one sentence, in words a site owner understands, saying what in the data shows this; list the ids it rests on in "evidence", not in the sentence. Do not write numbers in "why" or "about". "about" says in one or two sentences what the site is and what it wants visitors to do, as far as the data shows.`

function prompt(inventory: Inventory, semantics: SiteSemantics | undefined) {
  const known = semantics
    ? `\n${semantics.about ? `What the owner wrote about the site: ${semantics.about}\n` : 'Events the owner defined:\n'}${semantics.events
        .map((e) => `- event "${e.name}": ${e.description}`)
        .join('\n')}\n`
    : ''
  return `Site: ${inventory.domain}
Range: ${inventory.range.from} to ${inventory.range.to}; ${inventory.visitors} visitors in ${inventory.sessions} sessions.
${known}
Inventory:
${inventory.items.map(describeItem).join('\n')}

Blind-spot signals:
${inventory.signals.length ? inventory.signals.map(describeSignal).join('\n') : 'None found.'}`
}

/** Inventory and signal ids such as P10 or S2, which a sentence may cite despite being told not to. */
const ID = /\s*\(?(?<!\w)[PGTCERS]\d+(?:,\s*[PGTCERS]\d+)*\)?(?!\w)/g
export const withoutIds = (text: string) => text.replace(ID, '').trim()

/** A model match with nulls dropped, if it is a valid rule. */
function toMatch(output: z.infer<typeof MatchOutput>): Match | undefined {
  const fields = Object.fromEntries(
    Object.entries(output).filter(([, v]) => v !== null && String(v).trim() !== ''),
  )
  const parsed = Match.safeParse(fields)
  return parsed.success ? parsed.data : undefined
}

const describeMatch = (m: Match) => JSON.stringify(m)

/** Below this many visitors in the range, a draft would rest on too little to mean anything. */
export const MIN_VISITORS = 100

export async function draftSemantics(
  site: Site,
  inventory: Inventory,
  semantics: SiteSemantics | undefined,
): Promise<Draft> {
  if (inventory.visitors < MIN_VISITORS)
    throw new Error(`${inventory.visitors} visitors in the range; a draft needs ${MIN_VISITORS}`)
  const output = await structured({
    site,
    kind: 'semantics',
    model: env.READING_MODEL,
    system: SYSTEM,
    user: prompt(inventory, semantics),
    schema: Output,
    maxTokens: 4000,
  })
  return checkDraft(site, inventory, output)
}

/**
 * Keeps the parts of the model's draft that hold up: valid rules, evidence that exists, no
 * numbers the inventory does not contain, and matches that count at least one visitor.
 */
export async function checkDraft(
  site: Site,
  inventory: Inventory,
  output: z.infer<typeof Output>,
): Promise<Draft> {
  const byId = new Map(inventory.items.map((item) => [item.id, describeItem(item)]))
  const events = new Set(inventory.items.flatMap((i) => (i.kind === 'event' ? [i.name] : [])))
  const dropped: string[] = []
  const cited = (ids: string[]) => ids.filter((id) => byId.has(id))
  const numbersOk = (label: string, text: string, ids: string[]) => {
    const extra = unsupportedNumbers(
      withoutIds(text),
      ids.map((id) => byId.get(id) as string),
    )
    if (extra.length) dropped.push(`${label}: quotes ${extra.join(', ')} not in its evidence`)
    return extra.length === 0
  }
  const valid = (label: string, raw: z.infer<typeof MatchOutput>) => {
    const match = toMatch(raw)
    if (!match) dropped.push(`${label}: not a valid rule (${JSON.stringify(raw)})`)
    else if (match.kind === 'event' && !events.has(match.name)) {
      dropped.push(`${label}: no custom event named ${match.name}`)
      return undefined
    }
    return match
  }
  const params = { site: site.id, tz: site.timezone, ...rangeParams(inventory.range) }
  const visitorsOf = async (match: Match) => {
    const m = matchSql(match, 'm')
    const [row] = await rows<{ visitors: number }>(
      `SELECT uniqExact(visitor_id) AS visitors FROM events WHERE ${inRange} AND ${m.sql}`,
      { ...params, ...m.params },
    )
    return Number(row?.visitors ?? 0)
  }

  const conversions: Conversion[] = []
  const names = new Set<string>()
  for (const c of output.conversions.slice(0, MAX_CONVERSIONS)) {
    const name = c.name.trim().slice(0, 120)
    const label = `Conversion "${name}"`
    const evidence = cited(c.evidence)
    const match = valid(label, c.match)
    if (!match) continue
    if (!name || names.has(name.toLowerCase()) || BUILT_IN_EVENTS.includes(name)) {
      dropped.push(`${label}: empty, repeated or reserved name`)
      continue
    }
    if (evidence.length === 0) {
      dropped.push(`${label}: cites nothing in the inventory`)
      continue
    }
    if (!numbersOk(label, c.why, evidence)) continue
    const visitors = await visitorsOf(match)
    if (visitors === 0) {
      dropped.push(`${label}: ${describeMatch(match)} matches no visitor`)
      continue
    }
    names.add(name.toLowerCase())
    conversions.push({
      name,
      primary: c.primary,
      why: withoutIds(c.why),
      evidence,
      match,
      visitors,
    })
  }

  const scope: Scope = { site, range: inventory.range, filters: {}, goals: [] }
  const funnels: DraftFunnel[] = []
  for (const f of output.funnels.slice(0, MAX_FUNNELS)) {
    const name = f.name.trim().slice(0, 120)
    const label = `Funnel "${name}"`
    const evidence = cited(f.evidence)
    const steps = f.steps.map((s, i) => ({
      name: s.name.trim().slice(0, 120),
      match: valid(`${label} step ${i + 1}`, s.match),
    }))
    if (steps.length < 2 || steps.length > 8 || steps.some((s) => !s.match || !s.name)) {
      dropped.push(`${label}: needs 2 to 8 valid, named steps`)
      continue
    }
    if (!numbersOk(label, f.why, evidence)) continue
    const counts = await funnelOf(
      scope,
      steps.map((s) => s.match as Match),
      inventory.range,
    )
    if (!counts.at(-1)) {
      dropped.push(`${label}: no visitor reaches the last step`)
      continue
    }
    funnels.push({
      name,
      why: withoutIds(f.why),
      evidence,
      steps: steps.map((s, i) => ({
        name: s.name,
        match: s.match as Match,
        visitors: counts[i] ?? 0,
      })),
    })
  }

  const signals = new Map(inventory.signals.map((s) => [s.id, describeSignal(s)]))
  for (const [id, text] of signals) byId.set(id, text)
  const gaps: Gap[] = []
  const covered = new Set<string>()
  for (const g of output.gaps.slice(0, MAX_GAPS)) {
    const title = g.title.trim()
    const label = `Gap "${title}"`
    if (!title || !g.code.trim()) continue
    const signal = g.signal && signals.has(g.signal) ? g.signal : null
    if (g.signal && !signal) dropped.push(`${label}: no signal ${g.signal}, so it is a guess`)
    if (signal && covered.has(signal)) {
      dropped.push(`${label}: a second gap for ${signal}`)
      continue
    }
    if (!signal && gaps.filter((x) => !x.signal).length >= MAX_GUESSES) {
      dropped.push(`${label}: more than ${MAX_GUESSES} guesses`)
      continue
    }
    if (!numbersOk(label, g.why, [...byId.keys()])) continue
    if (signal) covered.add(signal)
    gaps.push({ title, why: withoutIds(g.why), code: g.code.trim(), signal })
  }
  // Grounded gaps first, in the order their signals were found.
  const order = (g: Gap) => (g.signal ? inventory.signals.findIndex((s) => s.id === g.signal) : 99)
  gaps.sort((a, b) => order(a) - order(b))

  let about = withoutIds(output.about)
  if (unsupportedNumbers(about, [...byId.values()]).length) {
    dropped.push('About: quotes numbers the inventory does not contain')
    about = ''
  }
  return {
    about,
    conversions,
    funnels,
    gaps,
    signals: inventory.signals,
    dropped,
    model: env.READING_MODEL,
    generatedAt: new Date().toISOString(),
  }
}
