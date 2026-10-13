# Recount

Self-hosted web analytics with an AI layer underneath. The dashboard shows exact numbers; the AI
layer reads the same data plus a semantic description of each site and explains what changed,
why, and what to do about it.

Status: early skeleton. Ingestion, identity, the semantic layer types and a minimal dashboard work
end to end. See [docs/architecture.md](docs/architecture.md) for the design and roadmap.

## Layout

| Path | What |
|---|---|
| `apps/api` | Hono API on Node: event ingestion, tracker serving, private stats API, migrations |
| `apps/web` | Vite + React dashboard |
| `packages/tracker` | Browser tracker (`/js/script.js`, ~1.6 KB gzip) |
| `packages/shared` | Wire formats shared by tracker and API (Zod) |
| `packages/semantic` | Types for event catalogs and metric definitions |
| `sites/` | Semantic definitions of each tracked site |
| `infra/` | Local development databases |

## Development

Requires Node 24 (`.nvmrc`), pnpm 10 and Docker.

```sh
pnpm install
cp .env.example .env            # then set ADMIN_TOKEN (openssl rand -hex 24)
pnpm db:up                      # PostgreSQL :5442, ClickHouse :8133
pnpm migrate
pnpm --filter @recount/tracker build
pnpm dev                        # API :8787, web :5173
```

Add a site:

```sh
curl -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"domain":"example.com","timezone":"Europe/Berlin"}' localhost:8787/api/sites
```

Then add the tracker to that site:

```html
<script defer src="https://<recount-host>/js/script.js" data-site="example.com"></script>
```

AI analysis (the dashboard reading, replay summaries and the patterns across them) is off for a
new site. Turn it on with the switch next to the site name, or add `"ai": true` when creating it.

Custom events are `recount('Signup', { props: { plan: 'pro' } })`. Coming from Plausible, add
`data-compat="plausible"` once the Plausible script is removed, and existing `plausible(...)`
calls, queued ones included, are sent to Recount unchanged.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm lint`.

## License

AGPL-3.0. See [LICENSE](LICENSE).
