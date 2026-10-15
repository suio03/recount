import type { Site } from '../db/schema'
import { inRange, rows } from '../stats/queries'
import { type DateRange, rangeParams } from '../stats/range'
import { type Signal, signalsOf } from './signals'

/**
 * What a site's data holds, listed by code for the model that drafts the site's semantics:
 * pages, page types, clicked elements, custom events, and what paying visits did, with the blind
 * spots code found in them. Each item and signal has an id the draft cites as evidence. Counts
 * are unique visitors in the range.
 */
export interface Inventory {
  domain: string
  range: DateRange
  visitors: number
  sessions: number
  items: Item[]
  signals: Signal[]
}

export type Item =
  | { id: string; kind: 'page'; path: string; title: string; visitors: number }
  | { id: string; kind: 'pattern'; path: string; pages: number; visitors: number }
  | { id: string; kind: 'pageType'; type: string; visitors: number }
  | {
      id: string
      kind: 'click'
      tag: string
      text: string
      label: string
      section: string
      href: string
      pages: string[]
      visitors: number
    }
  /** Custom events, including clicks on elements marked with data-rc-event. */
  | { id: string; kind: 'event'; name: string; props: string[]; visitors: number }
  | {
      id: string
      kind: 'paid'
      /** A page or event name seen in paying sessions. */
      subject: string
      paying: number
      payingTotal: number
      sessions: number
    }

const PAGES = 40
const CLICKS = 60
const PAID = 15

export async function inventoryOf(site: Site, range: DateRange): Promise<Inventory> {
  const params = { site: site.id, tz: site.timezone, ...rangeParams(range) }
  const [totals, pages, patterns, pageTypes, clicks, events, paid, signals] = await Promise.all([
    rows<{ visitors: number; sessions: number }>(
      `SELECT uniqExact(visitor_id) AS visitors, uniqExact(session_id) AS sessions
       FROM events WHERE ${inRange}`,
      params,
    ),
    rows<{ path: string; title: string; visitors: number }>(
      `SELECT pathname AS path, anyIf(page_title, page_title != '') AS title,
              uniqExact(visitor_id) AS visitors
       FROM events WHERE ${inRange} AND name = 'pageview'
       GROUP BY path ORDER BY visitors DESC LIMIT ${PAGES}`,
      params,
    ),
    // Paths under a first segment with several children, such as /tools/*.
    rows<{ path: string; pages: number; visitors: number }>(
      `SELECT concat('/', splitByChar('/', pathname)[2], '/*') AS path,
              uniqExact(pathname) AS pages, uniqExact(visitor_id) AS visitors
       FROM events
       WHERE ${inRange} AND name = 'pageview' AND length(splitByChar('/', pathname)) > 2
       GROUP BY path HAVING pages > 1 ORDER BY visitors DESC LIMIT 20`,
      params,
    ),
    rows<{ type: string; visitors: number }>(
      `SELECT page_type AS type, uniqExact(visitor_id) AS visitors
       FROM events WHERE ${inRange} AND name = 'pageview' AND page_type != ''
       GROUP BY type ORDER BY visitors DESC LIMIT 20`,
      params,
    ),
    // Internal links by path, external ones by host and path; query strings dropped.
    rows<{
      tag: string
      text: string
      label: string
      section: string
      href: string
      pages: string[]
      visitors: number
    }>(
      `SELECT element_tag AS tag, element_text AS text, element_label AS label,
              toString(element_section) AS section,
              if(element_href = '' OR domain(element_href) = hostname, path(element_href),
                 concat(domain(element_href), path(element_href))) AS href,
              topK(3)(pathname) AS pages, uniqExact(visitor_id) AS visitors
       FROM events WHERE ${inRange} AND name = 'click'
       GROUP BY tag, text, label, section, href ORDER BY visitors DESC LIMIT ${CLICKS}`,
      params,
    ),
    rows<{ name: string; props: string[]; visitors: number }>(
      `SELECT name, groupUniqArrayArray(5)(mapKeys(props)) AS props,
              uniqExact(visitor_id) AS visitors
       FROM events WHERE ${inRange} AND name NOT IN ('pageview', 'click')
       GROUP BY name ORDER BY visitors DESC LIMIT 30`,
      params,
    ),
    paidOf(params),
    signalsOf(params),
  ])
  const total = totals[0] ?? { visitors: 0, sessions: 0 }
  const items: Item[] = []
  const add = (prefix: string, list: Array<Record<string, unknown>>, kind: Item['kind']) =>
    list.forEach((row, i) => {
      items.push({ id: `${prefix}${i + 1}`, kind, ...row } as Item)
    })
  add('P', pages, 'page')
  add('G', patterns, 'pattern')
  add('T', pageTypes, 'pageType')
  add('C', clicks, 'click')
  add('E', events, 'event')
  add('R', paid, 'paid')
  return {
    domain: site.domain,
    range,
    visitors: Number(total.visitors),
    sessions: Number(total.sessions),
    items: items.map((item) => normalize(item)),
    signals,
  }
}

