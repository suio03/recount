import { z } from 'zod'
import type { DateRange } from '../stats/range'
import { days } from '../stats/range'
import type { Finding } from './changes'
import { describe, shortDay, unsupportedNumbers } from './format'

export interface Claim {
  text: string
  /** Ids of the findings that back the claim. */
  evidence: string[]
}

export interface Reading {
  headline: string
  claims: Claim[]
  model: string
  generatedAt: string
}

/** Structure only: structured outputs reject length and count limits, so those are applied below. */
export const Output = z.object({
  headline: z.string(),
  claims: z.array(z.object({ text: z.string(), evidence: z.array(z.string()) })),
})
const MAX_CLAIMS = 6

/**
 * The model's claims that hold up: each cites known findings and quotes only numbers they contain.
 * Shared with the answers to built-in questions, which cite findings the same way.
 */
export function vetted(
  output: z.infer<typeof Output>,
  findings: Finding[],
  range: DateRange,
  model: string,
): Reading {
  const byId = new Map(findings.map((f) => [f.id, f]))
  const rangeText = `${days(range)} days ${shortDay(range.from)} ${shortDay(range.to)}`
  const claims = output.claims.slice(0, MAX_CLAIMS).flatMap((claim) => {
    const evidence = claim.evidence.filter((id) => byId.has(id))
    if (!claim.text.trim() || evidence.length === 0) return []
    const allowed = [rangeText, ...evidence.map((id) => describe(byId.get(id) as Finding))]
    const unsupported = unsupportedNumbers(claim.text, allowed)
    if (unsupported.length) {
      console.warn(`reading: dropped claim quoting ${unsupported.join(', ')}: ${claim.text}`)
      return []
    }
    return [{ text: claim.text, evidence }]
  })
  // A headline with an unsupported number falls back to the first claim.
  const headline = unsupportedNumbers(output.headline, [rangeText, ...findings.map(describe)])
    .length
    ? (claims[0]?.text ?? '')
    : output.headline

  return { headline, claims, model, generatedAt: new Date().toISOString() }
}
