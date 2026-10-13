import { z } from 'zod'
import { env } from '../env'

/** The API refused the key (invalid, expired or revoked) or the account cannot pay for calls. */
export class KeyProblem extends Error {
  constructor(
    readonly kind: 'key_rejected' | 'no_credit',
    message: string,
  ) {
    super(message)
  }
}

/**
 * One message to Claude whose answer must match `schema`, using structured outputs. The schema
 * carries structure only: structured outputs reject length and count limits, so callers apply
 * those after parsing.
 */
export async function structured<T>({
  model,
  system,
  user,
  schema,
  maxTokens = 2000,
}: {
  model: string
  system: string
  user: string
  schema: z.ZodType<T>
  maxTokens?: number
}): Promise<T> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
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
    if (res.status === 401 || res.status === 403) throw new KeyProblem('key_rejected', message)
    if (/credit balance/i.test(text)) throw new KeyProblem('no_credit', message)
    throw new Error(message)
  }
  const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  return schema.parse(JSON.parse(body.content.find((b) => b.type === 'text')?.text ?? ''))
}
