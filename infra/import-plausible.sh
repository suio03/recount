#!/usr/bin/env bash
# Copies event history from a Plausible CE install into Recount, on the host that runs both.
#
#   PLAUSIBLE_CH=<container> RECOUNT_CH=<container> RECOUNT_PG=<container> \
#     infra/import-plausible.sh <plausible site id>:<domain> ...
#
# For each site it creates the Recount site when missing, then streams the Plausible events
# before the site's first Recount event, or before UNTIL (default: now, UTC) when it has none,
# straight from one ClickHouse into the other. So trackers can switch over first and the history
# fills in behind them, and a rerun finds nothing older left to copy. Imported rows are
# cookieless: Plausible's visitor ids are daily hashes. Source and channel are derived again with
# Recount's rules, so imported and live rows group the same way. Revenue is not copied: Recount
# syncs payments from the providers itself. Each month goes over as its own insert, which keeps
# every insert inside one partition and leaves little to merge on a small host.
#
# To redo a site, or one whose import stopped part way, delete its imported (cookieless) events
# in Recount first. SITES_ONLY=1 only creates the sites, so the trackers have somewhere to report
# before the history comes over. New sites get TIMEZONE (default UTC).
set -euo pipefail

: "${PLAUSIBLE_CH:?the Plausible ClickHouse container}"
: "${RECOUNT_CH:?the Recount ClickHouse container}"
: "${RECOUNT_PG:?the Recount PostgreSQL container}"
TIMEZONE=${TIMEZONE:-UTC}
UNTIL=${UNTIL:-$(date -u '+%F %T')}

if [ $# = 0 ]; then
  echo "usage: $0 <plausible site id>:<domain> ..." >&2
  exit 2
fi
for entry in "$@"; do
  if ! [[ $entry =~ ^[0-9]+:[a-z0-9.-]+$ ]]; then
    echo "not <plausible site id>:<domain>: $entry" >&2
    exit 2
  fi
done
[[ $TIMEZONE =~ ^[A-Za-z0-9_/+-]+$ ]] || { echo "bad TIMEZONE: $TIMEZONE" >&2; exit 2; }
[[ $UNTIL =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}$ ]] ||
  { echo "UNTIL is not YYYY-MM-DD hh:mm:ss: $UNTIL" >&2; exit 2; }

pg() { docker exec -i "$RECOUNT_PG" psql -U recount -d recount -Atq -v ON_ERROR_STOP=1 "$@"; }
plausible() { docker exec -i "$PLAUSIBLE_CH" clickhouse-client "$@"; }
recount() {
  docker exec -i "$RECOUNT_CH" sh -c \
    'exec clickhouse-client --user recount --password "$CLICKHOUSE_PASSWORD" -d recount "$@"' \
    clickhouse-client "$@"
}

