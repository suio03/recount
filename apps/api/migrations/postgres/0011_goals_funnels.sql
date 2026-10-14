-- Goals defined by a rule instead of a custom event: a page visit or a click on a described
-- element. `match` holds the rule; it is applied when stats are read, so it covers past events.
CREATE TABLE goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    name text NOT NULL,
    match jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, name)
);

-- Ordered steps a visit goes through. Each step keeps its own copy of the rule it matches, so
-- deleting a goal leaves funnels built from it unchanged.
CREATE TABLE funnels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    name text NOT NULL,
    steps jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (site_id, name)
);
