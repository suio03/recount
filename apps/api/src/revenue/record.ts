import { clickhouse } from '../db/clickhouse'
import type { Site } from '../db/schema'
import { rows, SESSION_COLUMNS } from '../stats/queries'

/** A payment as a provider adapter reports it, before attribution. */
export interface PaymentInput {
  provider: string
  paymentId: string
  timestamp: Date
  kind: 'new' | 'renewal' | 'refund'
  /** Minor units of the site's currency; negative for refunds. */
  amount: number
  customerId: string
  /** Hashed ids, as stored on events, when the checkout carried the tracker's ids. */
  visitorId?: bigint
  sessionId?: bigint
}

interface Snapshot {
  session_id: string
  visitor_id: string
  channel: string
  referrer: string
  campaign: string
  entry: string
  country: string
  device: string
  browser: string
  os: string
  pages: string[]
  event_names: string[]
}

/** ClickHouse DateTime64 text in UTC. */
const chTime = (d: Date | number) => new Date(d).toISOString().replace('T', ' ').replace('Z', '')

const EMPTY: Snapshot = {
  visitor_id: '0',
  session_id: '0',
  channel: '',
  referrer: '',
  campaign: '',
  entry: '',
  country: '',
  device: '',
  browser: '',
  os: '',
  pages: [],
  event_names: [],
}

/** The first attributed payment of each customer, so renewals and refunds inherit its session. */
async function firstSessions(site: Site, customers: string[]) {
  if (!customers.length) return new Map<string, string>()
  const found = await rows<{ customer_id: string; first_session: string }>(
    `SELECT customer_id, toString(argMin(session_id, timestamp)) AS first_session
     FROM payments FINAL
     WHERE site_id = {site:UUID} AND customer_id IN {customers:Array(String)} AND session_id != 0
     GROUP BY customer_id`,
    { site: site.id, customers },
  )
  return new Map(found.map((r) => [r.customer_id, r.first_session]))
}

/** For payments that carry only a visitor: the visitor's last session before the payment. */
async function lastSession(site: Site, visitorId: bigint, before: Date) {
  const [row] = await rows<{ session_id: string }>(
    `SELECT toString(session_id) AS session_id FROM events
     WHERE site_id = {site:UUID} AND visitor_id = {visitor:UInt64} AND timestamp <= {before:DateTime64(3, 'UTC')}
     ORDER BY timestamp DESC LIMIT 1`,
    { site: site.id, visitor: visitorId.toString(), before: chTime(before) },
  )
  return row?.session_id
}

async function snapshots(site: Site, sessionIds: string[]) {
  if (!sessionIds.length) return new Map<string, Snapshot>()
  const found = await rows<Snapshot>(
    // 64-bit ids come back as strings so they keep their precision.
    `SELECT * REPLACE (toString(session_id) AS session_id, toString(visitor_id) AS visitor_id)
     FROM (
       SELECT ${SESSION_COLUMNS}
       FROM events
       WHERE site_id = {site:UUID} AND session_id IN {sessions:Array(UInt64)}
       GROUP BY session_id
     )`,
    { site: site.id, tz: site.timezone, sessions: sessionIds.map(BigInt) },
  )
  return new Map(found.map((s) => [s.session_id, s]))
}

/**
 * Attributes payments to sessions and stores them. A payment goes to the session its checkout
 * carried, else the visitor's last session before paying; renewals and refunds without ids go
 * to the customer's first attributed payment. Rerunning with the same payments replaces them.
 */
export async function recordPayments(site: Site, payments: PaymentInput[]) {
  if (!payments.length) return
  const sessionOf = new Map<PaymentInput, string>()
  for (const p of payments) {
    if (p.sessionId) sessionOf.set(p, p.sessionId.toString())
    else if (p.visitorId) {
      const session = await lastSession(site, p.visitorId, p.timestamp)
      if (session) sessionOf.set(p, session)
    }
  }

  // Earlier payments in this batch count as well as stored ones, oldest first.
  const ordered = [...payments].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const unattributed = ordered.filter((p) => !sessionOf.has(p) && p.customerId)
  const stored = await firstSessions(site, [...new Set(unattributed.map((p) => p.customerId))])
  for (const p of ordered) {
    if (sessionOf.has(p)) {
      if (p.customerId && !stored.has(p.customerId))
        stored.set(p.customerId, sessionOf.get(p) as string)
      continue
    }
    const inherited = stored.get(p.customerId)
    if (inherited) sessionOf.set(p, inherited)
  }

  const known = await snapshots(site, [...new Set(sessionOf.values())])
  const syncedAt = chTime(Date.now())
  await clickhouse.insert({
    table: 'payments',
    format: 'JSONEachRow',
    values: payments.map((p) => {
      const s = known.get(sessionOf.get(p) ?? '') ?? EMPTY
      return {
        site_id: site.id,
        provider: p.provider,
        payment_id: p.paymentId,
        timestamp: chTime(p.timestamp),
        kind: p.kind,
        amount: p.amount,
        currency: site.currency,
        customer_id: p.customerId,
        visitor_id: s.visitor_id,
        session_id: s.session_id,
        channel: s.channel,
        referrer: s.referrer,
        campaign: s.campaign,
        entry: s.entry,
        country: s.country,
        device: s.device,
        browser: s.browser,
        os: s.os,
        pages: s.pages,
        event_names: s.event_names,
        synced_at: syncedAt,
      }
    }),
  })
}
