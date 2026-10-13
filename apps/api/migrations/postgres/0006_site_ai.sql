-- Whether the model reads this site: the dashboard reading, replay summaries and the patterns
-- across them. Off by default, since a wiki or reference site rarely needs it.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS ai boolean NOT NULL DEFAULT false;
