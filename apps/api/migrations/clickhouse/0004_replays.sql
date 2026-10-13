-- Raw session recordings: rrweb events in batches as the recorder posts them. A session's
-- recording is its page loads (load_id) in time order, each batch in seq order. Kept 30 days:
-- what the AI needs from them is extracted into a timeline that lives longer.
CREATE TABLE IF NOT EXISTS replay_chunks
(
    site_id      UUID,
    session_id   UInt64,
    visitor_id   UInt64,
    load_id      String,
    seq          UInt32,
    -- First and last rrweb event in the batch, from the visitor's clock.
    started_at   DateTime64(3, 'UTC'),
    ended_at     DateTime64(3, 'UTC'),
    received_at  DateTime64(3, 'UTC') DEFAULT now64(3),
    events       UInt32,
    -- JSON array of rrweb events.
    data         String CODEC(ZSTD(3))
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMMDD(received_at)
ORDER BY (site_id, session_id, load_id, seq)
TTL toDateTime(received_at) + INTERVAL 30 DAY DELETE
SETTINGS ttl_only_drop_parts = 1;
