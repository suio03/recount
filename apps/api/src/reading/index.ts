import type { Finding } from './changes'
import type { Reading } from './write'

export type { Finding } from './changes'
export type { Reading } from './write'

export interface ReadingResponse {
  findings: Finding[]
  reading: Reading | null
  /**
   * Why there is no reading: AI analysis is off for the site, no API key, a key the API
   * refused, no credit left, today's AI budget spent, or another failure of the model call.
   */
  status: 'ok' | 'off' | 'unconfigured' | 'key_rejected' | 'no_credit' | 'over_budget' | 'error'
  error?: string
}

/**
 * Answers are rewritten after this long. A range that includes today keeps counting while the
 * dashboard's totals update every few seconds, so its answers are rewritten sooner and the two
 * do not drift far apart; a closed range barely moves.
 */
export const OPEN_TTL_MS = 60 * 60 * 1000
export const CLOSED_TTL_MS = 6 * 60 * 60 * 1000
