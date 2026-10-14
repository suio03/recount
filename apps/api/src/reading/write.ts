import type { SiteSemantics } from '@recount/semantic'
import { z } from 'zod'
import { structured } from '../ai/claude'
import type { Site } from '../db/schema'
import { env } from '../env'
import type { DateRange } from '../stats/range'
import { days } from '../stats/range'
import type { Finding } from './changes'
import { describe, shortDay, unsupportedNumbers } from './format'

/** Bump when the prompt or output shape changes, so cached readings are rewritten. */
export const PROMPT_VERSION = 4

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
const Output = z.object({
  headline: z.string(),
  claims: z.array(z.object({ text: z.string(), evidence: z.array(z.string()) })),
})
const MAX_CLAIMS = 6

const SYSTEM = `You write "the reading" for a web analytics dashboard: a short explanation of what changed and the most likely why, for the site's owner.

Rules:
- Use only the findings you are given. Never compute, estimate or round a number yourself; copy figures exactly as written in the findings you cite.
- Each claim cites the ids of the findings it rests on. A claim that combines findings cites all of them.
- Lead with the change that matters most to the business, as described in the site context. Say plainly when a change is small, or when a segment moved but the total did not.
- Say a segment converts better or worse than other visitors only when a finding compares its conversion rate with all visitors. If a growing segment converts about as well as all visitors, a fall in the overall rate is not dilution by that segment: say the rate fell within the segment too, using its own before and now figures.
- Revenue findings are net of refunds. When revenue moved, say which segments' revenue moved with it, and whether visitors moved the same way; a segment that brought more visitors but not more revenue is worth saying so.
- Explanations of why are hypotheses: phrase them as "likely" or "suggests", and only when the findings support them (for example a single channel accounting for most of the change, or a shift starting on a specific day).
- 2 to 5 claims, each one or two sentences. Plain, specific English. No preamble, no advice section, no markdown.
- The headline is one sentence that a reader could stop at.`

function prompt(
  domain: string,
  range: DateRange,
  findings: Finding[],
  semantics: SiteSemantics | undefined,
) {
  const n = days(range)
  const context = semantics
    ? [
        `About the site: ${semantics.about}`,
        'Events:',
        ...semantics.events.map(
          (e) => `- ${e.name}${e.key ? ' (key event)' : ''}: ${e.description}`,
        ),
      ].join('\n')
    : 'No site description is available.'
  return `Site: ${domain}
Range: ${shortDay(range.from)} to ${shortDay(range.to)} (${n} days), compared with the ${n} days before.

${context}

Findings:
${findings.map(describe).join('\n')}`
}

/**
 * Asks the model to explain the findings. Claims citing unknown findings, or quoting numbers
 * their findings do not contain, are dropped.
 */
export async function writeReading(
  site: Site,
  range: DateRange,
  findings: Finding[],
  semantics: SiteSemantics | undefined,
): Promise<Reading> {
  const output = await structured({
    site,
    kind: 'reading',
    model: env.READING_MODEL,
    system: SYSTEM,
    user: prompt(site.domain, range, findings, semantics),
    schema: Output,
  })

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

  return { headline, claims, model: env.READING_MODEL, generatedAt: new Date().toISOString() }
}
