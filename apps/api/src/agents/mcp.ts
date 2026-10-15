import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type KeyPrincipal, keyFrom } from '../auth'
import { db } from '../db/postgres'
import { goals, type Site, sites } from '../db/schema'
import { answerFor, QUESTIONS, type Question } from '../questions'
import { describe } from '../reading/format'
import {
  DefinitionError,
  defineEvent,
  EventDefinitionInput,
  ownerSemantics,
} from '../semantics/definitions'
import { describeSignal } from '../semantics/signals'
import { last30Days, latestDraft } from '../semantics/store'
import { rows } from '../stats/queries'
import { gapEvent } from './gaps'
import { agentsSnippet, originOf, scriptTag, siteSection, trackingRules } from './rules'

/**
 * Recount's MCP server, for coding agents that add tracking to a site: they read the rules and
 * the gaps the data shows, check that an event they added arrives, and record what it means.
 * Stateless Streamable HTTP: every request carries an API key scoped to agents (or an admin key)
 * and gets a server of its own, so nothing is kept between requests. An agent key reads data
 * and writes event definitions, nothing else.
 */
export const mcpRoutes = new Hono()

const SERVER = { name: 'recount', version: '1.0.0' }

class ToolError extends Error {}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] })
const json = (value: unknown) => text(JSON.stringify(value, null, 2))

const orgSites = (orgId: string) =>
  db.select().from(sites).where(eq(sites.orgId, orgId)).orderBy(asc(sites.domain))

/** The site a tool names by domain, or the team's only site when it names none. */
async function siteFor(key: KeyPrincipal, domain: string | undefined): Promise<Site> {
  const all = await orgSites(key.orgId)
  if (!domain) {
    if (all.length === 1 && all[0]) return all[0]
    throw new ToolError(
      all.length
        ? `Name the site: one of ${all.map((s) => s.domain).join(', ')}`
        : 'This team has no sites yet; add one in Recount first',
    )
  }
  const wanted = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  const site = all.find((s) => s.domain === wanted || s.domain === wanted.replace(/^www\./, ''))
  if (!site)
    throw new ToolError(
      `No site ${domain}; this key can see ${all.map((s) => s.domain).join(', ') || 'none'}`,
    )
  return site
}

const SiteArg = z
  .string()
  .optional()
  .describe("The site's domain as added in Recount, such as example.com. Optional with one site.")

/** Events by name over the last `hours`, with visitors and when each was last seen. */
function eventCounts(site: Site, names: string[], hours: number) {
  if (!names.length) return Promise.resolve([])
  return rows<{ name: string; events: number; visitors: number; last: string }>(
    `SELECT name, count() AS events, uniqExact(visitor_id) AS visitors,
            toString(max(timestamp)) AS last
     FROM events
     WHERE site_id = {site:UUID} AND name IN {names:Array(String)}
       AND timestamp >= now() - toIntervalHour({hours:UInt32})
     GROUP BY name`,
    { site: site.id, names, hours },
  )
}

/** ClickHouse DateTime64 text in UTC, as ISO 8601. */
const iso = (t: string) => `${t.replace(' ', 'T')}Z`

