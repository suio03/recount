# One image: the API, which also serves the built dashboard and tracker. Configuration and
# secrets come from the environment at run time; nothing secret is built in.

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @recount/tracker build \
 && pnpm --filter @recount/web build \
 && pnpm --filter @recount/api build \
 && pnpm --filter @recount/api deploy --prod --legacy /out \
 && rm -rf /out/dist && cp -r apps/api/dist /out/dist \
 && mkdir -p /out/public \
 && cp -r packages/tracker/dist /out/public/js \
 && cp -r apps/web/dist /out/public/web

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    TRACKER_DIST=/app/public/js \
    WEB_DIST=/app/public/web
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
# Migrations are idempotent, so every start applies whatever is new before serving.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/server.js"]
