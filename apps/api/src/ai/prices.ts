/**
 * US dollars per million input and output tokens, at standard rates. A model missing here is
 * priced like Sonnet, so an unknown one is not counted as free.
 */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
}

/** What a call cost, in millionths of a dollar: dollars per million tokens is micros per token. */
export function costMicros(model: string, inputTokens: number, outputTokens: number) {
  const price = PRICES[model] ?? (PRICES['claude-sonnet-5-5'] as { input: number; output: number })
  return Math.round(inputTokens * price.input + outputTokens * price.output)
}
