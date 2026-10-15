-- How often the model drafts a site's semantics (off, daily or weekly), and whether a draft's
-- new goals and funnels are added on their own or wait for a person to add them.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS draft_schedule text NOT NULL DEFAULT 'off';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS draft_apply text NOT NULL DEFAULT 'review';

-- Each draft as checked against the data, or the reason none could be made. Only the latest
-- few per site are kept.
CREATE TABLE semantic_drafts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    range_from date NOT NULL,
    range_to date NOT NULL,
    body jsonb,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX semantic_drafts_site ON semantic_drafts (site_id, created_at DESC);

-- Whether a goal or funnel came from a draft rather than a person.
ALTER TABLE goals ADD COLUMN IF NOT EXISTS drafted boolean NOT NULL DEFAULT false;
ALTER TABLE funnels ADD COLUMN IF NOT EXISTS drafted boolean NOT NULL DEFAULT false;

-- Goal and funnel names a person removed or turned down, by lowercased name, which later drafts
-- never add on their own.
CREATE TABLE semantic_dismissals (
    site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    kind text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, kind, name)
);
