CREATE TABLE IF NOT EXISTS sites (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain        text NOT NULL UNIQUE,
    name          text NOT NULL,
    timezone      text NOT NULL DEFAULT 'UTC',
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Daily salts for cookieless visitor hashes. Rows older than two days are deleted, which makes
-- cookieless hashes impossible to link across days.
CREATE TABLE IF NOT EXISTS salts (
    day           date PRIMARY KEY,
    salt          bytea NOT NULL
);
