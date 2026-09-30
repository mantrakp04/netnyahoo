export const deploymentGroupId = "site";

export const deploy = ({ secret, service }: any) => ({
  services: {
    site: {
      type: "serverless",
      public: true,
      ports: { 8080: { protocol: "http" } },
      dockerfilePath: "Dockerfile",
      maxInstances: 2,
      // nginx.conf reaches the telemetry services (infra/telemetry) by these private hostnames.
      env: {
        TELEMETRY_COLLECTOR_HOST: service("otel-collector").hostname(),
        TELEMETRY_CLICKHOUSE_HOST: service("ph-clickhouse").hostname(),
        TELEMETRY_OBJECTS_HOST: service("ph-objects").hostname(),
        TELEMETRY_REPLAYS_READ_TOKEN: secret("TELEMETRY_REPLAYS_READ_TOKEN"),
      },
    },
  },
});
