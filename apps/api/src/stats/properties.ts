import { binsOf, tidy } from './bins'
import { inRange, rows, type Scope, sessions } from './queries'

/**
 * The properties custom events carry (`recount('Signup', { props: { plan: 'pro' } })`), read
 * among the events of one name in the sessions in scope. Values arrive as strings; a property
 * whose every value reads as a number also gets its distribution.
 */

const MAX_KEYS = 50

/** A decimal number as `String(n)` writes one: `12`, `-0.5`, `1e+21`. */
const NUMBER = '^-?(\\d+\\.?\\d*|\\.\\d+)([eE][-+]?\\d+)?$'

function eventsOf(scope: Scope, event: string) {
  const s = sessions(scope)
  return {
    where: `${inRange} AND name = {event:String} AND session_id IN (SELECT session_id FROM (${s.sql}))`,
    params: { ...s.params, event },
  }
}

export interface PropertyKey {
  key: string
  visitors: number
  events: number
}

/** The property names one event carries, with the visitors and events that carry each. */
export async function propertiesOf(scope: Scope, event: string) {
  const e = eventsOf(scope, event)
  const [keys, [total]] = await Promise.all([
    rows<PropertyKey>(
      `SELECT key, uniqExact(visitor_id) AS visitors, count() AS events
       FROM events ARRAY JOIN mapKeys(props) AS key
       WHERE ${e.where}
       GROUP BY key ORDER BY visitors DESC, key LIMIT {limit:UInt32}`,
      { ...e.params, limit: MAX_KEYS },
    ),
    rows<{ events: number }>(`SELECT count() AS events FROM events WHERE ${e.where}`, e.params),
  ])
  return { event, events: Number(total?.events ?? 0), properties: keys }
}

export interface Distribution {
  min: number
  p25: number
  median: number
  p75: number
  max: number
  /** Events per bin; a bin covers `from` up to, not including, `to`. */
  bins: Array<{ from: number; to: number; events: number }>
}

/**
 * One property's values with the visitors and events carrying each, most visitors first, and its
 * distribution over events when every value is a number.
 */
export async function propertyOf(scope: Scope, event: string, key: string, limit: number) {
  const e = eventsOf(scope, event)
  const where = `${e.where} AND mapContains(props, {key:String})`
  const params = { ...e.params, key }
  const [values, [summary]] = await Promise.all([
    rows<{ value: string; visitors: number; events: number }>(
      `SELECT props[{key:String}] AS value, uniqExact(visitor_id) AS visitors, count() AS events
       FROM events WHERE ${where}
       GROUP BY value ORDER BY visitors DESC, value LIMIT {limit:UInt32}`,
      { ...params, limit },
    ),
    rows<{
      events: number
      visitors: number
      distinct: number
      other: number
      fractions: number
      min: number
      max: number
      q: number[]
    }>(
      `SELECT count() AS events, uniqExact(visitor_id) AS visitors, uniqExact(v) AS distinct,
              countIf(NOT match(v, {number:String})) AS other, countIf(x != floor(x)) AS fractions,
              min(x) AS min, max(x) AS max, quantilesExact(0.25, 0.5, 0.75)(x) AS q
       FROM (
         SELECT visitor_id, props[{key:String}] AS v,
                if(match(v, {number:String}), toFloat64(v), 0) AS x
         FROM events WHERE ${where}
       )`,
      { ...params, number: NUMBER },
    ),
  ])
  const events = Number(summary?.events ?? 0)
  const base = {
    event,
    key,
    events,
    visitors: Number(summary?.visitors ?? 0),
    distinct: Number(summary?.distinct ?? 0),
    values,
  }
  if (!summary || events === 0 || Number(summary.other) > 0) return { ...base, distribution: null }

  const min = Number(summary.min)
  const max = Number(summary.max)
  const bins = binsOf(min, max, Number(summary.fractions) === 0)
  const counted = await rows<{ bin: number; events: number }>(
    `SELECT least(toInt64(floor((toFloat64(props[{key:String}]) - {start:Float64}) / {width:Float64} + 1e-9)),
                  {last:Int64}) AS bin, count() AS events
     FROM events WHERE ${where} GROUP BY bin`,
    { ...params, start: bins.start, width: bins.width, last: bins.count - 1 },
  )
  const byBin = new Map(counted.map((c) => [Number(c.bin), Number(c.events)]))
  const [p25 = min, median = min, p75 = max] = summary.q.map(Number)
  const distribution: Distribution = {
    min,
    p25,
    median,
    p75,
    max,
    bins: Array.from({ length: bins.count }, (_, i) => ({
      from: tidy(bins.start + i * bins.width),
      to: tidy(bins.start + (i + 1) * bins.width),
      events: byBin.get(i) ?? 0,
    })),
  }
  return { ...base, distribution }
}
