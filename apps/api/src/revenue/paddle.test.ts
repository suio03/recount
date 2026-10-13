import { describe, expect, it } from 'vitest'
import { type PaddleAdjustment, type PaddleTransaction, toPayments } from './paddle'

const txn = (id: string, over: Partial<PaddleTransaction> = {}): PaddleTransaction => ({
  id,
  status: 'completed',
  origin: 'web',
  customer_id: 'ctm_1',
  custom_data: { project: 'scribix', recount_vid: 'v1', recount_sid: 's1' },
  billed_at: '2026-10-01T10:00:00Z',
  created_at: '2026-10-01T09:59:00Z',
  details: { payout_totals: { currency_code: 'USD', total: '1935', tax: '336' } },
  ...over,
})

const refund = (id: string, transaction: string): PaddleAdjustment => ({
  id,
  action: 'refund',
  status: 'approved',
  transaction_id: transaction,
  customer_id: 'ctm_1',
  created_at: '2026-10-03T00:00:00Z',
  payout_totals: { currency_code: 'USD', total: '1935', tax: '336' },
})

const options = { match: { project: 'scribix' }, currency: 'USD', known: new Set<string>() }

describe('toPayments', () => {
  it('records the payout less tax, with the tracker ids from custom data', () => {
    const { payments } = toPayments([txn('txn_1')], [], options)
    expect(payments).toEqual([
      {
        provider: 'paddle',
        paymentId: 'txn_1',
        timestamp: new Date('2026-10-01T10:00:00Z'),
        kind: 'new',
        amount: 1599,
        customerId: 'ctm_1',
        vid: 'v1',
        sid: 's1',
      },
    ])
  })

  it("keeps only the site's completed transactions and marks renewals", () => {
    const { payments } = toPayments(
      [
        txn('txn_other', { custom_data: { project: 'muzix' } }),
        txn('txn_draft', { status: 'draft' }),
        txn('txn_renew', { origin: 'subscription_recurring' }),
      ],
      [],
      options,
    )
    expect(payments.map((p) => [p.paymentId, p.kind])).toEqual([['txn_renew', 'renewal']])
  })

  it("keeps refunds of the site's transactions, from this batch or stored ones", () => {
    const { payments } = toPayments(
      [txn('txn_1')],
      [refund('adj_1', 'txn_1'), refund('adj_2', 'txn_stored'), refund('adj_3', 'txn_other')],
      { ...options, known: new Set(['txn_stored']) },
    )
    expect(payments.filter((p) => p.kind === 'refund').map((p) => [p.paymentId, p.amount])).toEqual(
      [
        ['adj_1', -1599],
        ['adj_2', -1599],
      ],
    )
  })

  it('skips payments settled in another currency rather than mixing them', () => {
    const { payments, skipped } = toPayments([txn('txn_1')], [], { ...options, currency: 'EUR' })
    expect(payments).toEqual([])
    expect(skipped).toHaveLength(1)
  })
})
