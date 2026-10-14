# Recount

Open-source web analytics with an AI layer underneath. Self-host it, or use the hosted service.

The dashboard shows exact numbers: visitors, sources, pages, goals and revenue. Underneath, an
optional AI layer reads the same data and says what changed and why, summarizes notable recorded
sessions, and finds what several visitors had in common. The model never produces a number. Code
counts everything, and the model only explains what the code found. Claims that quote a figure
the data does not contain are dropped.

Most analytics tools need a tracking plan first: decide what matters, add an event for each
action, then define goals around them. Recount records behavior first and decides what it means
later. The script alone captures pageviews and every click with its text, page section and link,
so most goals and funnels are rules over data already recorded, and a rule defined today counts
past visits too. Code is needed only for what a browser cannot see, such as a signup confirmed by
the server, or for business details like the plan chosen.

Status: in daily development, replacing a Plausible CE fork. See
[docs/architecture.md](docs/architecture.md) for the design and roadmap.

## What it does

- **Tracking.** A 2 KB (gzip) script with cookie or cookieless identity, custom events, outbound
  and element clicks with their text and page section, and SPA navigation. A site moving off
  Plausible keeps its existing `plausible(...)` calls.
- **Dashboard.** Visitors and pageviews over time, sources and channels (AI assistants included),
  pages, locations, devices, goals, and filters that apply to every panel.
- **Revenue.** Paddle transactions are synced and attributed to the visitor who paid, through
  the visitor id put in the checkout's custom data.
- **Session replay.** An rrweb recorder that loads only for sampled sessions. Typed values are
  never recorded, page copy is masked, and query strings are stripped.
- **AI analysis** (per site, off by default):
  - *Reading:* the changes code detected for the selected range and filters, explained in a few
    sentences (Claude Sonnet).
  - *Session summaries:* a background job picks notable sessions (paid, abandoned form, error,
    rage or dead clicks, key event) and summarizes each one with timestamped moments that open
    the replay at that point (Claude Haiku, 50 sessions per site per day by default).
  - *Patterns:* friction, intent and paths shared by several summarized sessions, each backed
    by the sessions it rests on.

Every model call is logged with its tokens and estimated cost. **Account → Usage** shows each
site's pageviews, recordings, AI calls and AI cost per month, and today's spend against the
daily budget (`AI_DAILY_BUDGET_USD`). Only admins can ask for a reading or patterns to be
rewritten.

A wiki or reference site usually needs none of the AI part. Leave it off and the dashboard still
lists what changed, computed without a model call.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono API on Node: ingestion, tracker serving, stats, AI jobs, migrations, CLIs |
| `apps/web` | Vite + React dashboard |
| `packages/tracker` | Browser tracker (`/js/script.js`) and replay recorder (`/js/replay.js`) |
| `packages/shared` | Wire formats shared by tracker and API (Zod) |
| `packages/semantic` | Types for each site's event catalog and metric definitions |
| `sites/` | Semantic definitions of tracked sites, which give the AI layer context |
| `infra/` | Local development databases |

Events and recordings are stored in ClickHouse; sites, revenue sources and cached AI output in
PostgreSQL.

## Development

Requires Node 24 (`.nvmrc`), pnpm 10 and Docker.

```sh
pnpm install
cp .env.example .env
pnpm db:up                      # PostgreSQL :5442, ClickHouse :8133
pnpm migrate
pnpm --filter @recount/tracker build
pnpm seed                       # optional: a demo site with sample traffic
pnpm dev                        # API :8787, web :5173
```

Open the dashboard and create the owner account with the setup code the API prints at startup.
To skip the sign-in from then on, put that account's email in `DEV_AUTO_LOGIN` in `.env`.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`.

### Configuration

| Variable | Default | What |
|---|---|---|
| `DATABASE_URL`, `CLICKHOUSE_*` | see `.env.example` | Database connections |
| `PUBLIC_URL` | `http://localhost:8787` | Where the API is reached; the dev dashboard proxies to it |
| `ENCRYPTION_KEY` | unset | Encrypts payment provider keys entered in the dashboard. Any random string of 32+ characters, e.g. `openssl rand -base64 32`. Changing it makes stored keys unreadable |
| `ANTHROPIC_API_KEY` | unset | Enables AI analysis. Without it, AI-enabled sites show only the detected changes |
| `READING_MODEL` | `claude-sonnet-5-5` | Model for readings and cross-session patterns |
| `REPLAY_MODEL` | `claude-haiku-5-5` | Model for single-session summaries |
| `REPLAY_SUMMARIES_PER_DAY` | `50` | Session summaries per site per day (UTC); `0` turns the job off |
| `AI_DAILY_BUDGET_USD` | `5` | What each team may spend on model calls per day (UTC). Past it, readings, summaries and patterns wait for the next day and cached ones stay; `0` stops all calls |
| `DEV_AUTO_LOGIN` | unset | Development only: browsers on the same machine are signed in as this account without a password. Ignored when `NODE_ENV` is `production` (as in the image) and for requests from other machines. Signing out shows the sign-in form until the next sign-in |
| `TRUST_CF_HEADERS` | `false` | Take the visitor's address and country from Cloudflare's headers. Set it only when Cloudflare proxies every request; otherwise the address comes from `X-Forwarded-For` and there is no country |

## Adding a site

