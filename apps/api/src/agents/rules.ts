import type { SiteSemantics } from '@recount/semantic'
import type { Context } from 'hono'
import { env } from '../env'

/**
 * The tracking rules a coding agent follows when it adds analytics to a site: what Recount
 * records already, when code is needed, how to name things, what never to send, and how to check
 * the result. Published at /llms.txt and returned by the MCP server's `get_tracking_rules`.
 */

/** This instance's public address: PUBLIC_URL, else the address the request came in on. */
export function originOf(c: Context) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, '')
  const url = new URL(c.req.url)
  const proto =
    c.req.header('X-Forwarded-Proto')?.split(',')[0]?.trim() || url.protocol.slice(0, -1)
  return `${proto}://${c.req.header('Host') || url.host}`
}

export const scriptTag = (origin: string, domain: string) =>
  `<script defer src="${origin}/js/script.js" data-site="${domain}"></script>`

export function trackingRules(origin: string) {
  return `# Recount tracking rules

> How to add analytics tracking to a website measured by Recount (${origin}). Written for coding agents; people are welcome too. Recount records behavior first and decides its meaning later, so most tracking needs no code at all.

## What is recorded already

The script records, with no code:

- Every pageview, single-page app navigations included, with path, title and the page type from \`<meta name="recount:page-type">\`.
- Every click on a link, a button or an element with \`role="button"\`: its text, aria-label or title, the page section it is in and the address it links to.
- Where visitors come from (referrer, UTM tags, ad click ids), their country and device.

Goals and funnels over pages and clicks are rules defined in Recount, and a rule defined today counts past visits too. So do not add an event for:

- A page being viewed, or a visitor reaching a confirmation page.
- A click on a link or button whose text says what it does ("Sign up", "Buy Pro", "Visit site").
- A link to another site.

## When to add code

Add code only where the browser cannot see the outcome, or for values the business needs:

1. **An outcome shown in place**: a form that succeeds without changing the page, a game started, a video played, a file exported. Send a custom event when it succeeds, in the success handler, not when the button is clicked.
2. **An outcome only the server knows**: a signup confirmed, an email verified, an order paid where no payment provider is connected to Recount. Send a server-side event (below).
3. **Business values**: the plan chosen, an amount, a category. Send them as properties of the event they describe.
4. **A button with no text** (an icon): put \`data-rc-event="Event Name"\` on it, so its clicks carry a name.

Before adding an event, check the events the site defines already (\`get_tracking_rules\` with the site, or \`list_tracking_gaps\`). Reuse a name rather than inventing a second one for the same thing.

## Naming

- Event names are Title Case, the thing then what happened to it, in the past tense: "Signup Completed", "Video Played", "Export Downloaded", "Plan Chosen". At most 120 characters. \`pageview\` and \`click\` are taken.
- Property keys are lower snake_case, at most 64 characters: \`plan\`, \`amount\`, \`video_id\`. At most 30 per event.
- Property values are strings of at most 500 characters; numbers and booleans are sent as text. Keep values to a small set of possibilities (a plan, a category), not one per visitor. Use the variable the code already holds, never a made-up literal.

## Never send personal data

No email addresses, names, phone numbers, postal or IP addresses, card numbers, account ids that identify a person, or text a visitor typed. Recount rejects server-side events that carry them and drops such properties from browser events. Put \`data-rc-mask\` on elements whose text is personal, such as an account menu showing an email, so their clicks carry no text.

## In the browser

The script tag, once in the \`<head>\` of every page:

\`\`\`html
<script defer src="${origin}/js/script.js" data-site="example.com"></script>
\`\`\`

A custom event:

\`\`\`js
recount('Signup Completed', { props: { plan: plan.id } })
\`\`\`

To call it before the deferred script has loaded, define this queue first, inline in the \`<head>\`:

\`\`\`html
<script>window.recount=window.recount||function(){(window.recount.q=window.recount.q||[]).push(arguments)}</script>
\`\`\`

Before leaving the page (a redirect right after the event), wait for the callback: \`recount('Checkout Started', { callback: () => location.assign(url) })\`.

Markup:

- \`data-rc-event="Event Name"\`: clicks on the element send that event.
- \`data-rc-section="Pricing"\`: names a region; clicks inside carry the section name.
- \`data-rc-mask\`: text inside is never sent.
- \`<meta name="recount:page-type" content="pricing">\`: the page's type.

## From the server

\`POST ${origin}/api/server/events\` with an API key scoped to ingestion, kept in the server's environment (for example \`RECOUNT_INGEST_KEY\`):

\`\`\`js
await fetch('${origin}/api/server/events', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.RECOUNT_INGEST_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    site: 'example.com',
    name: 'Signup Completed',
    ids, // what recount.ids() returned in the visitor's browser
    props: { plan: 'pro' },
  }),
})
\`\`\`

- \`ids\` joins the event to the visitor's visit. Get it in the browser with \`recount.ids()\` and pass it along with the form, the request or the checkout's custom data (\`{ recount_vid, recount_sid }\`). A server on the same domain can read the \`rc_vid\` and \`rc_sid\` cookies instead. In cookieless mode there are no ids, so server-side events cannot be joined.
- Optional \`timestamp\` (ISO 8601) for an event that happened earlier, up to 7 days back.
- Answers: 202 accepted; 400 with what is wrong; 401 or 403 for a missing or wrong key; 404 when the key's team has no such site; 422 when a property looks personal.
- Send it after the outcome is certain (the row is written, the payment captured), and never let a failed call break the request it belongs to.

## Checking your work

The script ignores \`localhost\` unless its tag has \`data-allow-localhost\`, and ignores automated browsers (\`navigator.webdriver\`). To see an event arrive, open the page in a normal browser on an address the script tracks, or send a server-side event, then check it with the MCP server's \`verify_event\`. Remove \`data-allow-localhost\` before shipping.

## Recount's MCP server

\`${origin}/mcp\` (Streamable HTTP), with \`Authorization: Bearer <key>\` using an API key scoped to agents. Such a key reads data and writes event definitions; it cannot change anything else. Tools:

- \`list_sites\`: the sites the key can see.
- \`get_install\`: the script tag for a site and whether events arrive.
- \`get_tracking_rules\`: these rules, with the events the site defines.
- \`list_tracking_gaps\`: what the data shows is not tracked, with the line of code to add for each.
- \`verify_event\`: whether an event arrived recently, with its properties.
- \`define_event\`: records what an event means and its properties, so reports use it.
- \`answer_question\`: how traffic, conversion or channels are doing, from fixed queries.

The loop: \`list_tracking_gaps\`, implement one gap, deploy or run the site, trigger it, \`verify_event\`, then \`define_event\` with what it means.
`
}

