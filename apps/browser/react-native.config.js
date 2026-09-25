const path = require("node:path");

module.exports = {
  reactNativePath: path.dirname(require.resolve("react-native-macos/package.json")),
  project: {
    // RN's CocoaPods autolinking always reads `project.ios`, so point it at macos/ too.
    ios: { sourceDir: "./macos" },
    macos: { sourceDir: "./macos" },
  },
};
