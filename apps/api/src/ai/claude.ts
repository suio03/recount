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

/** Sends one request to the Messages API, billed to the site's org, refused over its budget. */
async function call(site: Site, kind: AiKind, model: string, body: Record<string, unknown>) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
  if (!(await withinBudget(site.orgId)))
    throw new AiUnavailable('over_budget', "Today's AI budget is spent")
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, ...body }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) {
    const text = await res.text()
    const message = `Anthropic API ${res.status}: ${text}`
    if (res.status === 401 || res.status === 403) throw new AiUnavailable('key_rejected', message)
    if (/credit balance/i.test(text)) throw new AiUnavailable('no_credit', message)
    throw new Error(message)
  }
  const reply = (await res.json()) as {
    content: ContentBlock[]
    stop_reason: string
    usage: { input_tokens: number; output_tokens: number }
  }
  await recordUsage(site, kind, model, reply.usage.input_tokens, reply.usage.output_tokens)
  return reply
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
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema)
  const reply = await call(site, kind, model, {
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema: jsonSchema } },
  })
  const text = reply.content.find((b) => b.type === 'text')
  return schema.parse(JSON.parse(text?.type === 'text' ? text.text : ''))
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface Message {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface ToolSpec {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/**
 * One turn of a conversation in which Claude may call `tools`, or answer in text matching
 * `schema` (structure only, as for `structured`). `none` keeps it from calling any tool, so it
 * must answer. Billed and budgeted as `structured` is.
 */
export function converse({
  site,
  kind,
  model,
  system,
  messages,
  tools,
  schema,
  choice = 'auto',
  maxTokens = 2000,
}: {
  site: Site
  kind: AiKind
  model: string
  system: string
  messages: Message[]
  tools: ToolSpec[]
  schema: z.ZodType
  choice?: 'auto' | 'none'
  maxTokens?: number
}) {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema)
  return call(site, kind, model, {
    max_tokens: maxTokens,
    system,
    messages,
    tools,
    tool_choice: { type: choice },
    output_config: { format: { type: 'json_schema', schema: jsonSchema } },
  })
}
