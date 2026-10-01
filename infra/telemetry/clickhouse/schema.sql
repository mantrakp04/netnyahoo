-- Netnyahoo telemetry schema. start.sh applies it on every boot, so every statement is idempotent;
-- a change to an existing table is a new ALTER ... IF NOT EXISTS line, never an edited CREATE.
--
--   otel_logs        what the collector writes: one row per OTLP log record. Analytics events are the
--                    records with an `event` attribute (body = event name); the rest are plain logs.
--   posthog_events   events exported from PostHog Cloud (2026-09-29 until the switch), same names.
--   events           the view to query: both of them, one shape, PostHog's names.
--   replay_sessions  one row per recorded session (rrweb chunks live in SeaweedFS, see the site's nginx).

CREATE DATABASE IF NOT EXISTS telemetry;

-- The collector's ClickHouse exporter inserts the first 15 columns by name (create_schema is off, see
-- collector/config.yaml); the rest are computed here.
CREATE TABLE IF NOT EXISTS telemetry.otel_logs
(
    Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt8,
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
    ScopeAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    LogAttributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    EventName String CODEC(ZSTD(1)),
    -- '' for plain logs.
    Event LowCardinality(String) MATERIALIZED LogAttributes['event'],
    -- The sender's event uuid is the dedupe key (a retried batch collapses at merge time). Plain logs
    -- have none, so they get a random one and never collapse.
    Uuid String MATERIALIZED if(LogAttributes['uuid'] != '', LogAttributes['uuid'], toString(generateUUIDv4())),
    DistinctId String MATERIALIZED LogAttributes['distinct_id'],
    SessionId String MATERIALIZED LogAttributes['$session_id'],
    INDEX idx_session SessionId TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_distinct DistinctId TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(Timestamp)
ORDER BY (Event, toDate(Timestamp), Uuid)
-- Events are kept; plain logs (app/site warnings and errors) for 90 days.
TTL toDateTime(Timestamp) + INTERVAL 90 DAY DELETE WHERE Event = ''
SETTINGS index_granularity = 8192;

-- PostHog Cloud's events as exported (scratch export + infra/telemetry/import-posthog.py). Property values are
-- strings, as in otel_logs: string properties unquoted, anything else as its JSON text (true, 12, [..]).
CREATE TABLE IF NOT EXISTS telemetry.posthog_events
(
    uuid String,
    event LowCardinality(String),
    distinct_id String,
    timestamp DateTime64(6, 'UTC'),
    properties Map(String, String) CODEC(ZSTD(3)),
    elements_chain String CODEC(ZSTD(3)),
    person_id String,
    session_id String MATERIALIZED properties['$session_id']
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (event, toDate(timestamp), uuid);

-- Compact parts (all columns in one file) until a part passes 1 GiB. Wide parts keep two files per
-- column and these tables are mostly Maps, so a stats query over wide parts held hundreds of files open
-- per table and four at once ran the server out (errno 24, 2026-10-01). start.sh merges older wide parts.
ALTER TABLE telemetry.otel_logs MODIFY SETTING min_bytes_for_wide_part = 1073741824;
ALTER TABLE telemetry.posthog_events MODIFY SETTING min_bytes_for_wide_part = 1073741824;

-- Everything, in PostHog's shape. `source` is the service that sent it (netnyahoo-site, netnyahoo-app,
-- netnyahoo-feed) or posthog-cloud for the migrated history. Deduplicated on uuid.
CREATE OR REPLACE VIEW telemetry.events AS
SELECT
    Uuid AS uuid,
    Event AS event,
    DistinctId AS distinct_id,
    SessionId AS session_id,
    toDateTime64(Timestamp, 6, 'UTC') AS timestamp,
    CAST(LogAttributes, 'Map(String, String)') AS properties,
    LogAttributes['$elements_chain'] AS elements_chain,
    toString(ServiceName) AS source,
    ResourceAttributes['service.version'] AS source_version
FROM telemetry.otel_logs FINAL
WHERE Event != ''
  -- Checks of the pipeline itself (docs/growth.md, Telemetry): service netnyahoo-selftest, or a
  -- sender whose version is 0.0.0-selftest.
  AND ServiceName != 'netnyahoo-selftest'
  AND ResourceAttributes['service.version'] != '0.0.0-selftest'
UNION ALL
SELECT
    uuid,
    toString(event) AS event,
    distinct_id,
    session_id,
    timestamp,
    properties,
    elements_chain,
    'posthog-cloud' AS source,
    '' AS source_version
FROM telemetry.posthog_events FINAL;

-- Plain logs (not events), newest first when you ORDER BY timestamp DESC.
CREATE OR REPLACE VIEW telemetry.logs AS
SELECT
    toDateTime64(Timestamp, 6, 'UTC') AS timestamp,
    toString(ServiceName) AS source,
    ResourceAttributes['service.version'] AS source_version,
    SeverityText AS level,
    Body AS message,
    LogAttributes AS attributes
FROM telemetry.otel_logs
WHERE Event = '' AND ServiceName != 'netnyahoo-selftest' AND ResourceAttributes['service.version'] != '0.0.0-selftest';

-- One row per recorded session. The site sends a `$replay_chunk` event with every chunk it uploads
-- (replays/<day>/<session>/<seq>.json[.gz] in SeaweedFS); pages, clicks and device come from the
-- session's other events.
CREATE OR REPLACE VIEW telemetry.replay_sessions AS
SELECT
    c.session_id AS session_id,
    c.distinct_id AS distinct_id,
    c.day AS day,
    c.start AS start,
    c.end AS end,
    dateDiff('second', c.start, c.end) AS duration_s,
    c.chunks AS chunks,
    c.bytes AS bytes,
    c.clicks AS clicks,
    e.pages AS pages,
    e.first_url AS first_url,
    e.device_type AS device_type,
    e.os AS os,
    e.browser AS browser,
    e.country AS country
FROM
(
    SELECT
        session_id,
        any(distinct_id) AS distinct_id,
        toDate(min(timestamp)) AS day,
        fromUnixTimestamp64Milli(min(toInt64OrZero(properties['first_timestamp']))) AS start,
        fromUnixTimestamp64Milli(max(toInt64OrZero(properties['last_timestamp']))) AS end,
        count() AS chunks,
        sum(toUInt64OrZero(properties['bytes'])) AS bytes,
        sum(toUInt64OrZero(properties['clicks'])) AS clicks
    FROM telemetry.events
    WHERE event = '$replay_chunk' AND session_id != ''
    GROUP BY session_id
) AS c
LEFT JOIN
(
    SELECT
        session_id,
        countIf(event = '$pageview') AS pages,
        argMinIf(properties['$current_url'], timestamp, event = '$pageview') AS first_url,
        any(properties['$device_type']) AS device_type,
        any(properties['$os']) AS os,
        any(properties['$browser']) AS browser,
        any(properties['$geoip_country_code']) AS country
    FROM telemetry.events
    WHERE session_id != '' AND event != '$replay_chunk'
    GROUP BY session_id
) AS e USING (session_id);
