-- Revenue sources connected in the dashboard keep their provider key in `key_cipher`, encrypted
-- with ENCRYPTION_KEY from the environment; sources set up with the CLI still name a variable in
-- `key_env`. `key_hint` is the key's last characters, to tell keys apart.
ALTER TABLE revenue_sources ALTER COLUMN key_env DROP NOT NULL;
ALTER TABLE revenue_sources ADD COLUMN key_cipher bytea;
ALTER TABLE revenue_sources ADD COLUMN key_hint text;
ALTER TABLE revenue_sources
    ADD CONSTRAINT revenue_sources_one_key CHECK ((key_env IS NULL) <> (key_cipher IS NULL));
CREATE UNIQUE INDEX revenue_sources_stored ON revenue_sources (site_id, provider)
    WHERE key_cipher IS NOT NULL;
