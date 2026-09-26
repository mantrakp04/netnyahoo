const path = require("node:path");
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = mergeConfig(getDefaultConfig(projectRoot), {
  // Watch the whole monorepo so edits in packages/* hot reload.
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [path.resolve(workspaceRoot, "node_modules")],
    resolveRequest(context, moduleName, platform) {
      // Same redirect the RN CLI installs for out-of-tree platforms (defining our
      // own resolveRequest replaces it): `react-native` -> `react-native-macos`.
      if (platform === "macos" && (moduleName === "react-native" || moduleName.startsWith("react-native/"))) {
        moduleName = moduleName.replace(/^react-native/, "react-native-macos");
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});

module.exports = config;
