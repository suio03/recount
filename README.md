# Recount

Self-hosted web analytics with an AI layer underneath, for one owner running many sites.

The dashboard shows exact numbers: visitors, sources, pages, goals and revenue. Underneath, an
optional AI layer reads the same data and says what changed and why, summarizes notable recorded
sessions, and finds what several visitors had in common. The model never produces a number. Code
counts everything, and the model only explains what the code found. Claims that quote a figure
the data does not contain are dropped.

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
cp .env.example .env            # then set ADMIN_TOKEN (openssl rand -hex 24)
pnpm db:up                      # PostgreSQL :5442, ClickHouse :8133
pnpm migrate
pnpm --filter @recount/tracker build
pnpm seed                       # optional: a demo site with sample traffic
pnpm dev                        # API :8787, web :5173
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`.

### Configuration

| Variable | Default | What |
|---|---|---|
| `ADMIN_TOKEN` | required | Bearer token for the private API, at least 24 characters |
| `DATABASE_URL`, `CLICKHOUSE_*` | see `.env.example` | Database connections |
| `PUBLIC_URL` | `http://localhost:8787` | Where the API is reached; the dev dashboard proxies to it |
| `ANTHROPIC_API_KEY` | unset | Enables AI analysis. Without it, AI-enabled sites show only the detected changes |
| `READING_MODEL` | `claude-sonnet-5-5` | Model for readings and cross-session patterns |
| `REPLAY_MODEL` | `claude-haiku-5-5` | Model for single-session summaries |
| `REPLAY_SUMMARIES_PER_DAY` | `50` | Session summaries per site per day (UTC); `0` turns the job off |

## Adding a site

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"domain":"example.com","timezone":"Europe/Berlin"}' localhost:8787/api/sites
```

Add `"ai": true` to turn AI analysis on from the start, or flip the switch next to the site name
in the dashboard later.

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

### Revenue

Put `recount.ids()` in the checkout's custom data (Paddle `customData`), then connect the account
whose API key is in an environment variable:

```sh
pnpm --filter @recount/api revenue connect example.com paddle PADDLE_API_KEY [key=value ...]
pnpm --filter @recount/api revenue sync
```

The optional `key=value` pairs keep only transactions whose custom data matches, for an account
shared by several products.

### Replay

Recording starts when `data-replay` is above `0`. Sessions are extracted into timelines after they
end; with AI analysis on, notable ones are summarized every five minutes. To work with them by
hand:

```sh
pnpm --filter @recount/api replay extract [domain]
pnpm --filter @recount/api replay show <domain> [session]
pnpm --filter @recount/api replay summarize <domain> [session]
```

## License

AGPL-3.0. See [LICENSE](LICENSE).
