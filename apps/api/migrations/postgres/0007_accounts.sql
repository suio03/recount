-- Accounts: people sign in with email and password, belong to orgs with a role, and orgs own
-- sites. Secrets (session cookies, invite links, API keys) are stored only as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL,
    name          text NOT NULL,
    -- scrypt, as `scrypt$N$r$p$salt$hash` with base64url salt and hash.
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS orgs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
    org_id        uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role          text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invites (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    email         text NOT NULL,
    role          text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    token_hash    bytea NOT NULL UNIQUE,
    invited_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invites_org_email ON invites (org_id, lower(email));

CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash    bytea PRIMARY KEY,
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at    timestamptz NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions (user_id);

-- For scripts. A key acts as an admin of its org.
CREATE TABLE IF NOT EXISTS api_keys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name          text NOT NULL,
    key_hash      bytea NOT NULL UNIQUE,
    -- The first characters of the key, so people can tell keys apart.
    prefix        text NOT NULL,
    created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    last_used_at  timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Sites from before accounts go to one org, which the first owner takes over at setup.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES orgs (id) ON DELETE CASCADE;
INSERT INTO orgs (name)
SELECT 'My sites' WHERE EXISTS (SELECT 1 FROM sites WHERE org_id IS NULL);
UPDATE sites SET org_id = (SELECT id FROM orgs ORDER BY created_at LIMIT 1) WHERE org_id IS NULL;
ALTER TABLE sites ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS sites_org ON sites (org_id);
