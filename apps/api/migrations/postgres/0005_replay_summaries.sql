-- AI summaries of notable recorded sessions. Each keeps why the session was picked and the
-- moments it points at, by time from the session's start, so they link into the recording.
CREATE TABLE IF NOT EXISTS replay_summaries (
    site_id         uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    started_at      timestamptz NOT NULL,
    reasons         text[] NOT NULL,
    body            jsonb NOT NULL,
    model           text NOT NULL,
    prompt_version  integer NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, session_id)
);

CREATE INDEX IF NOT EXISTS replay_summaries_site_started ON replay_summaries (site_id, started_at);
