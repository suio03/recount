-- Cached AI readings, one per site, range, filters, model and prompt version. Each row keeps the
-- findings it was written from, so evidence ids always resolve to the numbers the model saw.
CREATE TABLE IF NOT EXISTS readings (
    key           text PRIMARY KEY,
    site_id       uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    body          jsonb NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS readings_site_created ON readings (site_id, created_at);
