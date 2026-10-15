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
  its admins. It serves the main stats, breakdowns, goals and funnels only: no AI reading,
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

Updated 2026-10-15.

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

Next:

1. **Semantics drafted by AI, answers to common questions**: on a schedule each site picks (daily
   or weekly), code lists what the site's data holds (paths, page types, clicked elements by
   section, outbound domains, custom events) and the model drafts what conversion and the key
   paths are, as goals and funnels with the evidence behind each. Code drops drafts that match
   nothing; the rest apply on their own or wait for approval, per site, never overwriting what a
   person edited or removed. Semantics move from `sites/` into PostgreSQL, with `sites/` kept as
   overrides. Built-in questions (how is traffic, how is conversion, which channel brings the
   best visitors) are fixed queries the model explains, stating the definition used. Data the
   browser cannot see becomes a tracking gap: what is missing, why, and the line of code to add.
   Started: the inventory, the draft and its checks, run from the `semantics` CLI. The seed's
   `autocapture` demo has the same traffic as `demo` without custom events, to show what a draft
   finds from pageviews and clicks alone. Next: storing drafts, the schedule, applying them, the
   dashboard view, then the questions.
2. **Instrumentation by coding agents**: tracking rules published as `llms.txt` and a snippet for
   AGENTS.md; a server-side event endpoint authenticated with an API key, joined to the visitor
   through the id passed from the browser, as with `recount.ids()`; an MCP server with
   `get_install`, `get_tracking_rules`, `list_tracking_gaps`, `define_event`, `verify_event` and
   the question tools, so an agent implements a gap, checks the event arrives and registers its
   meaning. Its keys read data and write definitions only, and the server rejects properties
   that look like personal data.
3. **Hosted service**: email sending, sign-up, plans and Paddle billing, limits, account deletion, landing page,
   docs site, privacy policy and DPA.
4. **Search data from Google Search Console and Bing Webmaster** (planned 2026-10-15): clicks,
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
5. **Geo database**: DB-IP Lite for country, region and city without Cloudflare.
6. **Attribution**: first touch next to last non-direct touch; Creem sync.
7. **Digests**: periodic email digests.
8. **AI crawlers**: Cloudflare Worker reporting to `ai_crawls`, IP verification.
9. **A/B tests**: a variant reported by the site's own split, compared by code on the drafted
   conversion with confidence intervals, explained by the model.

## Known gaps in the skeleton

- Country comes from Cloudflare's `cf-ipcountry` header, read only with `TRUST_CF_HEADERS`;
  region and city are empty.
- Cookieless sessions live in API process memory; a restart starts new sessions.
- No email yet: invites are links to copy, and forgotten passwords are reset with the `user` CLI.
- Sign-in rate limits live in process memory, which is enough for one instance.
- SPA pageviews fire on `pushState` before the new page sets its title.
