// Arcadia's first-party telemetry, on Hexclave Deployments in the same project as the site
// (infra/site/hexclave.deploy.ts). Nothing here is public: the site's nginx is the only way in.
//
//   netnyahoo.com/otel/v1/logs     -> otel-collector (OTLP/HTTP logs) -> ph-clickhouse, table telemetry.otel_logs
//   netnyahoo.com/otel/replay/...  -> ph-objects (SeaweedFS filer), replays/<day>/<session>/<seq>.json[.gz]
//   netnyahoo.com/_ch/             -> ph-clickhouse's HTTP port, for the read-only stats user
//   netnyahoo.com/_replays/        -> ph-objects, read-only, with a token
//
// Senders, event format, tables and how to query them: docs/growth.md, "Telemetry".
//
// Why the group is called "posthog" and two services start with "ph-": this group first held a trial
// self-hosted PostHog. Hexclave keeps a service's disk with its group and service id, and has no way
// to delete a detached disk, so ClickHouse and SeaweedFS kept their ids to reuse those two disks
// instead of leaving them billed and empty. (The trial's Postgres and Redpanda disks, pgdata and
// redpanda, are detached; see docs/growth.md.)
//
// Deploy: `npx @hexclave/cli@latest deploy --cloud-project-id 49be2e2e-87c4-433e-b42f-f255854bff56`
// from this directory. Secrets (Hexclave dashboard, Project Settings > Secrets): SECRETS below.

export const deploymentGroupId = "posthog";

const SECRETS = {
  clickhouseAdmin: "TELEMETRY_CLICKHOUSE_ADMIN_PASSWORD",
  clickhouseOtel: "TELEMETRY_CLICKHOUSE_OTEL_PASSWORD",
  clickhouseReader: "TELEMETRY_CLICKHOUSE_READER_PASSWORD",
  clickhouseImporter: "TELEMETRY_CLICKHOUSE_IMPORTER_PASSWORD",
} as const;

const SEAWEEDFS = "docker.io/chrislusf/seaweedfs@sha256:d47c7ee99fcb951351d7194915f4e3a5ea604a8e8871183d713907dec4fb9bf5";

export const deploy = ({ secret, service }: any) => ({
  services: {
    "ph-clickhouse": {
      type: "server",
      memory: "4GB",
      ports: { 8123: { protocol: "tcp" }, 9000: { protocol: "tcp" } },
      // Built from this directory (the upload root), so its paths start with clickhouse/.
      dockerfilePath: "clickhouse/Dockerfile",
      persistentVolumes: { chdata: { path: "/data", sizeGb: 20 } },
      env: {
        CLICKHOUSE_ADMIN_PASSWORD: secret(SECRETS.clickhouseAdmin),
        CLICKHOUSE_OTEL_PASSWORD: secret(SECRETS.clickhouseOtel),
        CLICKHOUSE_READER_PASSWORD: secret(SECRETS.clickhouseReader),
        CLICKHOUSE_IMPORTER_PASSWORD: secret(SECRETS.clickhouseImporter),
      },
    },

    "otel-collector": {
      type: "server",
      memory: "512MB",
      ports: { 4318: { protocol: "tcp" }, 13133: { protocol: "tcp" } },
      dockerfilePath: "collector/Dockerfile",
      env: {
        CLICKHOUSE_HOST: service("ph-clickhouse").hostname(),
        CLICKHOUSE_OTEL_PASSWORD: secret(SECRETS.clickhouseOtel),
      },
    },

    // Session replays: rrweb chunks the site's nginx writes through the filer's HTTP API (private, no
    // auth of its own: only nginx reaches it). Everything under /buckets/replays/ expires after 30 days.
    "ph-objects": {
      type: "server",
      memory: "1GB",
      ports: { 8888: { protocol: "tcp" } },
      image: SEAWEEDFS,
      startCommand:
        "mkdir -p /data/weed && cd /data/weed && " +
        "{ (until echo 'fs.configure -locationPrefix=/buckets/replays/ -ttl=30d -apply' | weed shell -master=localhost:9333 2>/dev/null | grep -q replays; do sleep 3; done; echo '[ac] replays kept 30 days') & } && " +
        "exec weed server -dir=/data/weed -filer -master.volumePreallocate=false -volume.max=200",
      persistentVolumes: { objects: { path: "/data", sizeGb: 20 } },
      env: {},
    },
  },
});
