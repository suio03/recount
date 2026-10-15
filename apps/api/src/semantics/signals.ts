import { inRange, rows } from '../stats/queries'

/**
 * Blind spots code finds in a site's data, where something happens that the events do not show:
 * pages where visitors stay long with nothing tracked (a game, a video, an editor), clicks on
 * elements with no text or label, a checkout reached with no payments recorded, and a form sent
 * with no page or event after it. Tracking gaps start from these, so a drafted gap rests on what
 * the data shows rather than on what a site of its kind usually tracks.
 */
export type Signal = { id: string; text: string } & (
  | {
      kind: 'long_stay'
      path: string
      visitors: number
      /** Median seconds from a view of the page to the visit's next event. */
      seconds: number
      siteSeconds: number
      clicksPerView: number
    }
  | {
      kind: 'unlabeled_click'
      tag: string
      section: string
      href: string
      pages: string[]
      visitors: number
      clicks: number
    }
  | {
      kind: 'checkout_no_payment'
      subjects: Array<{ subject: string; visitors: number }>
    }
  | {
      kind: 'form_no_confirmation'
      pages: string[]
      tag: string
      button: string
      section: string
      sessions: number
      followed: number
    }
)

export type SignalKind = Signal['kind']

/** Fewer visitors or sessions than this behind a signal, and it is mostly chance. */
const MIN_COUNT = 10
/** Views of a page whose next event is known, before its median says anything. */
const MIN_VIEWS = 20
const LONG_STAY_SECONDS = 60
/** How many times the site's median a page's stay must be. */
const LONG_STAY_FACTOR = 3
/** A form counts as confirmed when a page or custom event follows its button this soon. */
const CONFIRM_SECONDS = 120
const MAX_FOLLOWED_SHARE = 0.2
const PER_KIND = 2

/** Regular expressions avoid backslashes, which ClickHouse unescapes in parameters and literals. */
const CHECKOUT_PATH = '(?i)/(checkout|cart|basket|billing|payment|pay|purchase|upgrade)(/|$)'
const CHECKOUT_HOST =
  '(?i)(checkout[.]stripe[.]com|buy[.]stripe[.]com|lemonsqueezy[.]com|paddle[.]com|gumroad[.]com|polar[.]sh|paypal[.]com|checkout[.]shopify[.]com)$'
const CHECKOUT_TEXT =
  '(?i)^(buy|checkout|check out|pay|purchase|upgrade|order now|add to cart)([^a-z]|$)'
/** Custom events that already record a purchase, so payments are not missing. */
const PURCHASE_EVENT = '(?i)(purchase|payment|paid|order|checkout)'
const SUBMIT_TEXT =
  '(?i)^(submit|send|sign ?up|subscribe|register|join|apply|request|book|contact|notify|get started|create (an )?account|reserve)([^a-z]|$)'

const n = (v: unknown) => Number(v)
const quote = (s: string) => `"${s}"`

export async function signalsOf(params: Record<string, unknown>): Promise<Signal[]> {
  const [stays, unlabeled, checkout, forms] = await Promise.all([
    longStays(params),
    unlabeledClicks(params),
    checkoutWithoutPayments(params),
    unconfirmedForms(params),
  ])
  return [...stays, ...unlabeled, ...checkout, ...forms].map((s, i) => {
    const id = `S${i + 1}`
    return { ...s, id, text: describeSignal({ ...s, id, text: '' } as Signal) }
  }) as Signal[]
}

type Draft<K extends SignalKind> = Omit<Extract<Signal, { kind: K }>, 'id' | 'text'>

/** Each pageview with the time of the visit's next event, which is unknown on the last one. */
const VIEWS = `SELECT name, pathname, visitor_id,
    leadInFrame(toNullable(timestamp)) OVER (
      PARTITION BY session_id ORDER BY timestamp ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING
    ) AS next_at,
    dateDiff('second', timestamp, next_at) AS seconds
  FROM events WHERE ${inRange}`

async function longStays(params: Record<string, unknown>): Promise<Draft<'long_stay'>[]> {
  const found = await rows<{
    path: string
    visitors: number
    median: number
    siteSeconds: number
    clicksPerView: number
  }>(
    `WITH (SELECT quantileExactIf(0.5)(seconds, name = 'pageview' AND next_at IS NOT NULL)
           FROM (${VIEWS})) AS site_seconds
     SELECT pathname AS path, uniqExactIf(visitor_id, name = 'pageview') AS visitors,
            quantileExactIf(0.5)(seconds, name = 'pageview' AND next_at IS NOT NULL) AS median,
            site_seconds AS siteSeconds,
            round(countIf(name = 'click') / greatest(countIf(name = 'pageview'), 1), 2) AS clicksPerView
     FROM (${VIEWS})
     GROUP BY path
     HAVING countIf(name = 'pageview' AND next_at IS NOT NULL) >= ${MIN_VIEWS}
        AND visitors >= ${MIN_COUNT} AND median >= ${LONG_STAY_SECONDS}
        AND median >= site_seconds * ${LONG_STAY_FACTOR}
     ORDER BY visitors DESC LIMIT ${PER_KIND}`,
    params,
  )
  return found.map((r) => ({
    kind: 'long_stay',
    path: r.path,
    visitors: n(r.visitors),
    seconds: n(r.median),
    siteSeconds: n(r.siteSeconds),
    clicksPerView: n(r.clicksPerView),
  }))
}