# Mirrors parseAcquisition and classifyChannel in apps/api/src/ingest. Character classes stand in
# for escaped dots, which ClickHouse string literals would swallow.
select_sql() {
  local plausible_id=$1 site_id=$2 from=$3 to=$4
  cat <<SQL
WITH
  lower(replaceRegexpOne(ref, '^(?:[a-zA-Z]+://)?(?:www[.])?([^/:?#]*).*$', '\\\\1')) AS ref_host,
  replaceRegexpOne(lower(hostname), '^www[.]', '') AS own_host,
  if(ref_host != '' AND ref_host != own_host, ref_host, '') AS ref_source,
  if(ref_source != '', ref_source, lower(utm_source)) AS src,
  lower(utm_medium) AS medium,
  match(medium, '^(cpc|ppc|paid|paidsearch|paid_search|cpm|display)$') AS paid
SELECT
  toUUID('$site_id') AS site_id,
  toDateTime64(ts, 3, 'UTC') AS timestamp,
  name,
  CAST('cookieless', 'Enum8(\'cookie\' = 1, \'cookieless\' = 2)') AS identity_mode,
  user_id AS visitor_id,
  session_id,
  hostname,
  pathname,
  '' AS page_title,
  '' AS page_type,
  if(ref_source != '', ref, '') AS referrer,
  src AS referrer_source,
  multiIf(
    match(src, '(^|[.])(chatgpt[.]com|openai[.]com|perplexity[.]ai|claude[.]ai|gemini[.]google[.]com|copilot[.]microsoft[.]com|chat[.]deepseek[.]com|you[.]com|phind[.]com|kagi[.]com)$') OR medium = 'ai', 'AI Assistant',
    match(src, '(^|[.])(google|bing|duckduckgo|yahoo|baidu|yandex|ecosia|naver|seznam|brave|startpage|qwant)[.]'), if(paid, 'Paid Search', 'Organic Search'),
    match(src, '(^|[.])(x[.]com|twitter[.]com|t[.]co|facebook[.]com|instagram[.]com|linkedin[.]com|lnkd[.]in|reddit[.]com|youtube[.]com|tiktok[.]com|pinterest[.]com|threads[.]net|bsky[.]app|news[.]ycombinator[.]com|producthunt[.]com|weibo[.]com|xiaohongshu[.]com|zhihu[.]com|bilibili[.]com)$') OR medium = 'social', if(paid, 'Paid Social', 'Organic Social'),
    medium = 'email' OR match(src, '(^|[.])(mail[.]google[.]com|outlook[.]live[.]com|mail[.]yahoo[.]com)$'), 'Email',
    paid, 'Paid Search',
    src = '', 'Direct',
    'Referral'
  ) AS channel,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content,
  '' AS click_id_type,
  country_code,
  '' AS region,
  '' AS city,
  browser,
  browser_version,
  operating_system AS os,
  operating_system_version AS os_version,
  screen_size AS device,
  toUInt16(0) AS screen_width,
  '' AS language,
  '' AS timezone,
  '' AS element_tag,
  '' AS element_text,
  '' AS element_label,
  '' AS element_href,
  '' AS element_section,
  CAST((meta.key, meta.value), 'Map(String, String)') AS props
FROM (
  -- Renamed so the output columns above cannot shadow them.
  SELECT *, timestamp AS ts, referrer AS ref
  FROM plausible_events_db.events_v2
  WHERE site_id = $plausible_id
    AND timestamp >= toDateTime('$from', 'UTC') AND timestamp < toDateTime('$to', 'UTC')
)
SQL
}

echo "importing events before $UNTIL UTC, or before each site's first Recount event"
for entry in "$@"; do
  plausible_id=${entry%%:*}
  domain=${entry#*:}

  pg -c "INSERT INTO sites (domain, name, timezone) VALUES ('$domain', '$domain', '$TIMEZONE')
         ON CONFLICT (domain) DO NOTHING" >/dev/null
  site_id=$(pg -c "SELECT id FROM sites WHERE domain = '$domain'")
  if [ "${SITES_ONLY:-}" = 1 ]; then
    echo "$domain: $site_id"
    continue
  fi

  cutoff=$(recount -q "SELECT toString(least(toDateTime('$UNTIL', 'UTC'),
    ifNull(toDateTime(minOrNull(timestamp), 'UTC'), toDateTime('$UNTIL', 'UTC'))))
    FROM events WHERE site_id = '$site_id'")
  expected=$(plausible -q "SELECT count() FROM plausible_events_db.events_v2
    WHERE site_id = $plausible_id AND timestamp < toDateTime('$cutoff', 'UTC')")
  if [ "$expected" = 0 ]; then
    echo "$domain: nothing before $cutoff"
    continue
  fi

  before=$(recount -q "SELECT count() FROM events WHERE site_id = '$site_id'")
  # Month starts up to the cutoff, each paired with the end of its slice.
  plausible -q "SELECT toString(toDateTime(m, 'UTC')),
      toString(least(toDateTime(m + INTERVAL 1 MONTH, 'UTC'), toDateTime('$cutoff', 'UTC')))
    FROM (SELECT DISTINCT toStartOfMonth(timestamp, 'UTC') AS m FROM plausible_events_db.events_v2
          WHERE site_id = $plausible_id AND timestamp < toDateTime('$cutoff', 'UTC'))
    ORDER BY m FORMAT TSV" |
  while IFS=$'\t' read -r from to; do
    select_sql "$plausible_id" "$site_id" "$from" "$to" |
      plausible --format Native --max_block_size 16384 --max_threads 2 |
      recount --min_insert_block_size_rows 100000 --min_insert_block_size_bytes 33554432 \
        --max_insert_threads 1 -q 'INSERT INTO events FORMAT Native'
  done
  after=$(recount -q "SELECT count() FROM events WHERE site_id = '$site_id'")
  echo "$domain: $((after - before)) of $expected events before $cutoff"
done
