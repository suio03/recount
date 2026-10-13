import { createHash, randomBytes } from 'node:crypto'
import { sql as dsql, lt } from 'drizzle-orm'
import { db } from '../db/postgres'
import { salts } from '../db/schema'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000

/** First 8 bytes of SHA-256 as an unsigned 64-bit integer (ClickHouse UInt64). */
export function hash64(...parts: Array<string | Buffer>): bigint {
  const h = createHash('sha256')
  for (const part of parts) {
    h.update(part)
    h.update('\0')
  }
  return h.digest().readBigUInt64BE(0)
}

// --- Daily salts (cookieless mode) ----------------------------------------------------

const saltCache = new Map<string, Buffer>()

async function saltFor(day: string): Promise<Buffer> {
  const cached = saltCache.get(day)
  if (cached) return cached
  await db
    .insert(salts)
    .values({ day, salt: randomBytes(32) })
    .onConflictDoNothing()
  const row = await db.query.salts.findFirst({ where: (s, { eq }) => eq(s.day, day) })
  if (!row) throw new Error(`salt for ${day} missing`)
  saltCache.set(day, row.salt)
  return row.salt
}

/** Deletes salts older than yesterday so cookieless hashes cannot be linked across days. */
export async function pruneSalts(now = new Date()) {
  const yesterday = new Date(now.getTime() - 86400_000).toISOString().slice(0, 10)
  await db.delete(salts).where(lt(salts.day, dsql`${yesterday}::date`))
  for (const day of saltCache.keys()) if (day < yesterday) saltCache.delete(day)
}

// --- Cookieless sessions ---------------------------------------------------------------

// Single-process session table for cookieless visitors. Cookie-mode sessions come from the tracker.
const cookielessSessions = new Map<bigint, { sessionId: bigint; lastSeen: number }>()

function cookielessSession(visitorId: bigint, now: number): bigint {
  const current = cookielessSessions.get(visitorId)
  if (current && now - current.lastSeen < SESSION_TIMEOUT_MS) {
    current.lastSeen = now
    return current.sessionId
  }
  const sessionId = hash64(visitorId.toString(), String(now))
  cookielessSessions.set(visitorId, { sessionId, lastSeen: now })
  return sessionId
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TIMEOUT_MS
  for (const [k, v] of cookielessSessions) if (v.lastSeen < cutoff) cookielessSessions.delete(k)
}, 60_000).unref()

// --- Public ---------------------------------------------------------------------------

export async function resolveIdentity(input: {
  siteId: string
  mode: 'cookie' | 'cookieless'
  vid?: string
  sid?: string
  ip: string
  userAgent: string
  now: Date
}): Promise<{ visitorId: bigint; sessionId: bigint }> {
  if (input.mode === 'cookie' && input.vid && input.sid) {
    return {
      visitorId: hash64(input.siteId, input.vid),
      sessionId: hash64(input.siteId, input.sid),
    }
  }
  const salt = await saltFor(input.now.toISOString().slice(0, 10))
  const visitorId = hash64(salt, input.siteId, input.ip, input.userAgent)
  return { visitorId, sessionId: cookielessSession(visitorId, input.now.getTime()) }
}