In the dashboard, pick **Add a site…** in the site menu (with no sites yet, the form is shown
straight away). The site's settings then show the script tag to paste, built from the options
below, and say when the first pageview arrives. **Site settings** also changes the name,
timezone and currency, and deletes a site with everything recorded for it. **Public link**
there gives a read-only dashboard anyone can open without signing in, at `/share/<token>`; it
shows the numbers, revenue included, but not the AI reading or recordings. A new link stops the
old one.

Scripts can do the same with an API key from Account → API keys:

```sh
curl -H "Authorization: Bearer $RECOUNT_KEY" -H 'content-type: application/json' \
  -d '{"domain":"example.com","timezone":"Europe/Berlin"}' https://<recount-host>/api/sites
```

The site joins the key's team. Signed in as a person in several teams, add `"org": "<org id>"`.
`"ai": true` turns AI analysis on from the start; `PATCH /api/sites/<id>` changes `name`,
`timezone`, `currency` or `ai`, and `DELETE /api/sites/<id>` deletes the site.

Then add the tracker to the site:

```html
<script defer src="https://<recount-host>/js/script.js" data-site="example.com"></script>
```

| Attribute | What |
|---|---|
| `data-site` | Site domain as configured in Recount. Defaults to the page hostname |
| `data-api` | Event endpoint. Defaults to `/api/event` on the script's origin |
| `data-mode` | `cookie` (default) keeps a first-party visitor id for journeys and revenue; `cookieless` sets nothing and hashes IP and user agent with a daily salt |
| `data-replay` | Share of sessions to record, `0` to `1` (default `0`). Cookie mode only |
| `data-compat` | `plausible` also answers `plausible(...)` calls. Set it only once the Plausible script is removed |

### Custom events

```js
recount('Signup', { props: { plan: 'pro' }, callback })
```

To call `recount` before the deferred script loads, define a queue first:

```html
<script>window.recount=window.recount||function(){(window.recount.q=window.recount.q||[]).push(arguments)}</script>
```

Most clicks need no code. Every link and button click is recorded with its text and page section,
and markup can add meaning:

| Markup | What |
|---|---|
| `data-rc-event="Name"` | Clicking the element sends a custom event with that name |
| `data-rc-section="Name"` | Names a region; clicks inside it carry the section name |
| `data-rc-mask` | Element text inside is never sent |
| `<meta name="recount:page-type" content="pricing">` | The page's semantic type |

### Goals and funnels

Custom events are goals already. In site settings, a goal can also be defined without changing
the site's code:

- **Page visit**: a path such as `/pricing`, where `*` stands for any characters (`/blog/*`).
- **Click**: text the button or link contains (also matched against its `aria-label`, without
  case), the section it is in, the page it is on, and part of the address it links to. Fill in
  at least one of text, section or link.

Rules apply when stats are read, so a goal defined today counts past visits too. A funnel lists
2 to 8 steps, each a goal, a custom event or a page, and counts the visitors who reach each step
in order within one visit.

### Revenue

Put `recount.ids()` in the checkout's custom data (Paddle `customData`), then connect the Paddle
account under **Site settings → Revenue** with an API key that has `transaction.read` and
`adjustment.read`. The key is checked with Paddle and stored encrypted with `ENCRYPTION_KEY`;
payments sync every 15 minutes. An optional custom-data filter (`project=example`) keeps only the
transactions of one product, for an account shared by several.

A key can also stay in an environment variable, connected from the command line:

```sh
pnpm --filter @recount/api revenue connect example.com paddle PADDLE_API_KEY [key=value ...]
pnpm --filter @recount/api revenue sync
```

### Replay

Recording starts when `data-replay` is above `0`. Sessions are extracted into timelines after they
end; with AI analysis on, notable ones are summarized every five minutes. To work with them by
hand:

```sh
pnpm --filter @recount/api replay extract [domain]
pnpm --filter @recount/api replay show <domain> [session]
pnpm --filter @recount/api replay summarize <domain> [session]
```

## Deployment

Every push to `main` that passes CI is published as a multi-platform image,
`ghcr.io/suio03/recount:latest` (plus `sha-<commit>`). One container serves the API, the dashboard
and the tracker on port 8787, and applies new migrations each time it starts. It needs PostgreSQL
17 and ClickHouse 25.8.

All configuration, secrets included, comes from the container's environment; the image holds
none. Behind a TLS proxy, open the dashboard and create the owner account. While there is no
account, the container prints a one-time setup code to its log (`No accounts yet ... setup code
XXXX-XXXX-XXXX-XXXX`), and the form asks for it, so only whoever runs the server can claim it; a
restart prints a new one. Sites that were there before accounts join the owner's team. Sign-ins
last 30 days.

To deploy automatically, put the deploy webhook of the app that runs the image (Dokploy, or
anything with one) in a `DOKPLOY_DEPLOY_URL` secret of the repository's `production`
environment. CI calls it once the new image is published. Without the secret, CI publishes the
image and stops there.

## Accounts

People sign in with email and password. Each team (org) owns sites and gives its members a role:
viewers see the dashboards, admins also manage sites, members, invites and API keys, owners also
give and take away ownership. Account → Team creates an invite link to send by hand; there is no
email sending yet. Someone who forgot their password asks whoever runs the server, who sets a new
one and signs that person out everywhere:

```sh
node dist/user.js password someone@example.com   # in the container; pnpm user password ... in dev
node dist/user.js list
```

## License

MIT. See [LICENSE](LICENSE).
