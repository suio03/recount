import type { ElementContext, EventPayload, IdentityMode } from '@recount/shared'

/**
 * Recount tracker.
 *
 *   <script defer src="https://recount.example/js/script.js" data-site="ordalin.com"></script>
 *
 * Attributes:
 *   data-site     Site domain configured in Recount. Defaults to the page hostname.
 *   data-api      Event endpoint. Defaults to `/api/event` on the script's origin.
 *   data-mode     `cookie` (default) keeps a first-party visitor id for journeys and revenue
 *                 attribution; `cookieless` sets nothing and lets the server hash IP + UA daily.
 *
 * Markup hints:
 *   data-rc-event="Name"    Clicking the element sends a custom event with that name.
 *   data-rc-section="Name"  Names a region; clicks inside it carry the section name.
 *   data-rc-mask            Element text inside is never sent.
 *   <meta name="recount:page-type" content="pricing">  Semantic page type.
 *
 * Revenue attribution: put `recount.ids()` in the checkout's custom data (Paddle `customData`,
 * Stripe `metadata`). A server that creates the checkout can read the `rc_vid` and `rc_sid`
 * cookies instead.
 */

type Props = Record<string, string | number | boolean>

const VISITOR_COOKIE = 'rc_vid'
const SESSION_COOKIE = 'rc_sid'
const VISITOR_DAYS = 365
const SESSION_MINUTES = 30
const TEXT_LIMIT = 120

const script = document.currentScript as HTMLScriptElement | null
const site = script?.dataset.site || location.hostname
const endpoint = script?.dataset.api || new URL('/api/event', script?.src || location.href).href
const mode: IdentityMode = script?.dataset.mode === 'cookieless' ? 'cookieless' : 'cookie'

function ignored(): boolean {
  if ((navigator as Navigator & { webdriver?: boolean }).webdriver) return true
  if (
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) &&
    !script?.hasAttribute('data-allow-localhost')
  ) {
    return true
  }
  try {
    return localStorage.getItem('recount_ignore') === 'true'
  } catch {
    return false
  }
}

// --- Identity (cookie mode) ---------------------------------------------------------------

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

let cookieDomain: string | undefined

/** Finds the registrable domain by setting a probe cookie on progressively longer suffixes. */
function rootDomain(): string {
  if (cookieDomain !== undefined) return cookieDomain
  // IP addresses and single-label hosts (localhost) only accept host-only cookies.
  if (/^[\d.]+$|^\[|^[^.]+$/.test(location.hostname)) {
    cookieDomain = ''
    return ''
  }
  const parts = location.hostname.split('.')
  for (let i = parts.length - 2; i >= 0; i--) {
    const candidate = parts.slice(i).join('.')
    document.cookie = `rc_probe=1; domain=${candidate}; path=/; SameSite=Lax`
    if (readCookie('rc_probe')) {
      document.cookie = `rc_probe=; domain=${candidate}; path=/; max-age=0`
      cookieDomain = candidate
      return candidate
    }
  }
  cookieDomain = ''
  return ''
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  const domain = rootDomain()
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax` +
    (domain ? `; domain=${domain}` : '') +
    secure
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Returns visitor and session ids, extending the session on every event. */
function identity(): { vid: string; sid: string } {
  const vid = readCookie(VISITOR_COOKIE) || uuid()
  const sid = readCookie(SESSION_COOKIE) || uuid()
  writeCookie(VISITOR_COOKIE, vid, VISITOR_DAYS * 86400)
  writeCookie(SESSION_COOKIE, sid, SESSION_MINUTES * 60)
  return { vid, sid }
}

// --- Semantic context --------------------------------------------------------------------

function clean(text: string | null | undefined): string | undefined {
  const value = text?.replace(/\s+/g, ' ').trim()
  return value ? value.slice(0, TEXT_LIMIT) : undefined
}

function pageType(): string | undefined {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="recount:page-type"]')?.content || undefined
  )
}

function sectionOf(el: Element): string | undefined {
  const region = el.closest(
    '[data-rc-section],section[id],section[aria-label],header,nav,main,footer,aside',
  )
  if (!region) return undefined
  return clean(
    region.getAttribute('data-rc-section') ||
      region.getAttribute('aria-label') ||
      region.id ||
      region.tagName.toLowerCase(),
  )
}

function describe(el: Element): ElementContext {
  const masked = el.closest('[data-rc-mask]') !== null
  const href = el instanceof HTMLAnchorElement ? el.href : undefined
  return {
    tag: el.tagName.toLowerCase(),
    text: masked ? undefined : clean((el as HTMLElement).innerText),
    label: clean(el.getAttribute('aria-label') || el.getAttribute('title')),
    href,
    section: sectionOf(el),
  }
}

// --- Sending -----------------------------------------------------------------------------

function send(name: string, extra: { props?: Props; el?: ElementContext } = {}) {
  if (ignored()) return
  const payload: EventPayload = {
    s: site,
    n: name,
    u: location.href,
    r: document.referrer || undefined,
    t: clean(document.title),
    pt: pageType(),
    m: mode,
    w: window.innerWidth,
    l: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    el: extra.el,
  }
  if (extra.props) {
    payload.p = Object.fromEntries(Object.entries(extra.props).map(([k, v]) => [k, String(v)]))
  }
  if (mode === 'cookie') Object.assign(payload, identity())

  // text/plain keeps this a "simple" request, so no CORS preflight is needed.
  fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain' },
    keepalive: true,
  }).catch(() => {})
}

let lastUrl: string | undefined

function pageview() {
  // Hash changes (in-page anchors) are not new pages.
  const url = location.href.split('#')[0]
  if (url === lastUrl) return
  lastUrl = url
  send('pageview')
}

function onClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null
  const el = target?.closest('a,button,[role="button"],[data-rc-event]')
  if (!el) return
  send(el.getAttribute('data-rc-event') || 'click', { el: describe(el) })
}

// --- Boot --------------------------------------------------------------------------------

const history = window.history
const pushState = history.pushState
history.pushState = function (...args: Parameters<History['pushState']>) {
  pushState.apply(this, args)
  pageview()
}
window.addEventListener('popstate', pageview)
document.addEventListener('click', onClick, { capture: true })

interface Recount {
  (name: string, options?: { props?: Props }): void
  /** The visitor and session ids to attach to a checkout; empty in cookieless mode. */
  ids(): { recount_vid?: string; recount_sid?: string }
}

declare global {
  interface Window {
    recount?: Recount
  }
}
window.recount = Object.assign(
  (name: string, options?: { props?: Props }) => send(name, { props: options?.props }),
  {
    ids() {
      if (mode !== 'cookie') return {}
      const { vid, sid } = identity()
      return { recount_vid: vid, recount_sid: sid }
    },
  },
)

pageview()
