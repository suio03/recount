# Architecture

Decided 2026-10-13. Recount is a from-scratch rewrite; it shares no code with the Plausible fork it
replaces (`../analytics`), whose data will be migrated.

## Principles

1. **Two layers.** The dashboard (styled after datafa.st) is the surface and shows exact numbers.
   Underneath, AI explains changes, reads journeys and session recordings, and suggests actions.
   AI findings appear inside the dashboard (chart annotations, panel notes, visitor summaries) and
   in digests, not on a separate page.
2. **Numbers come from the database, never from the model.** The AI layer calls query tools and
   cites the queries behind every claim. Deterministic jobs detect changes first; AI explains them.
3. **Record behavior first, decide its meaning later** (decided 2026-10-14). Plausible-style tools
   start from a tracking plan: an event added by hand for each action, then goals defined around
   them. Recount captures pageviews and every click with page type, element text, section and
   link, so goals, funnels and metrics are rules applied when stats are read, and a definition
   made today counts past visits too. Code is asked for only where the browser cannot see the
   outcome (a signup confirmed by the server, a payment without a connected provider) or for
   business properties (plan, amount). The aim is that people rarely define anything by hand:
   the AI layer drafts what conversion means for a site from its data, code checks every draft
   against real counts, and people correct it where they disagree. Each site's event catalog and
   metric definitions in `sites/` add meaning code alone cannot infer.

   The cost: rules over element text can break when a page changes its copy, so match counts are
   watched; capturing every click means more events to store; and the masking rules (typed values
   never sent, `data-rc-mask`, masked replay copy, query strings stripped) carry more weight.
4. **One codebase, two ways to run it** (decided 2026-10-14, the Plausible model). Anyone can
   self-host the open-source image; people who would rather not run servers use the hosted
   service. Both run the same code: accounts, teams and per-site roles exist in both, and the
   hosted service adds sign-up, billing and usage limits behind configuration. A self-hosted
   instance has no billing and no limits. The license stays MIT: the code is not the moat, since
   anyone can rebuild it; the hosted service, its uptime and the trust of its users are.
5. **Everything in the dashboard.** Adding a site, checking the install, connecting revenue,
   setting replay and AI options and inviting people happen in the UI. CLIs stay for scripting,
   not as the only way to do something.

## Identity

- Cookie mode (default): the tracker keeps `rc_vid` (random UUID, 365 days) and `rc_sid`
  (30 minutes, sliding) on the registrable domain. The API stores `hash(site, id)`.
- Cookieless mode (`data-mode="cookieless"`): no cookies; the API hashes daily salt + site + IP +
  user agent. Salts older than a day are deleted, so visitors cannot be linked across days.
- User, Journey and revenue attribution need cookie mode. A consent banner may be required in
  some jurisdictions.

## Attribution

Each visitor will store both first touch and last non-direct touch. Dashboards default to last
non-direct touch. Payments link to visitors by passing `rc_vid` in checkout metadata (Paddle
`custom_data`, Creem `metadata`).

## Accounts and tenancy

- `users` sign in with email and password (scrypt). `orgs` own sites; `memberships` give a user a
  role in an org: owner, admin or viewer. `invites` add people by email through a one-time link
  that lasts 7 days. Sessions are random tokens in a cookie, stored as hashes.
- Email (SMTP or Resend) is optional and not built yet; it will send invites, password resets and
  address checks. Until then invites are links to copy and resets go through the `user` CLI.
- Every private API call is scoped to the caller's orgs. Events in ClickHouse are already keyed
  by site, so isolation is a check on site ownership, not a new storage layout.
- API keys (`rc_...`) act as an admin of their org; scripts use them. There is no server-wide
  secret: the first account is created in the dashboard with a one-time setup code printed in
  the server log, so a stranger cannot claim a fresh install.
