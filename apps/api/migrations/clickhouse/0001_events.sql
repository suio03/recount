-- One row per tracked event (pageviews, clicks, custom events).
CREATE TABLE IF NOT EXISTS events
(
    site_id         UUID,
    timestamp       DateTime64(3, 'UTC'),
    name            LowCardinality(String),

    -- Identity. Cookie mode hashes the tracker's persistent id; cookieless mode hashes
    -- daily salt + site + IP + user agent, so cookieless visitors change every day.
    identity_mode   Enum8('cookie' = 1, 'cookieless' = 2),
    visitor_id      UInt64,
    session_id      UInt64,

    -- Page
    hostname        LowCardinality(String),
    pathname        String,
    page_title      String,
    page_type       LowCardinality(String),

    -- Acquisition
    referrer        String,
    referrer_source LowCardinality(String),
    channel         LowCardinality(String),
    utm_source      LowCardinality(String),
    utm_medium      LowCardinality(String),
    utm_campaign    String,
    utm_term        String,
    utm_content     String,
    click_id_type   LowCardinality(String),

    -- Environment
    country_code    LowCardinality(FixedString(2)),
    region          LowCardinality(String),
    city            String,
    browser         LowCardinality(String),
    browser_version LowCardinality(String),
    os              LowCardinality(String),
    os_version      LowCardinality(String),
    device          LowCardinality(String),
    screen_width    UInt16,
    language        LowCardinality(String),
    timezone        LowCardinality(String),

    -- Semantic context of the element a click event targeted
    element_tag     LowCardinality(String),
    element_text    String,
    element_label   String,
    element_href    String,
    element_section LowCardinality(String),

    props           Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (site_id, toDate(timestamp), name, visitor_id, timestamp)
SETTINGS index_granularity = 8192;
