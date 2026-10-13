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
4. **Personal use, open source.** Single owner, many sites. No multi-tenant billing.

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

## Storage

- ClickHouse: `events` (pageviews, clicks, custom events with semantic context), `ai_crawls`;
  later `interactions` (replay-derived timeline).
- PostgreSQL: sites, salts; later users, goals, funnels, payment connections and transactions,
  AI insights.
- Object storage (R2 or MinIO): raw session recordings, sampled and expiring.

## Roadmap

1. **Foundation** (done in skeleton): tracker, ingestion, identity, channels, main stats, web shell.
2. **Dashboard**: breakdowns (source, page, location, device), goals, funnels, revenue bars, visx
   charts, geo database (DB-IP Lite), auth.
3. **Data migration**: import `events_v2`/`sessions_v2` and the payment ledger from the Plausible
   fork. Imported history is cookieless (daily hashes).
4. **Revenue**: Paddle/Creem sync with visitor attribution.
5. **AI layer**: semantic catalog loading, change detection, Claude-written digests and dashboard
   annotations, MCP server for questions.
6. **Session recording**: rrweb recorder (lazy, sampled, masked), timeline extraction (rage/dead
   clicks, hesitation, form abandonment, errors), per-session and cross-session AI summaries
   linking back to replay timestamps.
7. **AI crawlers**: Cloudflare Worker reporting to `ai_crawls`, IP verification.

## Known gaps in the skeleton

- Country comes from Cloudflare's `cf-ipcountry` header only; region and city are empty.
- Cookieless sessions live in API process memory; a restart starts new sessions.
- One secret (`ADMIN_TOKEN`) guards the private API: scripts send it as a bearer token, and the
  dashboard trades it for a session cookie. There are no user accounts.
- SPA pageviews fire on `pushState` before the new page sets its title.
