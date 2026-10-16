import { z } from 'zod'
import { pathFacts, quietFacts, trafficFacts, triedFacts } from '../brief/facts'
import type { Site } from '../db/schema'
import { count, money, shortDay } from '../reading/format'
import { breakdownOf, DIMENSIONS } from '../stats/breakdown'
import { bucketSql, bucketsOf } from '../stats/buckets'
import { FILTER_KEYS, type Filters } from '../stats/filters'
import type { GoalDefinition } from '../stats/goals'
import { intentOf } from '../stats/intent'
import { pathsFor } from '../stats/lanes'
import { propertiesOf, propertyOf } from '../stats/properties'
import { goalsOf, revenueOf, rows, type Scope, sessions, totalsOf } from '../stats/queries'
import { type DateRange, days, intervalOf, isOpen, previousRange } from '../stats/range'
import { usualVisitors } from '../stats/usual'
import { laneFactsOf, visitorFactsOf, WhyMissing } from '../why'

/**
 * Read-only queries over one site, each answering in plain lines with every figure written out
 * so a model can copy it and the vetting can check it did. Ask's model loop and the MCP server
 * use the same tools, so an answer's numbers come from queries either way.
 */

/** A tool's input was understood but names nothing in the data. */
export class QueryError extends Error {}

/** The longest range a tool reads, in days. */
const MAX_DAYS = 400

const day = z.iso.date()

export const RangeArgs = {
  from: day.optional().describe('First day, YYYY-MM-DD, in the site time zone.'),
  to: day.optional().describe('Last day, YYYY-MM-DD. Today is allowed and counts so far.'),
  filters: z
    .object(Object.fromEntries(FILTER_KEYS.map((k) => [k, z.string().optional()])))
    .partial()
    .optional()
    .describe(
      'Narrows to the visits matching every filter: channel, referrer, campaign, entry, country (ISO code), device, browser, os by their first-touch value; page keeps visits that viewed the path; goal keeps visits that sent the event; prop is "key=value" on any event.',
    ),
}

interface RangeInput {
  from?: string
  to?: string
  filters?: Filters
}

export interface QueryContext {
  site: Site
  goals: GoalDefinition[]
  /** Used when a call names no range. */
  range: DateRange
}

function scopeOf(ctx: QueryContext, input: RangeInput): Scope {
  const range = { from: input.from ?? ctx.range.from, to: input.to ?? ctx.range.to }
  if (range.from > range.to) throw new QueryError('from must not be after to')
  if (days(range) > MAX_DAYS) throw new QueryError(`at most ${MAX_DAYS} days at a time`)
  const filters = Object.fromEntries(
    Object.entries(input.filters ?? {}).filter(([, v]) => typeof v === 'string' && v),
  ) as Filters
  return { site: ctx.site, range, filters, goals: ctx.goals }
}

/** What every answer starts with: the range, the one compared with, and the filters. */
function header(scope: Scope) {
  const before = previousRange(scope.range)
  const filters = Object.entries(scope.filters)
  return [
    `Range: ${shortDay(scope.range.from)} to ${shortDay(scope.range.to)} (${days(scope.range)} days); "before" is ${shortDay(before.from)} to ${shortDay(before.to)}.`,
    filters.length
      ? `Filters: ${filters.map(([k, v]) => `${k} = ${v}`).join(', ')}.`
      : 'No filters: the whole site.',
  ].join('\n')
}

const lines = (scope: Scope, body: string[]) => `${header(scope)}\n\n${body.join('\n')}`

const DIMENSION_LABELS: Record<(typeof DIMENSIONS)[number], string> = {
  channel: 'Channel',
  referrer: 'Referrer',
  campaign: 'Campaign',
  entry: 'Entry page',
  country: 'Country',
  device: 'Device',
  browser: 'Browser',
  os: 'OS',
  page: 'Page',
}

export interface QueryTool {
  name: string
  title: string
  description: string
  input: z.ZodRawShape
  run: (ctx: QueryContext, input: never) => Promise<string>
}

const tool = <S extends z.ZodRawShape>(t: {
  name: string
  title: string
  description: string
  input: S
  run: (ctx: QueryContext, input: z.infer<z.ZodObject<S>>) => Promise<string>
}): QueryTool => t as QueryTool

