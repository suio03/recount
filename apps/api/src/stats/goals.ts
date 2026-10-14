import { z } from 'zod'

/**
 * What a goal or funnel step matches among a site's events. Rules are read when stats are
 * queried, not when events arrive, so a goal defined today counts past visits too.
 *
 * - `event`: a custom event by name.
 * - `page`: a pageview whose path matches; `*` stands for any characters, `/` included.
 * - `click`: a click whose element text or label contains `text`, inside `section`, on a page
 *   matching `page`, linking to an address that contains `href`. Unset fields match anything.
 */
const Text = z.string().trim().min(1).max(120)
const Path = z.string().trim().max(500).regex(/^\//, 'Start the path with /')

export const EventMatch = z.object({ kind: z.literal('event'), name: Text })
export const PageMatch = z.object({ kind: z.literal('page'), path: Path })
export const ClickMatch = z
  .object({
    kind: z.literal('click'),
    text: Text.optional(),
    section: z.string().trim().min(1).max(80).optional(),
    page: Path.optional(),
    href: z.string().trim().min(1).max(500).optional(),
  })
  .refine((m) => m.text || m.section || m.href, 'Say which text, section or link the click is on')

/** What a defined goal matches. Custom events are goals already, without being defined. */
export const GoalMatch = z.discriminatedUnion('kind', [PageMatch, ClickMatch])
export const Match = z.discriminatedUnion('kind', [EventMatch, PageMatch, ClickMatch])

export type GoalMatch = z.infer<typeof GoalMatch>
export type Match = z.infer<typeof Match>

export interface GoalDefinition {
  name: string
  match: GoalMatch
}

/** Event names the tracker sends itself, which a defined goal may not take. */
export const BUILT_IN_EVENTS = ['pageview', 'click']

/** An anchored RE2 pattern for a path where `*` is any run of characters. */
export function pathPattern(path: string) {
  const escaped = path.replace(/[.+?^${}()|[\]\\*]/g, (c) => (c === '*' ? '.*' : `\\${c}`))
  return `^${escaped}$`
}

/**
 * A condition over the `events` columns, with values passed as query parameters named
 * `<prefix>_<field>`.
 */
export function matchSql(match: Match, prefix: string) {
  const params: Record<string, string> = {}
  const param = (field: string, value: string) => {
    params[`${prefix}_${field}`] = value
    return `{${prefix}_${field}:String}`
  }
  const conditions: string[] = []
  if (match.kind === 'event') conditions.push(`name = ${param('name', match.name)}`)
  else if (match.kind === 'page')
    conditions.push(
      `name = 'pageview'`,
      `match(pathname, ${param('path', pathPattern(match.path))})`,
    )
  else {
    // Clicks on elements marked with data-rc-event carry that name instead of `click`.
    conditions.push(`element_tag != ''`)
    if (match.text) {
      const text = param('text', match.text)
      conditions.push(
        `(positionCaseInsensitiveUTF8(element_text, ${text}) > 0 OR positionCaseInsensitiveUTF8(element_label, ${text}) > 0)`,
      )
    }
    if (match.section)
      conditions.push(`lowerUTF8(element_section) = lowerUTF8(${param('section', match.section)})`)
    if (match.page) conditions.push(`match(pathname, ${param('page', pathPattern(match.page))})`)
    if (match.href)
      conditions.push(`positionCaseInsensitive(element_href, ${param('href', match.href)}) > 0`)
  }
  return { sql: `(${conditions.join(' AND ')})`, params }
}
