import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { agentsSnippet, originOf } from '../agents/rules'
import { atLeast } from '../auth'
import { db } from '../db/postgres'
import { eventDefinitions } from '../db/schema'
import { definitionsOf } from '../semantics/definitions'
import type { SiteEnv } from './admin'

/**
 * What a site's settings show for coding agents: where the rules and the MCP server are, the lines
 * for the project's AGENTS.md, and the events defined so far, which admins can remove.
 */
export const agentRoutes = new Hono<SiteEnv>()

agentRoutes.get('/', async (c) => {
  const site = c.get('site')
  const origin = originOf(c)
  const definitions = await definitionsOf(site.id)
  return c.json({
    rules: `${origin}/llms.txt`,
    mcp: `${origin}/mcp`,
    snippet: agentsSnippet(origin, site.domain),
    events: definitions.map(({ siteId: _, ...d }) => d),
  })
})

agentRoutes.delete('/events/:name', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return c.json({ error: 'not allowed' }, 403)
  const [removed] = await db
    .delete(eventDefinitions)
    .where(
      and(
        eq(eventDefinitions.siteId, c.get('site').id),
        eq(eventDefinitions.name, c.req.param('name')),
      ),
    )
    .returning({ name: eventDefinitions.name })
  if (!removed) return c.json({ error: 'not found' }, 404)
  return c.json({ ok: true })
})