function server(key: KeyPrincipal, origin: string) {
  const mcp = new McpServer(SERVER, {
    instructions: `Recount is web analytics. Use these tools to add tracking to a site the right way: read get_tracking_rules first, take work from list_tracking_gaps, check each event you add with verify_event once it has been triggered, then record what it means with define_event. The full rules are also at ${origin}/llms.txt.`,
  })

  /** Runs a tool, answering its known failures as tool errors the agent can act on. */
  const run =
    <A>(fn: (args: A) => Promise<ReturnType<typeof text>>) =>
    async (args: A) => {
      try {
        return await fn(args)
      } catch (e) {
        if (e instanceof ToolError || e instanceof DefinitionError)
          return { ...text(e.message), isError: true }
        throw e
      }
    }

  mcp.registerTool(
    'list_sites',
    {
      title: 'List sites',
      description: 'The sites this key can see, with their domains and time zones.',
      annotations: { readOnlyHint: true },
    },
    run(async () => {
      const all = await orgSites(key.orgId)
      return json(all.map((s) => ({ domain: s.domain, name: s.name, timezone: s.timezone })))
    }),
  )

  mcp.registerTool(
    'get_install',
    {
      title: 'Get install instructions',
      description:
        "How to install Recount on a site: the script tag, whether it is receiving pageviews, the lines for the project's AGENTS.md, and the endpoint for server-side events.",
      inputSchema: { site: SiteArg },
      annotations: { readOnlyHint: true },
    },
    run(async ({ site: domain }: { site?: string }) => {
      const site = await siteFor(key, domain)
      const [pageviews] = await eventCounts(site, ['pageview'], 24 * 7)
      return json({
        domain: site.domain,
        scriptTag: scriptTag(origin, site.domain),
        where: 'Once in the <head> of every page.',
        receiving: pageviews
          ? { pageviewsLast7Days: Number(pageviews.events), lastSeen: iso(pageviews.last) }
          : 'No pageviews in the last 7 days. The script ignores localhost unless its tag has data-allow-localhost.',
        agentsMd: agentsSnippet(origin, site.domain),
        serverEvents: {
          endpoint: `${origin}/api/server/events`,
          key: 'An API key scoped to ingestion, created by a team admin in Recount under Settings > API keys. Ask the person for it; keep it in the server environment.',
        },
        rules: `${origin}/llms.txt`,
      })
    }),
  )

  mcp.registerTool(
    'get_tracking_rules',
    {
      title: 'Get tracking rules',
      description:
        'The rules for adding tracking: what is recorded already, when code is needed, naming, personal data, and how to check. With a site, also the custom events it defines, whose names you should reuse.',
      inputSchema: { site: SiteArg },
      annotations: { readOnlyHint: true },
    },
    run(async ({ site: domain }: { site?: string }) => {
      const rules = trackingRules(origin)
      const all = await orgSites(key.orgId)
      if (!domain && all.length !== 1) return text(rules)
      const site = await siteFor(key, domain)
      return text(`${rules}\n${siteSection(site.domain, await ownerSemantics(site))}\n`)
    }),
  )

  mcp.registerTool(
    'list_tracking_gaps',
    {
      title: 'List tracking gaps',
      description:
        "What the site's data shows is not tracked, from Recount's latest draft: each gap with why, the line of code to add, the blind spot in the data it rests on (or that it is a guess), and whether its event is defined and arriving already.",
      inputSchema: { site: SiteArg },
      annotations: { readOnlyHint: true },
    },
    run(async ({ site: domain }: { site?: string }) => {
      const site = await siteFor(key, domain)
      const draft = (await latestDraft(site.id))?.body
      if (!draft)
        return text(
          'No draft yet. A team admin can draft one in Recount (site settings, Semantics, Draft now) once the site has some traffic; until then, follow get_tracking_rules.',
        )
      const owner = await ownerSemantics(site)
      const defined = new Set(owner?.events.map((e) => e.name))
      const events = draft.gaps.flatMap((g) => gapEvent(g.code) ?? [])
      const seen = new Map(
        (await eventCounts(site, [...new Set(events)], 24 * 30)).map((r) => [r.name, r]),
      )
      // Without the signal's id, which means nothing outside the draft.
      const signals = new Map(
        draft.signals.map((s) => [s.id, describeSignal(s).replace(/^S\d+ /, '')]),
      )
      return json({
        draftedAt: draft.generatedAt,
        gaps: draft.gaps.map((g) => {
          const event = gapEvent(g.code)
          const arrived = event ? seen.get(event) : undefined
          return {
            title: g.title,
            why: g.why,
            code: g.code,
            evidence: g.signal
              ? signals.get(g.signal)
              : 'None: a guess at what a site like this should track.',
            event,
            status: !event
              ? 'no event named'
              : arrived
                ? defined.has(event)
                  ? 'done'
                  : 'arriving, not defined: call define_event'
                : defined.has(event)
                  ? 'defined, not seen in 30 days'
                  : 'to do',
            ...(arrived && {
              last30Days: { events: Number(arrived.events), visitors: Number(arrived.visitors) },
            }),
          }
        }),
      })
    }),
  )

  mcp.registerTool(
    'verify_event',
    {
      title: 'Verify an event',
      description:
        'Whether an event has arrived recently: how many, from how many visitors, when last, the properties it carried with recent examples, and how they compare with its definition. Trigger the event first.',
      inputSchema: {
        site: SiteArg,
        name: z.string().min(1).max(120).describe('The event name, exactly as sent.'),
        hours: z.number().int().min(1).max(168).default(24).describe('How far back to look.'),
      },
      annotations: { readOnlyHint: true },
    },
    run(async ({ site: domain, name, hours }: { site?: string; name: string; hours: number }) => {
      const site = await siteFor(key, domain)
      const params = { site: site.id, name, hours }
      const where = `site_id = {site:UUID} AND name = {name:String}
        AND timestamp >= now() - toIntervalHour({hours:UInt32})`
      const [[count], keys, samples, owner] = await Promise.all([
        eventCounts(site, [name], hours),
        rows<{ key: string; events: number }>(
          `SELECT key, count() AS events FROM events ARRAY JOIN mapKeys(props) AS key
           WHERE ${where} GROUP BY key ORDER BY events DESC, key LIMIT 50`,
          params,
        ),
        rows<{ at: string; pathname: string; props: Record<string, string> }>(
          `SELECT toString(timestamp) AS at, pathname, props FROM events
           WHERE ${where} ORDER BY timestamp DESC LIMIT 5`,
          params,
        ),
        ownerSemantics(site),
      ])
      const definition = owner?.events.find((e) => e.name === name)
      if (!count) {
        const recent = await rows<{ name: string }>(
          `SELECT name FROM events
           WHERE site_id = {site:UUID} AND name NOT IN ('pageview', 'click')
             AND timestamp >= now() - toIntervalHour({hours:UInt32})
           GROUP BY name ORDER BY max(timestamp) DESC LIMIT 10`,
          params,
        )
        return json({
          arrived: false,
          event: name,
          hours,
          defined: Boolean(definition),
          otherCustomEventsSeen: recent.map((r) => r.name),
          check: [
            'Names are case sensitive.',
            'The script ignores localhost unless its tag has data-allow-localhost, and automated browsers.',
            'A browser event drops properties that look personal; a server-side event with them is refused with 422.',
          ],
        })
      }
      const carried = new Set(keys.map((k) => k.key))
      const declared = Object.keys(definition?.properties ?? {})
      return json({
        arrived: true,
        event: name,
        hours,
        events: Number(count.events),
        visitors: Number(count.visitors),
        lastSeen: iso(count.last),
        properties: keys.map((k) => ({ key: k.key, events: Number(k.events) })),
        recent: samples.map((s) => ({ at: iso(s.at), page: s.pathname || null, props: s.props })),
        definition: definition
          ? {
              description: definition.description,
              missingProperties: declared.filter((k) => !carried.has(k)),
              undeclaredProperties: [...carried].filter((k) => !declared.includes(k)),
            }
          : 'Not defined yet: call define_event with what it means.',
      })
    }),
  )

  mcp.registerTool(
    'define_event',
    {
      title: 'Define an event',
      description:
        "Records what a custom event means and the properties it carries, so Recount's reports, drafts and answers use it. Call it once the event arrives (verify_event). Defining an existing name rewrites its definition.",
      inputSchema: {
        site: SiteArg,
        name: z.string().describe('The event name, exactly as sent, such as "Signup Completed".'),
        description: z
          .string()
          .describe('What happened, in one sentence a site owner understands.'),
        stage: z
          .enum(['acquisition', 'activation', 'conversion', 'retention', 'referral'])
          .optional()
          .describe('Where it sits in the visitor lifecycle.'),
        key: z
          .boolean()
          .optional()
          .describe(
            'Whether it is an outcome the business lives on, such as a signup or a purchase.',
          ),
        properties: z
          .record(
            z.string(),
            z.object({ type: z.enum(['string', 'number', 'boolean']), description: z.string() }),
          )
          .optional()
          .describe('Each property key the event carries, with its type and meaning.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    run(async ({ site: domain, ...input }: { site?: string } & Record<string, unknown>) => {
      const site = await siteFor(key, domain)
      const parsed = EventDefinitionInput.safeParse(input)
      if (!parsed.success) throw new ToolError(z.prettifyError(parsed.error))
      const { definition, created } = await defineEvent(site, parsed.data, `key:${key.name}`)
      return json({ created, definition: { ...definition, siteId: undefined } })
    }),
  )

  mcp.registerTool(
    'answer_question',
    {
      title: 'Answer a question',
      description: `Answers a built-in question about a site from fixed queries: ${Object.entries(
        QUESTIONS,
      )
        .map(([k, q]) => `"${k}" (${q})`)
        .join(
          ', ',
        )}. Returns the definition it counts by, the figures, and a written answer when the site has AI on.`,
      inputSchema: {
        site: SiteArg,
        question: z.enum(Object.keys(QUESTIONS) as [Question, ...Question[]]),
        from: z.iso.date().optional().describe('First day, YYYY-MM-DD. Defaults to 30 days ago.'),
        to: z.iso.date().optional().describe('Last day, YYYY-MM-DD. Defaults to today.'),
      },
      annotations: { readOnlyHint: true },
    },
    run(
      async ({
        site: domain,
        question,
        from,
        to,
      }: {
        site?: string
        question: Question
        from?: string
        to?: string
      }) => {
        const site = await siteFor(key, domain)
        const fallback = last30Days(site.timezone)
        const range = { from: from ?? fallback.from, to: to ?? fallback.to }
        if (range.from > range.to) throw new ToolError('from must not be after to')
        const defined = await db
          .select({ name: goals.name, match: goals.match })
          .from(goals)
          .where(eq(goals.siteId, site.id))
        const answer = await answerFor(question, { site, range, filters: {}, goals: defined })
        return json({
          question: answer.title,
          range,
          definition: answer.definition,
          answer: answer.answer && {
            headline: answer.answer.headline,
            claims: answer.answer.claims.map((c) => c.text),
          },
          figures: answer.findings.map(describe),
        })
      },
    ),
  )

  return mcp
}

mcpRoutes.post('/mcp', async (c) => {
  const key = await keyFrom(c, ['agent', 'admin'])
  if (key === 'missing' || key === 'wrong')
    return c.json({ error: 'unauthorized: send Authorization: Bearer <API key>' }, 401)
  if (key === 'scope') return c.json({ error: 'use an agent or admin key' }, 403)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const mcp = server(key, originOf(c))
  await mcp.connect(transport)
  return transport.handleRequest(c.req.raw)
})

// Stateless: there is no stream to open and no session to end.
mcpRoutes.on(['GET', 'DELETE'], '/mcp', (c) =>
  c.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null },
    405,
    {
      Allow: 'POST',
    },
  ),
)
