-- Server-side reported requests from AI crawlers (they do not run the JS tracker).
CREATE TABLE IF NOT EXISTS ai_crawls
(
    site_id     UUID,
    timestamp   DateTime64(3, 'UTC'),
    provider    LowCardinality(String),
    agent       LowCardinality(String),
    category    Enum8('answer_fetch' = 1, 'search_index' = 2, 'training' = 3, 'unknown' = 4),
    verified    Bool,
    pathname    String,
    status      UInt16
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (site_id, toDate(timestamp), provider, timestamp);
