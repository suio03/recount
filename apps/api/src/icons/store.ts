import { eq } from 'drizzle-orm'
import { db } from '../db/postgres'
import { icons } from '../db/schema'
import { findIcon, iconHost } from './fetch'

/**
 * Icons as stored: each host's is fetched once, kept in Postgres, and fetched again only when
 * stale, so dashboards never wait on someone else's site twice.
 */

const DAY = 86_400_000
/** How long a found icon is kept before it is fetched again. */
const FOUND_TTL = 30 * DAY
/** How long a host with no icon is left alone. */
const MISSING_TTL = 7 * DAY
const inFlight = new Map<string, Promise<void>>()

/** Fetches and stores a host's icon, once at a time per host. */
function refresh(host: string) {
  let pending = inFlight.get(host)
  if (!pending) {
    pending = findIcon(host)
      .then(async (icon) => {
        const row = {
          contentType: icon?.type ?? null,
          body: icon?.body ?? null,
          fetchedAt: new Date(),
        }
        await db
          .insert(icons)
          .values({ host, ...row })
          .onConflictDoUpdate({ target: icons.host, set: row })
      })
      .catch((err) => console.error(`icon ${host}: ${err}`))
      .finally(() => inFlight.delete(host))
    inFlight.set(host, pending)
  }
  return pending
}

/**
 * A host's stored icon, fetched first if it was never asked for. A stale one is served as it is
 * and fetched again in the background.
 */
export async function iconFor(host: string) {
  let row = await db.query.icons.findFirst({ where: eq(icons.host, host) })
  if (!row) {
    await refresh(host)
    row = await db.query.icons.findFirst({ where: eq(icons.host, host) })
  } else {
    const ttl = row.body ? FOUND_TTL : MISSING_TTL
    if (Date.now() - row.fetchedAt.getTime() > ttl) void refresh(host)
  }
  return row?.body && row.contentType ? { type: row.contentType, body: row.body } : undefined
}

/**
 * The icon as an HTTP response. An SVG is served under a policy that runs nothing in it, since it
 * comes from someone else's site and is served from this origin.
 */
export async function iconResponse(input: string): Promise<Response> {
  const host = iconHost(input)
  const icon = host ? await iconFor(host) : undefined
  if (!icon)
    return new Response(null, {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=86400' },
    })
  return new Response(new Uint8Array(icon.body), {
    headers: {
      'Content-Type': icon.type,
      'Cache-Control': 'public, max-age=604800',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