- Third-party secrets (Paddle keys, later Creem) are entered in the dashboard and stored sealed
  with AES-256-GCM under `ENCRYPTION_KEY`, instead of naming an environment variable per source.
- A site can have a public read-only dashboard at `/share/<token>`, created and turned off by
  its admins. It serves the main stats, breakdowns, goals and funnels only: no AI brief,
  since each costs a model call, and no recordings.

## Hosted service

- Plans meter pageviews per month, recorded sessions and AI summaries per org. Usage is counted
  from ClickHouse; over the limit, ingestion keeps working for a grace period and then stops.
- Billing through Paddle. Off unless configured, so self-hosted instances never see it.
- Needs a privacy policy, a data processing agreement and account deletion that removes events
  and recordings. Session replay records other sites' visitors, so masking stays on by default.
- AI on the hosted service uses our model key within plan limits; self-hosters bring their own.

## Storage

- ClickHouse: `events` (pageviews, clicks, custom events with semantic context), `ai_crawls`,
  `payments`, `replay_chunks` (raw rrweb batches, kept 30 days) and `replay_sessions`
  (extracted timelines, kept 180 days).
- PostgreSQL: accounts, sites, salts, revenue sources, cached readings and replay summaries,
  the AI usage log, goals and funnels. Goal and funnel rules are applied when stats are queried,
  so a new goal counts past visits too.

## Roadmap

Updated 2026-10-16.

Done:

1. **Foundation**: tracker, ingestion, identity, channels, main stats, filterable dashboard.
2. **Dashboard**: breakdowns (source, page, location, device), goals from custom events, sign-in.
3. **Revenue**: Paddle sync with visitor attribution, revenue panel and chart.
4. **AI layer**: change detection, Claude-written readings with chart annotations, per-site
   switch.
5. **Session recording**: masked, sampled rrweb recorder; timeline extraction (rage and dead
   clicks, form abandonment, errors); per-session summaries linking to replay timestamps;
   cross-session patterns.
6. **Shipping**: single-container image, CI publishing to GHCR and deploying through a Dokploy
   webhook, body limits and sign-in rate limits.
7. **First deploy**: Recount, PostgreSQL 17 and ClickHouse 25.8 on Dokploy; sites switched over
   from Plausible.
8. **Data migration**: history imported from the Plausible fork, one month at a time. Imported
   history is cookieless (daily hashes).
9. **Accounts and teams**: email and password, orgs with owner, admin and viewer roles, invite
   links, API keys; the private API is scoped by org.
10. **Site management in the dashboard**: adding and deleting sites, the install snippet with a
    first-event check, site settings, connecting Paddle with an encrypted key, public links.
11. **Usage and AI cost control**: a log of every model call with tokens and cost, a daily AI
    budget per org, admin-only rewrites, monthly usage per site under Account.
12. **Goals and funnels**: goals defined in site settings as a page visit or a click rule
    (element text or label, section, page, link address), usable as filters; funnels of goals,
    custom events and pages, counted in order within one visit, on the dashboard and public links.
13. **Event properties**: a custom event in Goals opens to the properties it carries, each with
    its values by visitors and events; a property whose values are all numbers also shows its
    median, middle half, range and a histogram over events. A value filters the dashboard
    (`prop=<key>=<value>`) to sessions with an event carrying it, whatever the event.
14. **Semantics drafted by AI**: on each site's schedule (daily or weekly) or with "Draft now",
    code lists what the site's data holds and the model drafts goals and funnels with the
    evidence behind each; code drops drafts that match nothing. Drafts are stored per site (the
    last 10) and reviewed under "Drafted by AI" in site settings, or apply on their own; a name a
    person removed or turned down is never added again, and an existing rule is never replaced.
    Readings and replay summaries use the latest draft where `sites/` has no catalog. Built-in
    questions ("Traffic", "Conversion", "Best channel") are answered (over MCP since the brief
    replaced the reading panel) from fixed queries, stating the definition code used. Tracking gaps start from blind-spot signals
    in the last 30 days (long stays with little tracked, clicks on elements with no text,
    checkout with no payments, forms with nothing after them), each needing 10 visitors or
    sessions; the draft gives one gap per signal and at most 2 guesses, marked "Guess".

