-- One row per model call: what it was for, its tokens and what it cost in millionths of a US
-- dollar. Rows stay when their site is deleted, since the org still paid for the call; they go
-- with the org.
CREATE TABLE ai_usage (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    site_id uuid REFERENCES sites (id) ON DELETE SET NULL,
    kind text NOT NULL,
    model text NOT NULL,
    input_tokens integer NOT NULL,
    output_tokens integer NOT NULL,
    cost_micros bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_org_time ON ai_usage (org_id, created_at);
