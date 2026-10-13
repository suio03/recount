-- What happened in each recorded session, extracted from its replay chunks once the session
-- ended: counts for finding sessions worth reading, and the interaction timeline as JSON.
-- Timelines hold no page text beyond what the recorder kept, so they outlive the recordings.
CREATE TABLE IF NOT EXISTS replay_sessions
(
    site_id          UUID,
    session_id       UInt64,
    visitor_id       UInt64,
    started_at       DateTime64(3, 'UTC'),
    ended_at         DateTime64(3, 'UTC'),
    pages            UInt16,
    clicks           UInt32,
    rage_clicks      UInt16,
    dead_clicks      UInt16,
    errors           UInt16,
    abandoned_forms  UInt16,
    timeline         String CODEC(ZSTD(3)),
    version          UInt16,
    extracted_at     DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(extracted_at)
PARTITION BY toYYYYMM(started_at)
ORDER BY (site_id, session_id)
TTL toDateTime(started_at) + INTERVAL 180 DAY DELETE
