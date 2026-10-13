import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'
import { env } from './env'

/**
 * The visitor's address as the proxy in front reports it. Cloudflare's header counts only with
 * TRUST_CF_HEADERS, since any other proxy passes it through as the client sent it.
 * X-Forwarded-For is safe behind a proxy that replaces it, as Traefik does by default; with no
 * proxy at all, a client can set it to anything.
 */
export function clientIp(c: Context) {
  return (
    (env.TRUST_CF_HEADERS ? c.req.header('cf-connecting-ip') : undefined) ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    getConnInfo(c).remote.address ??
    ''
  )
}

/** Two-letter country from Cloudflare, or '' when not behind it; city and region need a geo database (TODO). */
export function clientCountry(c: Context) {
  if (!env.TRUST_CF_HEADERS) return ''
  return (c.req.header('cf-ipcountry') ?? '').replace(/^(XX|T1)$/, '').slice(0, 2)
}