/** The events a site defines, for an agent working on it. */
export function siteSection(domain: string, semantics: SiteSemantics | undefined) {
  const lines = [`## This site: ${domain}`, '']
  if (semantics?.about) lines.push(semantics.about, '')
  if (semantics?.pageTypes && Object.keys(semantics.pageTypes).length) {
    lines.push('Page types:', '')
    for (const [type, meaning] of Object.entries(semantics.pageTypes))
      lines.push(`- \`${type}\`: ${meaning}`)
    lines.push('')
  }
  if (!semantics?.events.length) {
    lines.push('No custom events are defined yet.')
    return lines.join('\n')
  }
  lines.push('Custom events defined (reuse these names):', '')
  for (const e of semantics.events) {
    const flags = [e.key && 'key', e.stage].filter(Boolean).join(', ')
    lines.push(`- "${e.name}"${flags ? ` (${flags})` : ''}: ${e.description}`)
    for (const [key, p] of Object.entries(e.properties ?? {}))
      lines.push(`  - \`${key}\` (${p.type}): ${p.description}`)
  }
  return lines.join('\n')
}

/** The lines a site's AGENTS.md (or CLAUDE.md) carries, so any coding agent follows the rules. */
export function agentsSnippet(origin: string, domain: string) {
  return `## Analytics

This site is measured by Recount (${origin}) as \`${domain}\`. Before adding or changing analytics tracking, read ${origin}/llms.txt and follow it. In short:

- Pageviews and clicks on links and buttons are recorded already. Add code only for outcomes the browser cannot see and for business values such as the plan chosen.
- In the browser, \`recount('Event Name', { props: { ... } })\`; from the server, \`POST ${origin}/api/server/events\` with the ids from \`recount.ids()\`.
- Never send personal data: emails, names, phone numbers, text visitors typed.
- With Recount's MCP server connected (${origin}/mcp), start from \`list_tracking_gaps\`, check each new event with \`verify_event\`, then record what it means with \`define_event\`.
`
}
