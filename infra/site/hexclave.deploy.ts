export const deploymentGroupId = "site";

export const deploy = () => ({
  services: {
    site: {
      type: "serverless",
      public: true,
      ports: { 8080: { protocol: "http" } },
      dockerfilePath: "Dockerfile",
      maxInstances: 2,
      env: {},
    },
  },
});