Next:

1. **Instrumentation by coding agents**: tracking rules published as `llms.txt` and a snippet for
   AGENTS.md; a server-side event endpoint authenticated with an API key, joined to the visitor
   through the id passed from the browser, as with `recount.ids()`; an MCP server with
   `get_install`, `get_tracking_rules`, `list_tracking_gaps`, `define_event`, `verify_event` and
   the question tools, so an agent implements a gap, checks the event arrives and registers its
   meaning. Its keys read data and write definitions only, and the server rejects properties
   that look like personal data. Started 2026-10-16: key scopes (admin, agent, ingest),
   `/api/server/events`, personal-data checks on every ingest path, an `event_definitions` table
   read with the catalog, `/llms.txt`, the stateless MCP server at `/mcp` with those tools and
   `answer_question`, and a Coding agents panel in site settings. Still to do: a coding agent's
   full run on a real site, and editing definitions in the dashboard.
2. **Data-first dashboard** (planned 2026-10-16; design: board "scribix.io — data first" in the
   Recount Redesign canvas). The dashboard is still a Plausible layout: KPIs, a chart, then
   tables the owner reads to answer two daily questions: did something break, and did anyone
   try to pay. The site page becomes one page, in this order: an on-click brief, traffic, the
   people who tried to pay, paths with events that went quiet, an ask box, then links to the
   reports. There is no separate "brief mode". Every number still comes from a query.
   - **Traffic.** Four totals:
     - visitors, against the previous period
     - today so far, against a usual day: the median daily visitors over the 28 days before the range
     - signed in: the site's activation event
     - tried to pay → paid
     Below them is the daily chart for 30 days with the usual line. A dot marks the days someone tried to pay; clicking a day lists that day's counts. Sources sit beside the chart, with the paths to payment noted on their rows. `main` gains `usual`. The markers come from code, so opening the page makes no model call.
   - **Tried to pay.** One card for each visitor in range who sent a pay-intent event, newest first, at most 20:
     - country, device and browser, source, entry page, day
     - their events in time order, with pay events in orange and failures in red
     - how it ended: paid, failed, closed, or nothing after
     Which events mean "started paying", "paid" and "failed" is a per-site setting. The semantics draft proposes it, and site settings correct it. Without a draft, code proposes events whose names contain checkout, upgrade, pricing, paywall or subscribe, and failure events whose names contain fail, error, closed or dismissed. "Paid" comes from a connected provider's payments when there is one, else from the paid event. Built as `GET /stats/intent` on the per-visitor event query that visitor journeys (next item) also uses, so "Full journey" opens the journey.
   - **Paths.** These replace the Goal Conversions table and the funnel panel. Each lane is a funnel of up to 5 steps:
     - per step: the visitors who did it, last period's count in grey, and the share kept from the previous step
     - per lane: its side events (dismissals, failures) with their counts
     The steps are ordered per visitor within the range, not within one visit, because people sign in on one visit and pay on another. In cookieless mode this collapses to one day. Funnels everywhere now count this way, including the funnel panel and `GET /stats/funnel`. Lanes come from the site's funnels, then from the drafted ones still waiting for review, up to 4. The draft prompt asks for up to 4 funnels covering the main flows, one of them ending at payment. Side events are chosen by code, not drafted: the site's failed and closed key events plus any event whose name reads as a fault, counted among the visitors who reached the lane's first step, leaving out the lane's own steps. When no funnel is defined and nothing is drafted, the section falls back to the event list, with a prompt to add funnels and to have AI draft them, or to turn AI on.
   - **Went quiet.** Code-detected, no model involved: a custom event that has been 0 for 2 to 30 full days up to the last full day, and before it stopped fired on at least 10 of 14 days at 2 or more a day on average. Firing today rules it out. It is site-wide, whatever the filters. Each row shows the event, one sentence written by code, and its last 7 days. It sits under the paths because a broken tag looks the same as a broken feature.
   - **Brief.** This replaces the reading panel. It is written only when an admin clicks "Write the brief", never on open, and needs the AI switch and the budget. It reads the whole site whatever the filters, so following a line's filters keeps it on screen. It is cached per site and range in `readings` until it is rewritten, and shown to everyone. Code writes the facts: the tried-to-pay totals and up to 8 people with their events, each lane per step, the quiet events, the traffic totals with today against a usual day, and the detected changes with their filters. The model writes 3–6 lines from them, each marked Fact or Guess and citing fact ids; code drops a line citing nothing known or quoting a number its facts lack, and links each line to the section of its first fact, with the filters of a cited change. Built as `GET /stats/brief` (the last one) and `POST /stats/brief` (write), in `brief/`. The automatic reading, its chart annotations and `GET /stats/reading` are gone; the built-in questions stay for MCP (`/stats/question`) and leave the UI until Ask. Replay summaries and semantics drafts keep their own schedules.
   - **Why?** A button on each lane and each person card, shown when AI is on and never on a public link. Pressing it shows the answer last written for that lane or visitor in the range; when there is none, an admin's press writes one, and "Ask again" rewrites it. Answers are kept in `readings` per site, range and subject, and a lane's also per filters, since a lane is counted under them while a visitor's events are read whatever they are. Code writes the facts. For a lane: each step now and before, the steps split by device, channel and browser (the 4 values with most starters), its side events with the property values they carried, and, at the step most people did not get past, how many stopped there, the custom events they sent and the last page they viewed. For a visitor: who they are and how it ended, every event of their latest 5 visits in order with properties, click text and time since the visit started, and how many visitors across the site sent each of their failure and give-up events, now and before. The model answers in 2–5 Fact or Guess lines, vetted like the brief's, and may end with one check that would tell its guesses apart. Built as `GET /stats/why` and `POST /stats/why` (admins) with `lane=<name>` or `visitor=<id>`, in `why/`.
   - **Ask.** A free question. It needs a model loop over read-only query tools, the same ones MCP exposes, so a question's numbers come from queries too. Built last.
   - **Reports.** The existing panels (breakdowns, goals, funnels, event properties, sessions) move unchanged to a Reports view linked at the bottom. Filters set anywhere apply to the whole page.
   - **All sites.** The sites list shows each site's visitors per day over 30 days in its timezone with a usual day dashed across, this week's visitors against the week before, today so far, and who tried to pay and paid this week when payment events are known. Code flags what needs a look, no model involved: nothing yesterday or today on a site whose usual day is 10 or more, yesterday under half of a usual day (or over twice it, shown but weighed lightly), events gone quiet, and people who tried to pay without paying. The list is sorted by those flags, then by who tried to pay, then by visitors, and says how many sites need a look. Built as `GET /api/activity` in `stats/activity.ts`, refetched every 5 minutes.
   - Order:
     1. traffic and tried-to-pay, since that is the daily habit (built: `/stats/intent`, per-site `key_events` in migration 0015, the Key events settings panel)
     2. paths and went quiet (built: `/stats/paths`, `stats/paths.ts`, `stats/quiet.ts`)
     3. the on-click brief, removing the automatic reading (built: `/stats/brief`, `brief/`)
     4. Why? (built: `/stats/why`, `why/`)
     5. all sites (built: `/api/activity`, `stats/activity.ts`)
     6. Ask
