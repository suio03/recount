import { lookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { normalizeDomain } from '../domain'

/**
 * Fetching a site's or referrer's icon: from the host itself when it allows it, with addresses
 * inside the server's network refused at every hop. Browsers only ever ask this server, so no
 * favicon service sees who views which dashboard.
 */

const TIMEOUT_MS = 5000
const MAX_HTML = 512 * 1024
const MAX_ICON = 200 * 1024
const MAX_REDIRECTS = 3

/** Names that never resolve to a public site. */
const PRIVATE_SUFFIX = /(^|\.)(localhost|local|internal|test|example|invalid|home|lan|arpa)$/

/** The host an icon may be fetched for, or undefined. */
export function iconHost(input: string): string | undefined {
  const host = normalizeDomain(input)
  return host && !PRIVATE_SUFFIX.test(host) ? host : undefined
}

/** Whether an address is on the public internet, so a fetch cannot reach the server's network. */
export function isPublicAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  const ip = mapped?.[1] ?? address
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase()
    return !(
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      /^ff/.test(lower) ||
      lower.startsWith('64:ff9b:') ||
      lower.startsWith('2001:db8')
    )
  }
  return false
}

/** Resolves like the default, but refuses addresses that are not public. */
const publicLookup: typeof lookup = ((
  hostname: string,
  options: object,
  callback: (err: Error | null, address: string | object[], family?: number) => void,
) => {
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const list = addresses as Array<{ address: string; family: number }>
    const bad = list.find((a) => !isPublicAddress(a.address))
    if (bad || !list.length) return callback(new Error(`${hostname} is not public`), '')
    if ((options as { all?: boolean }).all) return callback(null, list)
    const first = list[0] as { address: string; family: number }
    callback(null, first.address, first.family)
  })
}) as typeof lookup

interface Fetched {
  url: URL
  contentType: string
  body: Buffer
}

/** One GET of a public http(s) address, following a few redirects, capped in size and time. */
export async function fetchPublic(url: URL, maxBytes: number, hops = 0): Promise<Fetched> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not http')
  if (isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('address, not a host')
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        lookup: publicLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RecountIcons/1.0; +https://recount.tools)',
          Accept: 'text/html,image/*;q=0.9,*/*;q=0.5',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          if (hops >= MAX_REDIRECTS) return reject(new Error('too many redirects'))
          const next = new URL(res.headers.location, url)
          return fetchPublic(next, maxBytes, hops + 1).then(resolve, reject)
        }
        if (status !== 200) {
          res.resume()
          return reject(new Error(`status ${status}`))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            req.destroy()
            return reject(new Error('too large'))
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({
            url,
            contentType: String(res.headers['content-type'] ?? ''),
            body: Buffer.concat(chunks),
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/** The image type of `body` by its first bytes, whatever the server called it. */
export function imageType(body: Buffer): string | undefined {
  const hex = body.subarray(0, 12).toString('hex')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('00000100')) return 'image/x-icon'
  if (hex.startsWith('474946')) return 'image/gif'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('52494646') && body.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  const head = body.subarray(0, 512).toString('utf8').trimStart().toLowerCase()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return 'image/svg+xml'
  return undefined
}

interface Candidate {
  href: string
  /** Lower is better. */
  rank: number
}

/**
 * Icon links in a page's head, best first: one about 32 to 64 pixels, then larger ones, SVG,
 * the apple-touch-icon, and anything else.
 */
export function iconLinks(html: string): Candidate[] {
  const end = html.search(/<\/head>/i)
  const head = end >= 0 ? html.slice(0, end) : html
  const found: Candidate[] = []
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const attr = (name: string) =>
      new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
        .exec(tag)
        ?.slice(1)
        .find((v) => v !== undefined)
    const rel = attr('rel')?.toLowerCase().split(/\s+/) ?? []
    const href = attr('href')
    if (!href || !(rel.includes('icon') || rel.includes('apple-touch-icon'))) continue
    const size = Number(/(\d+)x\d+/.exec(attr('sizes') ?? '')?.[1] ?? 0)
    const svg = /svg/i.test(attr('type') ?? '') || /\.svg(\?|$)/i.test(href)
    let rank = 50
    if (size >= 32 && size <= 64) rank = 10 + size / 10
    else if (size > 64) rank = 20 + size / 100
    else if (svg) rank = 25
    else if (rel.includes('apple-touch-icon')) rank = 30
    else if (size > 0) rank = 40 - size / 10
    found.push({ href, rank })
  }
  return found.sort((a, b) => a.rank - b.rank)
}

/** Fetches a host's icon from its home page's links, then /favicon.ico. */
export async function findIcon(host: string): Promise<{ type: string; body: Buffer } | undefined> {
  let base = new URL(`https://${host}/`)
  const hrefs: string[] = []
  try {
    const page = await fetchPublic(base, MAX_HTML)
    base = page.url
    if (/html/i.test(page.contentType))
      hrefs.push(...iconLinks(page.body.toString('utf8')).map((c) => c.href))
  } catch {}
  hrefs.push('/favicon.ico')
  const tried = new Set<string>()
  for (const href of hrefs) {
    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      continue
    }
    if (tried.has(url.href) || tried.size >= 4) continue
    tried.add(url.href)
    try {
      const icon = await fetchPublic(url, MAX_ICON)
      const type = imageType(icon.body)
      if (type) return { type, body: icon.body }
    } catch {}
  }
  // Large sites often turn servers away. DuckDuckGo's icon service then gets the host name only,
  // asked by this server, so it never learns whose dashboard shows it.
  try {
    const icon = await fetchPublic(
      new URL(`https://icons.duckduckgo.com/ip3/${host}.ico`),
      MAX_ICON,
    )
    const type = imageType(icon.body)
    if (type) return { type, body: icon.body }
  } catch {}
  return undefined
}
