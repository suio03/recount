import { z } from 'zod'

/**
 * Wire format sent by the tracker to `POST /api/event`.
 * Keys are short because every byte goes over the network on each pageview.
 */
export const IdentityMode = z.enum(['cookie', 'cookieless'])
export type IdentityMode = z.infer<typeof IdentityMode>

const shortText = (max: number) => z.string().max(max)

/** The element a user interacted with. Text is already masked by the tracker. */
export const ElementContext = z.object({
  tag: shortText(16),
  text: shortText(120).optional(),
  label: shortText(120).optional(),
  href: shortText(2048).optional(),
  section: shortText(80).optional(),
})
export type ElementContext = z.infer<typeof ElementContext>

export const EventPayload = z.object({
  /** Site domain as configured in Recount, e.g. `ordalin.com`. */
  s: shortText(253),
  /** Event name. `pageview` and `click` are built in; anything else is a custom event. */
  n: shortText(120),
  /** Full page URL. */
  u: z.url().max(2048),
  r: shortText(2048).optional(),
  /** Page title and semantic page type (from `<meta name="recount:page-type">`). */
  t: shortText(300).optional(),
  pt: shortText(60).optional(),
  m: IdentityMode,
  /** Visitor and session ids, cookie mode only. */
  vid: z.uuid().optional(),
  sid: z.uuid().optional(),
  /** Screen width, language and IANA timezone. */
  w: z.number().int().nonnegative().max(20000).optional(),
  l: shortText(35).optional(),
  tz: shortText(64).optional(),
  /** Custom properties; values are stringified. */
  p: z.record(shortText(64), shortText(500)).optional(),
  el: ElementContext.optional(),
})
export type EventPayload = z.infer<typeof EventPayload>
