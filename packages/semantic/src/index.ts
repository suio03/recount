/**
 * The semantic layer: what events and metrics mean for a site.
 *
 * Dashboards render numbers; the AI layer reads these definitions to know which numbers matter,
 * how they relate to the business, and what a change implies. Definitions live in code so they are
 * reviewed and versioned like everything else.
 */

export type FunnelStage = 'acquisition' | 'activation' | 'conversion' | 'retention' | 'referral'

export interface PropertyDefinition {
  type: 'string' | 'number' | 'boolean'
  description: string
}

export interface EventDefinition {
  name: string
  description: string
  stage?: FunnelStage
  /** A key event is one whose change the AI should always report. */
  key?: boolean
  properties?: Record<string, PropertyDefinition>
}

export interface MetricDefinition {
  name: string
  description: string
  /** Event-count or unique-visitor ratio. Numerator and denominator reference event names. */
  numerator: { event: string; unique?: boolean }
  denominator?: { event: string; unique?: boolean }
  /** Optional window between denominator and numerator, in days. */
  windowDays?: number
  /** Whether an increase is good. Used when describing changes. */
  higherIsBetter: boolean
}

export interface SiteSemantics {
  domain: string
  /** Plain-language description of the business, its audience and its goals. */
  about: string
  /** Page types used by `<meta name="recount:page-type">`, with their meaning. */
  pageTypes?: Record<string, string>
  events: EventDefinition[]
  metrics: MetricDefinition[]
}

export function defineSite(site: SiteSemantics): SiteSemantics {
  const names = new Set(site.events.map((e) => e.name))
  for (const metric of site.metrics) {
    for (const ref of [metric.numerator, metric.denominator]) {
      if (ref && !names.has(ref.event) && ref.event !== 'pageview') {
        throw new Error(`Metric "${metric.name}" references unknown event "${ref.event}"`)
      }
    }
  }
  return site
}
