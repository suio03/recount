-- What an API key may do: `admin` acts as an admin of its org, `agent` reads data and writes
-- event definitions (for coding agents, through the MCP server), and `ingest` only sends
-- server-side events, so a key kept on a production server cannot read anything.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'admin'
    CHECK (scope IN ('admin', 'agent', 'ingest'));

-- What a custom event means, as registered by a person or a coding agent once it sends it.
-- Read with the catalog in `sites/`, which wins where both name the same event.
CREATE TABLE IF NOT EXISTS event_definitions (
    site_id     uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    name        text NOT NULL,
    description text NOT NULL,
    -- acquisition, activation, conversion, retention or referral; null when it is none.
    stage       text,
    -- A key event is one whose change readings always report, and what conversion counts.
    key         boolean NOT NULL DEFAULT false,
    -- {"plan": {"type": "string", "description": "..."}}
    properties  jsonb NOT NULL DEFAULT '{}',
    -- The API key's name or the person's email, for the record.
    defined_by  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, name)
);
