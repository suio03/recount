import { eq } from 'drizzle-orm'
import { db } from '../db/postgres'
import { funnels } from '../db/schema'
import { draftView } from '../semantics/store'
import { eventNamesOf, keyEventsOf } from './intent'
import { eventListOf, type LaneDefinition, lanesOf, MAX_LANES, sideNames } from './paths'
import type { Scope } from './queries'
import { quietEvents } from './quiet'

/**
 * The paths section: lanes from the site's funnels and then its drafted ones still waiting for
 * review, the custom events when there are none, and the events that went quiet.
 */
export async function pathsFor(scope: Scope) {
  const site = scope.site
  const [defined, draft, names] = await Promise.all([
    db
      .select({ id: funnels.id, name: funnels.name, steps: funnels.steps })
      .from(funnels)
      .where(eq(funnels.siteId, site.id))
      .orderBy(funnels.createdAt)
      .limit(MAX_LANES),
    draftView(site),
    eventNamesOf(site),
  ])
  const definitions: LaneDefinition[] = [
    ...defined.map((f) => ({ ...f, source: 'funnel' as const })),
    ...(draft?.draft?.funnels ?? [])
      .filter((f) => f.status === 'new')
      .map((f) => ({ name: f.name, steps: f.steps, source: 'draft' as const })),
  ].slice(0, MAX_LANES)
  const { events } = await keyEventsOf(site, names)
  const [lanes, list, quiet] = await Promise.all([
    lanesOf(scope, definitions, sideNames(events, names)),
    definitions.length ? null : eventListOf(scope),
    quietEvents(site, scope.range),
  ])
  return { lanes, events: list, ai: site.ai, quiet }
}

export type PathsResult = Awaited<ReturnType<typeof pathsFor>>
