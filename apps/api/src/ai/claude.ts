import { z } from 'zod'
import type { AiKind, Site } from '../db/schema'
import { env } from '../env'
import { recordUsage, withinBudget } from './usage'

/**
 * No call can be made now: the API refused the key (invalid, expired or revoked), the account
 * cannot pay for calls, or the org has spent today's AI budget.
 */
export class AiUnavailable extends Error {
  constructor(
    readonly kind: 'key_rejected' | 'no_credit' | 'over_budget',
    message: string,
  ) {
    super(message)
  }
}

/**
 * One message to Claude whose answer must match `schema`, using structured outputs. The schema
 * carries structure only: structured outputs reject length and count limits, so callers apply
 * those after parsing. The call is billed to the site's org and refused once its daily budget
 * is spent.
 */
export async function structured<T>({
  site,
  kind,
  model,
  system,
  user,
  schema,
  maxTokens = 2000,
}: {
  site: Site
  kind: AiKind
  model: string
  system: string
  user: string
  schema: z.ZodType<T>
  maxTokens?: number
}): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!(await withinBudget(site.orgId)))
    throw new AiUnavailable('over_budget', "Today's AI budget is spent")
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: jsonSchema } },
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const text = await res.text()
    const message = `Anthropic API ${res.status}: ${text}`
    if (res.status === 401 || res.status === 403) throw new AiUnavailable('key_rejected', message)
    if (/credit balance/i.test(text)) throw new AiUnavailable('no_credit', message)
    throw new Error(message)
  }
  const body = (await res.json()) as {
    content: Array<{ type: string; text?: string }>
    usage: { input_tokens: number; output_tokens: number }
  }
  await recordUsage(site, kind, model, body.usage.input_tokens, body.usage.output_tokens)
  return schema.parse(JSON.parse(body.content.find((b) => b.type === 'text')?.text ?? ''))
}