async function unlabeledClicks(
  params: Record<string, unknown>,
): Promise<Draft<'unlabeled_click'>[]> {
  const found = await rows<{
    tag: string
    section: string
    href: string
    pages: string[]
    visitors: number
    clicks: number
  }>(
    `SELECT element_tag AS tag, toString(element_section) AS section,
            if(element_href = '' OR domain(element_href) = hostname, path(element_href),
               concat(domain(element_href), path(element_href))) AS href,
            topK(3)(pathname) AS pages, uniqExact(visitor_id) AS visitors, count() AS clicks
     FROM events
     WHERE ${inRange} AND name = 'click' AND element_text = '' AND element_label = ''
     GROUP BY tag, section, href HAVING visitors >= ${MIN_COUNT}
     ORDER BY visitors DESC LIMIT ${PER_KIND}`,
    params,
  )
  return found.map((r) => ({
    kind: 'unlabeled_click',
    tag: r.tag,
    section: r.section,
    href: r.href,
    pages: r.pages,
    visitors: n(r.visitors),
    clicks: n(r.clicks),
  }))
}

async function checkoutWithoutPayments(
  params: Record<string, unknown>,
): Promise<Draft<'checkout_no_payment'>[]> {
  const [recorded] = await rows<{ payments: number; events: number }>(
    `SELECT
       (SELECT count() FROM payments WHERE site_id = {site:UUID}
          AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}) AS payments,
       (SELECT count() FROM events WHERE ${inRange}
          AND name NOT IN ('pageview', 'click') AND match(name, {purchaseEvent:String})) AS events`,
    { ...params, purchaseEvent: PURCHASE_EVENT },
  )
  if (n(recorded?.payments) || n(recorded?.events)) return []
  const subjects = await rows<{ subject: string; visitors: number }>(
    `SELECT if(name = 'pageview', concat('page ', pathname),
               concat('click "', element_text, '"',
                      if(element_href = '', '', concat(' to ', domain(element_href))))) AS subject,
            uniqExact(visitor_id) AS visitors
     FROM events
     WHERE ${inRange} AND (
       (name = 'pageview' AND match(pathname, {checkoutPath:String}))
       OR (name = 'click' AND (match(domain(element_href), {checkoutHost:String})
                               OR match(element_text, {checkoutText:String})))
     )
     GROUP BY subject HAVING visitors >= ${MIN_COUNT}
     ORDER BY visitors DESC LIMIT 3`,
    {
      ...params,
      checkoutPath: CHECKOUT_PATH,
      checkoutHost: CHECKOUT_HOST,
      checkoutText: CHECKOUT_TEXT,
    },
  )
  if (!subjects.length) return []
  return [
    {
      kind: 'checkout_no_payment',
      subjects: subjects.map((s) => ({ subject: s.subject, visitors: n(s.visitors) })),
    },
  ]
}

async function unconfirmedForms(
  params: Record<string, unknown>,
): Promise<Draft<'form_no_confirmation'>[]> {
  const found = await rows<{
    pages: string[]
    tag: string
    button: string
    section: string
    sessions: number
    followed: number
  }>(
    `SELECT topK(3)(pathname) AS pages, element_tag AS tag, element_text AS button,
            toString(element_section) AS section, uniqExact(session_id) AS sessions,
            uniqExactIf(session_id, next_at IS NOT NULL
              AND dateDiff('second', timestamp, next_at) <= ${CONFIRM_SECONDS}) AS followed
     FROM (
       SELECT name, session_id, timestamp, pathname, element_tag, element_text, element_section,
              minIf(toNullable(timestamp), name != 'click') OVER (
                PARTITION BY session_id ORDER BY timestamp
                ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
              ) AS next_at
       FROM events
       WHERE ${inRange}
         AND (name != 'click' OR (element_tag != 'a' AND match(element_text, {submitText:String})))
     )
     WHERE name = 'click'
     GROUP BY tag, button, section
     HAVING sessions >= ${MIN_COUNT} AND followed <= sessions * ${MAX_FOLLOWED_SHARE}
     ORDER BY sessions DESC LIMIT ${PER_KIND}`,
    { ...params, submitText: SUBMIT_TEXT },
  )
  return found.map((r) => ({
    kind: 'form_no_confirmation',
    pages: r.pages,
    tag: r.tag,
    button: r.button,
    section: r.section,
    sessions: n(r.sessions),
    followed: n(r.followed),
  }))
}

const where = (section: string) => (section ? ` in section ${quote(section)}` : '')

/** One line per signal, as the model reads it, as claims are checked against and as shown. */
export function describeSignal(s: Signal): string {
  switch (s.kind) {
    case 'long_stay':
      return `${s.id} long stay on ${s.path}: ${s.visitors} visitors; the median view lasts ${s.seconds} seconds before the visit's next event (${s.siteSeconds} seconds across the site), with ${s.clicksPerView} clicks per view`
    case 'unlabeled_click':
      return `${s.id} clicks on an element with no text or label: <${s.tag}>${where(s.section)}${s.href ? `, href ${s.href}` : ''}, on ${s.pages.join(', ')}: ${s.visitors} visitors, ${s.clicks} clicks`
    case 'checkout_no_payment':
      return `${s.id} checkout reached with no payments recorded in the range: ${s.subjects
        .map((x) => `${x.subject} (${x.visitors} visitors)`)
        .join(', ')}`
    case 'form_no_confirmation':
      return `${s.id} form sent with nothing after it: <${s.tag}> ${quote(s.button)}${where(s.section)}, on ${s.pages.join(', ')}: clicked in ${s.sessions} sessions; a page or custom event followed within ${CONFIRM_SECONDS / 60} minutes in ${s.followed}`
  }
}
