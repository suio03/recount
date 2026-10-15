import type { EventDefinition, SiteSemantics } from '@recount/semantic'
import { semanticsFor } from '@recount/sites'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/postgres'
import { type EventDefinitionRow, eventDefinitions, type Site } from '../db/schema'
import { personalName } from '../ingest/personal'
import { BUILT_IN_EVENTS } from '../stats/goals'

/**
 * What custom events mean, registered by whoever added them: a person, or a coding agent once
 * it has implemented a tracking gap and seen the event arrive. Read alongside the catalog in
 * `sites/`, which a person wrote in the repository and which wins where both name an event.
 */

/** Per site. */
export const MAX_DEFINITIONS = 200
const MAX_PROPERTIES = 30

export const EventDefinitionInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((n) => !BUILT_IN_EVENTS.includes(n), 'pageview and click are built in'),
  description: z.string().trim().min(1).max(500),
  stage: z.enum(['acquisition', 'activation', 'conversion', 'retention', 'referral']).optional(),
  key: z.boolean().default(false),
  properties: z
    .record(
      z.string().min(1).max(64),
      z.object({
        type: z.enum(['string', 'number', 'boolean']),
        description: z.string().trim().min(1).max(300),
      }),
    )
    .refine((p) => Object.keys(p).length <= MAX_PROPERTIES, `at most ${MAX_PROPERTIES} properties`)
    // On the record, not its keys: a failed key check only says "Invalid key in record".
    .superRefine((p, ctx) => {
      for (const k of Object.keys(p)) {
        const reason = personalName(k)
        if (reason)
          ctx.addIssue({
            code: 'custom',
            path: [k],
            message: `${reason}; personal data is never sent with events`,
          })
      }
    })
    .default({}),
})
export type EventDefinitionInput = z.infer<typeof EventDefinitionInput>

export const definitionsOf = (siteId: string) =>
  db
    .select()
    .from(eventDefinitions)
    .where(eq(eventDefinitions.siteId, siteId))
    .orderBy(asc(eventDefinitions.name))

export class DefinitionError extends Error {}

/** Registers what an event means, or rewrites its definition. */
export async function defineEvent(site: Site, input: EventDefinitionInput, definedBy: string) {
  const values = {
    description: input.description,
    stage: input.stage ?? null,
    key: input.key,
    properties: input.properties,
    definedBy,
    updatedAt: new Date(),
  }
  const all = await definitionsOf(site.id)
  const created = !all.some((d) => d.name === input.name)
  if (created && all.length >= MAX_DEFINITIONS)
    throw new DefinitionError(`A site can define up to ${MAX_DEFINITIONS} events`)
  const [definition] = await db
    .insert(eventDefinitions)
    .values({ siteId: site.id, name: input.name, ...values })
    .onConflictDoUpdate({ target: [eventDefinitions.siteId, eventDefinitions.name], set: values })
    .returning()
  return { definition: definition as EventDefinitionRow, created }
}

export const toEventDefinition = (row: EventDefinitionRow): EventDefinition => ({
  name: row.name,
  description: row.description,
  stage: row.stage ?? undefined,
  key: row.key || undefined,
  properties: Object.keys(row.properties).length ? row.properties : undefined,
})

/**
 * What people said about the site: the catalog in `sites/` with the events defined since, or
 * the defined events alone with no description when there is no catalog.
 */
export async function ownerSemantics(site: Site): Promise<SiteSemantics | undefined> {
  const written = semanticsFor(site.domain)
  const defined = (await definitionsOf(site.id)).map(toEventDefinition)
  if (!written)
    return defined.length
      ? { domain: site.domain, about: '', events: defined, metrics: [] }
      : undefined
  const named = new Set(written.events.map((e) => e.name))
  return { ...written, events: [...written.events, ...defined.filter((e) => !named.has(e.name))] }
}
