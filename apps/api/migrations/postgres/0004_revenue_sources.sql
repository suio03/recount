-- Where a site's payments come from. The provider key is never stored: `key_env` names the
-- environment variable that holds it. `match` keeps only the provider's records whose custom
-- data has these values, for a provider account that bills several products.
CREATE TABLE IF NOT EXISTS revenue_sources (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id       uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    provider      text NOT NULL CHECK (provider IN ('paddle', 'stripe')),
    key_env       text NOT NULL,
    match         jsonb NOT NULL DEFAULT '{}',
    synced_at     timestamptz,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, provider, key_env)
);