3. **Payment providers**: Stripe, Lemon Squeezy and Creem next to Paddle, each connected in site settings with a read-only key sealed under `ENCRYPTION_KEY`. Each is synced on the schedule Paddle uses into the same `payments` table, refunds included, and joined to the visitor by `recount_vid` and `recount_sid` in checkout metadata:
   - Stripe: `metadata` on the Checkout Session or PaymentIntent
   - Lemon Squeezy: `checkout_data.custom`
   - Creem: `metadata`
   `syncSource` dispatches on `provider` instead of refusing anything but Paddle. The tracking rules and the Coding agents panel say how to pass the ids for each provider. Once a provider is connected, "paid" on the dashboard comes from it rather than from events.
4. **Visitor journeys** (planned 2026-10-15): one visitor's visits in order, each as its pages,
   clicks and custom events with their properties and times, opened from any breakdown row,
   goal or funnel step to see the people behind a number. Works for every visitor, not only
   recorded sessions, since it reads events; recordings, where they exist, link from the visit.
   Needs cookie mode to join visits; in cookieless mode it shows one day.
5. **Hosted service**: email sending, sign-up, plans and Paddle billing, limits, account deletion, landing page,
   docs site, privacy policy and DPA.
6. **Search data from Google Search Console and Bing Webmaster** (planned 2026-10-15): clicks,
   impressions, CTR and position for the queries and landing pages behind organic search, joined
   to Recount by landing page so a query's ranking sits next to what its visitors did afterwards.
   - Google: the Search Analytics API, read with the `webmasters.readonly` scope. Each day is
     fetched on its own as date × query × page, paged with `startRow`, one search type at a time.
     The first sync backfills the 16 months Google keeps; later syncs read with `dataState=all`
     and refetch from `first_incomplete_date`, since recent days keep changing for 2–3 days.
   - What the dashboard must say: Google returns only the top rows (at most 50,000 a day per
     search type, by clicks), so long-tail totals are a floor; its days are Pacific Time, not the
     site's time zone; and totals by query, country or device count per property while totals by
     page count per page, so the two are never added together.
   - Bing: OAuth (`webmaster.read`) or a pasted API key, which covers every site the user has
     verified. Its query and page stats take no date range and update weekly, so Bing gets its
     own weekly view of top queries and pages. Query × page comes one row at a time
     (`GetQueryPageStats`, `GetPageQueryStats`), so it is fetched when a row is opened, not
     synced.
   - Credentials: the hosted service uses one Google and one Bing OAuth app of ours. A
     self-hosted instance cannot use them (redirect URLs are fixed to our domain, and an
     open-source image cannot carry our secret), so self-hosters register their own Google app
     and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; for Bing they can paste an API key
     instead. Tokens are sealed under `ENCRYPTION_KEY`, as Paddle keys are. Authorization is
     never relayed through the hosted service.
   - Order: first a CLI that pulls one real site's history, to settle how Google's page URLs map
     to Recount pathnames (domain and URL-prefix properties, http and https, `www`, query strings
     and fragments) and how much the row limits cut; then storage and the scheduled sync; then
     connecting in the dashboard and the Search panel; then publishing the hosted OAuth app,
     which needs the privacy policy and home page from the hosted service; Bing last. It comes
     after the hosted service because Google keeps 16 months, so waiting loses no data.
7. **Geo database**: DB-IP Lite for country, region and city without Cloudflare.
8. **Attribution**: first touch next to last non-direct touch.
9. **Digests**: periodic email digests.
10. **AI crawlers**: Cloudflare Worker reporting to `ai_crawls`, IP verification.
11. **A/B tests**: a variant reported by the site's own split, compared by code on the drafted
   conversion with confidence intervals, explained by the model.

## Known gaps in the skeleton

- Country comes from Cloudflare's `cf-ipcountry` header, read only with `TRUST_CF_HEADERS`;
  region and city are empty.
- Cookieless sessions live in API process memory; a restart starts new sessions.
- No email yet: invites are links to copy, and forgotten passwords are reset with the `user` CLI.
- Sign-in rate limits live in process memory, which is enough for one instance.
