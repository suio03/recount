import type { Fact } from '../brief/facts'
import { count, money, percent, seconds } from '../reading/format'
import type { Ending } from '../stats/intent'
import type { Lane } from '../stats/paths'
import type { PropRow, Split, SplitRow, Stuck, VisitorEvent, VisitorProfile } from './queries'

/**
 * "Why?" facts: one lane or one visitor written out as plain lines, every figure pre-formatted
 * so the model can copy it and the vetting can check it did.
 */

export interface LaneInputs {
  lane: Lane
  splits: Partial<Record<Split, SplitRow[]>>
  /** Properties on the lane's side events. */
  props: PropRow[]
  /** Where the biggest drop happened, when there is one. */
  stuck: Stuck | null
}

const SPLIT_LABELS: Record<Split, string> = {
  device: 'Device',
  channel: 'Channel',
  browser: 'Browser',
}

/** Values per property, and properties per event. */
const MAX_PROP_VALUES = 5
const MAX_PROP_KEYS = 4
/** Long property values are cut, since an error message can run to a page. */
const MAX_VALUE_CHARS = 80

const kept = (now: number, before: number | undefined) =>
  before ? ` (${percent(now / before)} of the step before)` : ''

/** The step where most people were lost, from 1, or null when nobody was. */
export function biggestDrop(steps: number[]): number | null {
  let best: number | null = null
  let lost = 0
  for (let i = 0; i + 1 < steps.length; i++) {
    const gone = (steps[i] ?? 0) - (steps[i + 1] ?? 0)
    if (gone > lost) {
      lost = gone
      best = i + 1
    }
  }
  return best
}

const cut = (v: string) => (v.length > MAX_VALUE_CHARS ? `${v.slice(0, MAX_VALUE_CHARS)}…` : v)

export function laneFacts({ lane, splits, props, stuck }: LaneInputs): Fact[] {
  const facts: Fact[] = []
  const add = (prefix: string, text: string) =>
    facts.push({
      id: `${prefix}${facts.filter((f) => f.id.startsWith(prefix)).length + 1}`,
      section: 'paths',
      text,
    })
  const starters = lane.steps[0]?.visitors ?? 0

  lane.steps.forEach((s, i) => {
    const before = lane.steps[i - 1]
    add(
      's',
      `Step ${i + 1} "${s.name}": ${count(s.visitors)} visitors${kept(s.visitors, before?.visitors)}; the period before, ${count(s.previous)}${kept(s.previous, before?.previous)}`,
    )
  })

  for (const [split, values] of Object.entries(splits) as Array<[Split, SplitRow[]]>)
    for (const v of values)
      add(
        'd',
        `${SPLIT_LABELS[split]} ${v.value}: ${v.steps
          .map((n, i) => `step ${i + 1} ${count(n)}${kept(n, v.steps[i - 1])}`)
          .join(', ')}`,
      )

  for (const e of lane.side)
    add(
      'x',
      `${e.name} was sent by ${count(e.visitors)} of the ${count(starters)} visitors who reached step 1`,
    )

  const byEvent = new Map<string, Map<string, PropRow[]>>()
  for (const p of props) {
    const keys = byEvent.get(p.name) ?? new Map<string, PropRow[]>()
    keys.set(p.key, [...(keys.get(p.key) ?? []), p])
    byEvent.set(p.name, keys)
  }
  for (const [name, keys] of byEvent)
    for (const [key, values] of [...keys].slice(0, MAX_PROP_KEYS))
      add(
        'p',
        `${name} carried ${key}: ${values
          .slice(0, MAX_PROP_VALUES)
          .map((v) => `"${cut(v.value)}" for ${count(v.visitors)} visitors`)
          .join(', ')}`,
      )

  if (stuck && stuck.visitors > 0) {
    const next = lane.steps[stuck.step]?.name
    const events = stuck.events.length
      ? `custom events they sent in the range: ${stuck.events.map((e) => `${e.name} ${count(e.visitors)}`).join(', ')}`
      : 'they sent no other custom events in the range'
    const exits = stuck.exits.length
      ? `; the last page they viewed: ${stuck.exits.map((e) => `${e.page} ${count(e.visitors)}`).join(', ')}`
      : ''
    add(
      'k',
      `${count(stuck.visitors)} visitors reached step ${stuck.step} and not step ${stuck.step + 1}${next ? ` "${next}"` : ''}; ${events}${exits}`,
    )
  }
  return facts
}