/**
 * Pages and events most often seen in sessions that led to a new payment, next to how many
 * sessions saw them overall, so the model can tell a step toward paying from a popular page.
 */
async function paidOf(params: Record<string, unknown>) {
  const paying = `SELECT DISTINCT session_id FROM payments
    WHERE site_id = {site:UUID} AND kind = 'new' AND session_id != 0
      AND toDate(timestamp, {tz:String}) BETWEEN {from:Date} AND {to:Date}`
  return rows<{ subject: string; paying: number; payingTotal: number; sessions: number }>(
    `WITH (SELECT count() FROM (${paying})) AS paying_total
     SELECT subject, uniqExactIf(session_id, paid) AS paying, paying_total AS payingTotal,
            uniqExact(session_id) AS sessions
     FROM (
       SELECT session_id, if(name = 'pageview', pathname, name) AS subject,
              session_id IN (${paying}) AS paid
       FROM events
       WHERE ${inRange} AND name != 'click'
     )
     GROUP BY subject HAVING paying > 0
     ORDER BY paying DESC, sessions ASC LIMIT ${PAID}`,
    params,
  )
}

function normalize(item: Item): Item {
  for (const key of ['visitors', 'pages', 'paying', 'payingTotal', 'sessions'] as const)
    if (key in item && typeof (item as Record<string, unknown>)[key] !== 'object')
      (item as Record<string, unknown>)[key] = Number((item as Record<string, unknown>)[key])
  return item
}

/** One line per item, as the model reads it and as claims are checked against. */
export function describeItem(item: Item): string {
  switch (item.kind) {
    case 'page':
      return `${item.id} page ${item.path}${item.title ? ` "${item.title}"` : ''}: ${item.visitors} visitors`
    case 'pattern':
      return `${item.id} pages ${item.path} (${item.pages} paths): ${item.visitors} visitors`
    case 'pageType':
      return `${item.id} page type "${item.type}": ${item.visitors} visitors`
    case 'click': {
      const what = [
        item.text && `text "${item.text}"`,
        item.label && `label "${item.label}"`,
        item.section && `section "${item.section}"`,
        item.href && `href ${item.href}`,
      ]
        .filter(Boolean)
        .join(', ')
      return `${item.id} click <${item.tag}> ${what}, on ${item.pages.join(' ')}: ${item.visitors} visitors`
    }
    case 'event':
      return `${item.id} custom event "${item.name}"${item.props.length ? ` (props: ${item.props.join(', ')})` : ''}: ${item.visitors} visitors`
    case 'paid':
      return `${item.id} ${item.subject.startsWith('/') ? 'page' : 'event'} ${item.subject}: in ${item.paying} of ${item.payingTotal} sessions with a new payment, ${item.sessions} sessions overall`
  }
}
