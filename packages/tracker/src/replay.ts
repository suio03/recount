import { record } from '@rrweb/record'

/**
 * Session recorder, loaded by script.js only for sampled sessions. Records DOM changes with
 * rrweb, never input values, and only the text of controls, navigation and headings: everything
 * else is replaced with asterisks before it leaves the page. Batches are gzipped and posted to
 * `/api/replay` with the tracker's visitor and session ids.
 */

const FLUSH_MS = 5000
const FLUSH_EVENTS = 200
/** Browsers drop keepalive requests whose bodies total more than 64 KB. */
const KEEPALIVE_BYTES = 60_000

/** Text that stays readable: what a visitor clicks or reads to find their way. */
const KEEP_TEXT =
  'a,button,[role="button"],[role="tab"],[role="menuitem"],nav,label,summary,legend,h1,h2,h3,h4,h5,h6,th,[data-rc-unmask]'

const script = document.currentScript as HTMLScriptElement | null
const site = script?.dataset.site ?? location.hostname
const endpoint = script?.dataset.api ?? new URL('/api/replay', script?.src ?? location.href).href
/** One id per page load; a session's recording is the page loads ordered by time. */
const load = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

function maskText(text: string, element: HTMLElement | null) {
  const keep = element?.closest(KEEP_TEXT) && !element.closest('[data-rc-mask]')
  return keep ? text : text.replace(/\S/g, '*')
}

let buffer: unknown[] = []
let seq = 0
let sessionId: string | undefined

async function gzip(text: string): Promise<Blob> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Response(stream).blob()
}

async function flush(leaving = false) {
  if (!buffer.length) return
  const ids = window.recount?.ids()
  if (!ids?.recount_vid || !ids.recount_sid) return
  const events = buffer
  buffer = []
  const params = new URLSearchParams({
    s: site,
    vid: ids.recount_vid,
    sid: ids.recount_sid,
    load,
    seq: String(seq++),
  })
  const json = JSON.stringify(events)
  // Compression is asynchronous and may not finish while the page unloads, so a small last
  // batch goes out as plain JSON; the server accepts both.
  const body = leaving && json.length < KEEPALIVE_BYTES ? json : await gzip(json)
  // text/plain keeps this a simple request (no CORS preflight).
  fetch(`${endpoint}?${params}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'text/plain' },
    keepalive: leaving && (typeof body === 'string' ? body.length : body.size) < KEEPALIVE_BYTES,
  }).catch(() => {})
}

record({
  emit(event, isCheckout) {
    buffer.push(event)
    if (isCheckout) return
    if (buffer.length >= FLUSH_EVENTS) void flush()
  },
  maskAllInputs: true,
  maskTextSelector: '*',
  maskTextFn: maskText,
  blockSelector: '[data-rc-block]',
  // Fewer mouse samples: the timeline needs where the pointer went, not every pixel.
  sampling: { mousemove: 100, scroll: 150, input: 'last' },
  recordCanvas: false,
  collectFonts: false,
  inlineImages: false,
})

/** Sections a visitor can scroll to: named regions and headings, with their offset from the top. */
const SECTIONS = '[data-rc-section],h1,h2,h3'
const ERROR_TEXT = 200
const SAME_PLACE_PX = 100

/**
 * The page's height and where its sections start, so the server can tell which sections a
 * scroll position reached. Only heading text is sent, and only where it would be kept anyway.
 */
function layout() {
  const found = [...document.querySelectorAll<HTMLElement>(SECTIONS)].slice(0, 50).map((el) => ({
    name: el.closest('[data-rc-mask]')
      ? ''
      : (el.dataset.rcSection ?? el.textContent?.trim().slice(0, 80) ?? ''),
    top: Math.round(el.getBoundingClientRect().top + scrollY),
  }))
  // A named region and the heading at its top are one place.
  const sections = found.filter((s, i) => !i || s.top - (found[i - 1]?.top ?? 0) > SAME_PLACE_PX)
  record.addCustomEvent('layout', {
    height: document.documentElement.scrollHeight,
    viewport: innerHeight,
    sections,
  })
}
let lastHeight = 0
function layoutIfChanged() {
  if (document.documentElement.scrollHeight === lastHeight) return
  lastHeight = document.documentElement.scrollHeight
  layout()
}

/** Error messages can quote user data, so emails and long numbers are blanked out. */
const scrub = (message: string) =>
  message
    .replace(/[^\s@]+@[^\s@]+/g, '<email>')
    .replace(/\d{4,}/g, '<number>')
    .slice(0, ERROR_TEXT)

addEventListener('error', (e) => {
  record.addCustomEvent('error', {
    message: scrub(String(e.message)),
    source: e.filename ? new URL(e.filename, location.href).pathname : '',
  })
})
addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? e.reason.message : String(e.reason)
  record.addCustomEvent('error', { message: scrub(reason), source: 'promise' })
})

setInterval(() => {
  layoutIfChanged()
  // A new session (30 minutes idle) starts its recording with a fresh full snapshot.
  const sid = window.recount?.ids().recount_sid
  if (sessionId && sid !== sessionId) {
    buffer = []
    seq = 0
    record.takeFullSnapshot(true)
    lastHeight = 0
  }
  sessionId = sid
  void flush()
}, FLUSH_MS)

// rrweb notes the URL only with full snapshots, so route changes in single-page apps are marked.
let href = location.href
function navigated() {
  if (location.href === href) return
  href = location.href
  record.addCustomEvent('nav', { href })
  setTimeout(layoutIfChanged, 1000)
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = history[method]
  history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
    original.apply(this, args)
    navigated()
  }
}
addEventListener('popstate', navigated)

if (document.readyState === 'complete') layoutIfChanged()
else addEventListener('load', layoutIfChanged)

addEventListener('pagehide', () => void flush(true))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flush(true)
})
