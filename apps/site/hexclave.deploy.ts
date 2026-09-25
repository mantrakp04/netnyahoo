// `pnpm run deploy` builds dist/ locally, then `hexclave deploy` ships it in the nginx image (Dockerfile);
// netnyahoo.com is attached to the `site` service as its custom domain.
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