export interface PersonInputs {
  profile: VisitorProfile | null
  events: VisitorEvent[]
  ending: Ending
  /** Minor units paid by the provider's records. */
  amount: number
  currency: string
  timezone: string
  /** Failure and give-up events they sent, with how many visitors across the site sent each. */
  faults: Array<{ name: string; visitors: number; previous: number }>
}

const ENDINGS: Record<Ending, string> = {
  paid: 'paid',
  failed: 'a payment failure',
  closed: 'closing the checkout',
  none: 'nothing after starting to pay',
}

/** Visits written out, the latest, and entries per visit. */
const MAX_VISITS = 5
const MAX_ENTRIES = 40
/** Properties shown per event. */
const MAX_PROPS = 4

interface Entry {
  label: string
  at: number
  n: number
}

/** One event as written in a visit: pages by path, clicks by text, events with their properties. */
function labelOf(e: VisitorEvent) {
  if (e.name === 'pageview') return `viewed ${e.path}`
  if (e.name === 'click')
    return `clicked ${e.text ? `"${cut(e.text)}"` : 'an element with no text'}`
  const props = Object.entries(e.props)
    .slice(0, MAX_PROPS)
    .map(([k, v]) => `${k}=${cut(v)}`)
  return `${e.name}${props.length ? ` {${props.join(', ')}}` : ''}`
}

export function personFacts(p: PersonInputs): Fact[] {
  const facts: Fact[] = []
  const add = (id: string, text: string) => facts.push({ id, section: 'tried', text })
  const visits = new Map<string, VisitorEvent[]>()
  for (const e of p.events) visits.set(e.session, [...(visits.get(e.session) ?? []), e])

  const who = p.profile
  add(
    'a1',
    `Visitor from ${who?.country || 'an unknown country'} on ${[who?.device, who?.browser, who?.os].filter(Boolean).join(', ') || 'an unknown device'}; first came from ${who?.referrer || who?.channel || 'direct'}, entered at ${who?.entry || 'an unknown page'}; ${visits.size} visits in range; ended with ${ENDINGS[p.ending]}${p.amount ? `, paying ${money(p.amount, p.currency)}` : ''}`,
  )

  const time = new Intl.DateTimeFormat('en', {
    timeZone: p.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const all = [...visits.values()]
  all.slice(-MAX_VISITS).forEach((events, i) => {
    const start = events[0]?.at ?? 0
    const entries: Entry[] = []
    for (const e of events) {
      const label = labelOf(e)
      const prev = entries.at(-1)
      if (prev?.label === label) prev.n++
      else entries.push({ label, at: e.at, n: 1 })
    }
    const shown = entries.slice(-MAX_ENTRIES)
    const skipped = entries.length - shown.length
    const n = all.length - Math.min(all.length, MAX_VISITS) + i + 1
    add(
      `e${i + 1}`,
      `Visit ${n} on ${time.format(start)}, from ${events[0]?.referrer || 'direct'}: ${skipped ? `(${skipped} earlier steps left out) ` : ''}${shown
        .map(
          (x) =>
            `${x.label}${x.n > 1 ? ` ×${x.n}` : ''}${x.at > start ? ` at +${seconds((x.at - start) / 1000)}` : ''}`,
        )
        .join(' → ')}`,
    )
  })

  p.faults.forEach((f, i) =>
    add(
      `c${i + 1}`,
      `Across the site in this range, ${f.name} was sent by ${count(f.visitors)} visitors; the period before, ${count(f.previous)}`,
    ),
  )
  return facts
}
