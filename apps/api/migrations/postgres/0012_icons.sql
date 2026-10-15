-- Site and referrer icons, fetched once from the site itself and served from here. A row with no
-- body records that the host had none, so it is not asked again until the row is stale.
CREATE TABLE icons (
  host text PRIMARY KEY,
  content_type text,
  body bytea,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
