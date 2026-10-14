-- A site's public read-only dashboard is at /share/<share_token>; null means it has none. The
-- token is kept as is, since admins copy the link again later; making a new one retires the old.
ALTER TABLE sites ADD COLUMN share_token text UNIQUE;
