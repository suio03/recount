import type { PaymentInput } from './record'

/**
 * Paddle Billing, read with an API key that only needs `transaction.read` and `adjustment.read`.
 * Amounts come from `payout_totals`, which Paddle reports in the account's settlement currency,
 * so every site sees one currency whatever its customers paid in.
 */

/** Sandbox keys (`pdl_sdbx_...`) only work against the sandbox API. */
const apiFor = (key: string) =>
  key.startsWith('pdl_sdbx_') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com'

interface Totals {
  currency_code: string
  total: string
  tax: string
}

export interface PaddleTransaction {
  id: string
  status: string
  origin: string
  customer_id: string | null
  custom_data: Record<string, unknown> | null
  billed_at: string | null
  created_at: string
  details: { payout_totals: Totals | null } | null
}

export interface PaddleAdjustment {
  id: string
  action: string
  status: string
  transaction_id: string
  customer_id: string
  created_at: string
  payout_totals: Totals | null
}

/** A payment before its tracker ids are hashed for the site. */
export type ProviderPayment = Omit<PaymentInput, 'visitorId' | 'sessionId'> & {
  /** Raw tracker ids, as the checkout put them in custom data. */
  vid?: string
  sid?: string
}

/** Origins of charges Paddle makes on its own for an existing subscription. */
const RENEWAL_ORIGINS = new Set([
  'subscription_recurring',
  'subscription_charge',
  'subscription_update',
  'subscription_payment_method_change',
])

/** What the merchant keeps before Paddle's fee: the payout total less the tax collected. */
const net = (t: Totals) => Number(t.total) - Number(t.tax)

const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function matches(
  customData: PaddleTransaction['custom_data'],
  match: Record<string, string>,
) {
  return Object.entries(match).every(([k, v]) => customData?.[k] === v)
}

/**
 * The site's payments among completed transactions and approved refunds. Refunds carry no custom
 * data, so they are kept when they refund a transaction in `known` or in this batch.
 */
export function toPayments(
  transactions: PaddleTransaction[],
  adjustments: PaddleAdjustment[],
  {
    match,
    currency,
    known,
  }: { match: Record<string, string>; currency: string; known: Set<string> },
): { payments: ProviderPayment[]; skipped: string[] } {
  const payments: ProviderPayment[] = []
  const skipped: string[] = []
  const ours = new Set(known)
  for (const t of transactions) {
    const totals = t.details?.payout_totals
    if (t.status !== 'completed' || !totals || !matches(t.custom_data, match)) continue
    ours.add(t.id)
    if (totals.currency_code !== currency) {
      skipped.push(`${t.id}: settled in ${totals.currency_code}, site currency is ${currency}`)
      continue
    }
    payments.push({
      provider: 'paddle',
      paymentId: t.id,
      timestamp: new Date(t.billed_at ?? t.created_at),
      kind: RENEWAL_ORIGINS.has(t.origin) ? 'renewal' : 'new',
      amount: net(totals),
      customerId: t.customer_id ?? '',
      vid: text(t.custom_data?.recount_vid),
      sid: text(t.custom_data?.recount_sid),
    })
  }
  for (const a of adjustments) {
    const totals = a.payout_totals
    if (a.action !== 'refund' || a.status !== 'approved' || !totals) continue
    if (!ours.has(a.transaction_id)) continue
    if (totals.currency_code !== currency) {
      skipped.push(`${a.id}: settled in ${totals.currency_code}, site currency is ${currency}`)
      continue
    }
    payments.push({
      provider: 'paddle',
      paymentId: a.id,
      timestamp: new Date(a.created_at),
      kind: 'refund',
      amount: -net(totals),
      customerId: a.customer_id,
    })
  }
  return { payments, skipped }
}

async function list<T>(key: string, path: string): Promise<T[]> {
  const found: T[] = []
  let url: string | undefined = `${apiFor(key)}${path}`
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } })
    if (!res.ok) throw new Error(`Paddle ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as {
      data: T[]
      meta: { pagination: { next: string; has_more: boolean } }
    }
    found.push(...body.data)
    url = body.meta.pagination.has_more ? body.meta.pagination.next : undefined
  }
  return found
}

/**
 * Whether Paddle accepts `key` for reading transactions and refunds; the error to show if not.
 */
export async function checkPaddleKey(key: string): Promise<string | undefined> {
  for (const path of ['/transactions?per_page=1', '/adjustments?per_page=1']) {
    const res = await fetch(`${apiFor(key)}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    }).catch(() => undefined)
    if (!res) return 'Could not reach Paddle. Try again.'
    if (res.ok) continue
    const code = await res
      .json()
      .then((b: { error?: { code?: string } }) => b.error?.code)
      .catch(() => undefined)
    // Paddle answers 403 both for a bad key and for one missing a permission.
    if (code === 'forbidden')
      return `This key cannot read ${path.slice(1).split('?')[0]}. Give it transaction.read and adjustment.read.`
    if (res.status === 401 || res.status === 403) return 'Paddle does not accept this key.'
    return `Paddle answered ${res.status}. Try again.`
  }
}

/** Completed transactions updated since `since` (all of them on the first sync), and refunds. */
export async function fetchPaddle(key: string, since?: Date) {
  const params = new URLSearchParams({ status: 'completed', per_page: '200' })
  if (since) params.set('updated_at[GTE]', since.toISOString())
  const [transactions, adjustments] = await Promise.all([
    list<PaddleTransaction>(key, `/transactions?${params}`),
    // Refunds are rare, so all of them are read each time rather than tracking a second cursor.
    list<PaddleAdjustment>(key, '/adjustments?action=refund&status=approved&per_page=50'),
  ])
  return { transactions, adjustments }
}
