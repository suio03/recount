import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { atLeast } from '../auth'
import { env } from '../env'
import { applyItem, DraftError, dismiss, draftView, isDrafting, runDraft } from '../semantics/store'
import type { SiteEnv } from './admin'

/**
 * The site's semantics as the model last drafted them. Members read the draft; admins ask for a
 * new one and add or turn down what it proposes.
 */
export const semanticsRoutes = new Hono<SiteEnv>()

semanticsRoutes.use(
  bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: 'too large' }, 413) }),
)
semanticsRoutes.use('/*', async (c, next) => {
  if (c.req.method !== 'GET' && !atLeast(c.get('role'), 'admin'))
    return c.json({ error: 'not allowed' }, 403)
  await next()
})

semanticsRoutes.get('/', async (c) => {
  const site = c.get('site')
  return c.json({
    drafting: isDrafting(site.id),
    configured: Boolean(env.ANTHROPIC_API_KEY),
    latest: await draftView(site),
  })
})

/** Drafts now and answers when the draft is stored, which takes up to a minute or two. */
semanticsRoutes.post('/draft', async (c) => {
  const site = c.get('site')
  if (!site.ai) return c.json({ error: 'Turn on AI for this site first' }, 400)
  if (!env.ANTHROPIC_API_KEY) return c.json({ error: 'ANTHROPIC_API_KEY is not set' }, 400)
  await runDraft(site)
  return c.json({ drafting: false, configured: true, latest: await draftView(site) })
})

const Item = z.object({ kind: z.enum(['goal', 'funnel']), name: z.string().trim().min(1).max(120) })

/** Adds a drafted goal or funnel, even one turned down before. */
semanticsRoutes.post('/apply', async (c) => {
  const parsed = Item.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const site = c.get('site')
  try {
    await applyItem(site, parsed.data.kind, parsed.data.name)
  } catch (e) {
    if (e instanceof DraftError) return c.json({ error: e.message }, 409)
    throw e
  }
  return c.json({ drafting: isDrafting(site.id), configured: true, latest: await draftView(site) })
})

/** Turns down a drafted goal or funnel, so later drafts do not add it on their own. */
semanticsRoutes.post('/dismiss', async (c) => {
  const parsed = Item.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const site = c.get('site')
  await dismiss(site.id, parsed.data.kind, parsed.data.name)
  return c.json({ drafting: isDrafting(site.id), configured: true, latest: await draftView(site) })
})
