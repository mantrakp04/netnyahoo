# OpenTelemetry Collector (contrib) for the telemetry (hexclave.deploy.ts), with config.yaml and the
# GeoLite2 City database its geoip processor reads (country only is kept, the IP is dropped).
FROM docker.io/library/node@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f AS geoip
# PostHog's CDN serves the database brotli-compressed, and only over HTTP/1.1.
RUN node -e 'const https = require("https"), zlib = require("zlib"), fs = require("fs"); https.get("https://mmdbcdn.posthog.net/", (res) => { if (res.statusCode !== 200) { console.error("mmdb: HTTP " + res.statusCode); process.exit(1); } res.pipe(zlib.createBrotliDecompress()).pipe(fs.createWriteStream("/GeoLite2-City.mmdb")); }).on("error", (e) => { console.error(e); process.exit(1); });' \
 && test "$(stat -c %s /GeoLite2-City.mmdb)" -gt 1000000

FROM docker.io/otel/opentelemetry-collector-contrib@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1
COPY --from=geoip /GeoLite2-City.mmdb /etc/otelcol-contrib/GeoLite2-City.mmdb
COPY collector/config.yaml /etc/otelcol-contrib/config.yaml