export const QUERY_TOOLS: QueryTool[] = [
  tool({
    name: 'get_traffic',
    title: 'Get traffic',
    description:
      'Visitors, pageviews, bounce rate, visit length and revenue for a range against the range before, visitors today against a usual day, and visitors per day (per hour for one day, per month past a quarter).',
    input: RangeArgs,
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const { range, site } = scope
      const before = previousRange(range)
      const interval = intervalOf(range)
      const s = sessions(scope)
      const today = new Date().toLocaleDateString('en-CA', { timeZone: site.timezone })
      const [totals, previous, revenue, previousRevenue, usual, todays, series] = await Promise.all(
        [
          totalsOf(scope, range),
          totalsOf(scope, before),
          revenueOf(scope, range),
          revenueOf(scope, before),
          usualVisitors(scope),
          isOpen(range, site.timezone)
            ? totalsOf(scope, { from: today, to: today }).then((t) => Number(t.visitors))
            : null,
          rows<{ t: string; visitors: number }>(
            `SELECT ${bucketSql(interval, 'started')} AS t, uniqExact(visitor_id) AS visitors
             FROM (${s.sql}) GROUP BY t`,
            s.params,
          ),
        ],
      )
      const num = <T extends object>(o: T) =>
        Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)])) as T
      const facts = trafficFacts({
        currency: site.currency,
        traffic: {
          totals: { ...num(totals), ...num(revenue) },
          previous: { ...num(previous), ...num(previousRevenue) },
          usual,
          today: todays,
        },
      })
      const byBucket = new Map(series.map((r) => [r.t, Number(r.visitors)]))
      const label = (t: string) =>
        interval === 'hour' ? t.slice(11, 16) : interval === 'month' ? t.slice(0, 7) : shortDay(t)
      const per = bucketsOf(range, site.timezone)
        .map((t) => `${label(t)} ${count(byBucket.get(t) ?? 0)}`)
        .join(', ')
      return lines(scope, [...facts.map((f) => f.text), `Visitors per ${interval}: ${per}`])
    },
  }),

  tool({
    name: 'get_breakdown',
    title: 'Get a breakdown',
    description:
      'Top values of one dimension by visitors, each with its visitors in the range before and, for everything but pages, the revenue attributed to it. Use it to find where a change came from.',
    input: {
      ...RangeArgs,
      dimension: z.enum(DIMENSIONS).describe('What to break visitors down by.'),
      limit: z.number().int().min(1).max(25).default(10).describe('How many values.'),
    },
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const now = await breakdownOf(scope, input.dimension, input.limit)
      const before = new Map(
        (
          await breakdownOf(
            scope,
            input.dimension,
            input.limit,
            previousRange(scope.range),
            now.map((r) => r.value),
          )
        ).map((r) => [r.value, r.visitors]),
      )
      if (!now.length) return lines(scope, [`No ${input.dimension} values in this range.`])
      return lines(scope, [
        `${DIMENSION_LABELS[input.dimension]}, top ${now.length} by visitors:`,
        ...now.map(
          (r) =>
            `- ${r.value}: ${count(r.visitors)} visitors, before ${count(before.get(r.value) ?? 0)}${r.revenue ? `; revenue ${money(r.revenue, scope.site.currency)}` : ''}`,
        ),
      ])
    },
  }),

  tool({
    name: 'get_events',
    title: 'Get custom events',
    description:
      'Every custom event and defined goal with the visitors who sent or reached it and how many times, in the range and the range before.',
    input: RangeArgs,
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const [now, before] = await Promise.all([
        goalsOf(scope, scope.range),
        goalsOf(scope, previousRange(scope.range)),
      ])
      const previous = new Map(before.map((g) => [g.name, g.visitors]))
      if (!now.length) return lines(scope, ['No custom events or goals in this range.'])
      return lines(scope, [
        'Custom events and goals, by visitors:',
        ...now.map(
          (g) =>
            `- ${g.name}${g.kind === 'event' ? '' : ` (goal: ${g.kind})`}: ${count(g.visitors)} visitors, ${count(Number(g.events))} times; before ${count(previous.get(g.name) ?? 0)} visitors`,
        ),
      ])
    },
  }),

  tool({
    name: 'get_event_properties',
    title: 'Get event properties',
    description:
      'The properties one custom event carried, or with a key, that property’s values with the visitors and events carrying each.',
    input: {
      ...RangeArgs,
      event: z.string().min(1).max(120).describe('The event name, exactly as sent.'),
      key: z.string().max(120).optional().describe('One property to list the values of.'),
    },
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      if (!input.key) {
        const p = await propertiesOf(scope, input.event)
        if (!p.events) throw new QueryError(`no ${input.event} events in this range`)
        return lines(scope, [
          `${input.event}: ${count(Number(p.events))} events in range.`,
          p.properties.length
            ? `Properties: ${p.properties.map((k) => `${k.key} on ${count(Number(k.events))} events from ${count(Number(k.visitors))} visitors`).join(', ')}`
            : 'It carried no properties.',
        ])
      }
      const p = await propertyOf(scope, input.event, input.key, 20)
      if (!p.values.length)
        throw new QueryError(`no ${input.event} events with ${input.key} in this range`)
      return lines(scope, [
        `${input.event} by ${input.key}:`,
        ...p.values.map(
          (v) =>
            `- "${v.value.slice(0, 120)}": ${count(Number(v.visitors))} visitors, ${count(Number(v.events))} events`,
        ),
      ])
    },
  }),

  tool({
    name: 'get_paths',
    title: 'Get paths',
    description:
      "The site's paths (funnels counted per visitor across the range): visitors at each step now and before, the failures and give-ups along the way, and the events that went quiet. Without paths, the custom events.",
    input: { from: RangeArgs.from, to: RangeArgs.to, filters: RangeArgs.filters },
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const paths = await pathsFor(scope)
      const facts = [...pathFacts({ paths }), ...quietFacts({ paths })]
      return lines(scope, facts.length ? facts.map((f) => f.text) : ['No paths or custom events.'])
    },
  }),

  tool({
    name: 'get_path_detail',
    title: 'Get one path in detail',
    description:
      'One path from get_paths in detail: each step now and before, split by device, channel and browser, the property values its failures carried, and at the step most people did not get past, the events they sent and the last page they viewed.',
    input: {
      ...RangeArgs,
      path: z.string().min(1).describe('The path name, as get_paths writes it.'),
    },
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const facts = await laneFactsOf(scope, input.path).catch((e) => {
        throw e instanceof WhyMissing ? new QueryError(e.message) : e
      })
      return lines(
        scope,
        facts.map((f) => f.text),
      )
    },
  }),

  tool({
    name: 'get_tried_to_pay',
    title: 'Get who tried to pay',
    description:
      'Visitors who activated, tried to pay and paid, now and before, and the latest people who tried, each with their visitor id, where they came from, their events in order and how it ended.',
    input: RangeArgs,
    async run(ctx, input) {
      const scope = scopeOf(ctx, input)
      const intent = await intentOf(scope)
      const ids = new Map(intent.people.map((p, i) => [`v${i + 1}`, p.visitor]))
      return lines(
        scope,
        triedFacts({ intent }).map((f) =>
          ids.has(f.id) ? `${f.text}; visitor id ${ids.get(f.id)}` : f.text,
        ),
      )
    },
  }),

  tool({
    name: 'get_visitor',
    title: 'Get one visitor',
    description:
      'One visitor by id (from get_tried_to_pay): who they are, how it ended, every event of their latest visits in order with properties, click text and time since the visit started, and how common their failures are across the site. Reads all their events whatever the filters.',
    input: {
      from: RangeArgs.from,
      to: RangeArgs.to,
      visitor: z
        .string()
        .regex(/^\d{1,20}$/)
        .describe('The visitor id.'),
    },
    async run(ctx, input) {
      const scope = scopeOf(ctx, { from: input.from, to: input.to })
      const facts = await visitorFactsOf(scope, input.visitor).catch((e) => {
        throw e instanceof WhyMissing ? new QueryError(e.message) : e
      })
      return lines(
        scope,
        facts.map((f) => f.text),
      )
    },
  }),
]

export const toolNamed = (name: string) => QUERY_TOOLS.find((t) => t.name === name)

/** Runs a tool on input it has not checked yet; a bad input is an error the caller can fix. */
export async function runTool(ctx: QueryContext, name: string, input: unknown) {
  const t = toolNamed(name)
  if (!t) throw new QueryError(`no tool ${name}`)
  const parsed = z.object(t.input).safeParse(input ?? {})
  if (!parsed.success) throw new QueryError(z.prettifyError(parsed.error))
  return t.run(ctx, parsed.data as never)
}

/** The tools as the Messages API takes them. */
export const toolSpecs = () =>
  QUERY_TOOLS.map((t) => {
    const { $schema: _, ...schema } = z.toJSONSchema(z.object(t.input), { io: 'input' })
    return { name: t.name, description: t.description, input_schema: schema }
  })
