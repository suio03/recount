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
3. **Semantics from day one.** Events carry page type, element text and section; each site has an
   event catalog and metric definitions in `sites/`. Data recorded without meaning cannot get it
   back later.
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

Updated 2026-10-14.

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
    budget per org, admin-only rewrites, monthly usage per site in Settings.
12. **Goals and funnels**: goals defined in site settings as a page visit or a click rule
    (element text or label, section, page, link address), usable as filters; funnels of goals,
    custom events and pages, counted in order within one visit, on the dashboard and public links.

Next:

1. **Hosted service**: email sending, sign-up, plans and Paddle billing, limits, account deletion, landing page,
   docs site, privacy policy and DPA.
2. **Geo database**: DB-IP Lite for country, region and city without Cloudflare.
3. **Attribution**: first touch next to last non-direct touch; Creem sync.
4. **Questions and digests**: MCP server for asking about the data, periodic email digests.
5. **AI crawlers**: Cloudflare Worker reporting to `ai_crawls`, IP verification.

## Known gaps in the skeleton

- Country comes from Cloudflare's `cf-ipcountry` header, read only with `TRUST_CF_HEADERS`;
  region and city are empty.
- Cookieless sessions live in API process memory; a restart starts new sessions.
- No email yet: invites are links to copy, and forgotten passwords are reset with the `user` CLI.
- Sign-in rate limits live in process memory, which is enough for one instance.
- SPA pageviews fire on `pushState` before the new page sets its title.
