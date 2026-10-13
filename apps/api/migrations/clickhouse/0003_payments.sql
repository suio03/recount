-- One row per payment, renewal or refund, synced from the site's payment provider. Each row
-- carries a snapshot of the session it is attributed to, under the same column names as the
-- sessions query, so dashboard filters apply to payments unchanged.
CREATE TABLE IF NOT EXISTS payments
(
    site_id         UUID,
    provider        LowCardinality(String),
    payment_id      String,
    timestamp       DateTime64(3, 'UTC'),
    kind            Enum8('new' = 1, 'renewal' = 2, 'refund' = 3),
    -- Minor units of the site's currency; refunds are negative.
    amount          Int64,
    currency        LowCardinality(String),
    customer_id     String,

    -- Attribution: 0 and empty strings when the payment could not be tied to a visit.
    visitor_id      UInt64,
    session_id      UInt64,
    channel         LowCardinality(String),
    referrer        LowCardinality(String),
    campaign        String,
    entry           String,
    country         LowCardinality(String),
    device          LowCardinality(String),
    browser         LowCardinality(String),
    os              LowCardinality(String),
    pages           Array(String),
    event_names     Array(LowCardinality(String)),

    synced_at       DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(synced_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (site_id, provider, payment_id);
