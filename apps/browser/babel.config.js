module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { jsxImportSource: "nativewind" }]],
    // `nativewind/babel` also injects the Reanimated plugin, which we don't ship
    // (no macOS build), so use just the css-interop transform it wraps.
    plugins: [require("react-native-css-interop/dist/babel-plugin").default],
  };
};
