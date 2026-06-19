import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

// electron-builder reads creds from process.env but doesn't load .env itself.
// Pull in apps/desktop/.env (gitignored) so `pnpm dist:mac` picks up the
// notarization credentials. quiet:true keeps the build log clean.
loadEnv({ quiet: true });

// This repo lives under ~/Desktop, which is synced by iCloud Desktop &
// Documents. The iCloud file provider stamps every file it manages with
// `com.apple.FinderInfo` / `com.apple.fileprovider.fpfs#P` xattrs that
// `codesign` rejects ("resource fork, Finder information, or similar detritus
// not allowed") — and those attrs cannot be stripped while the provider owns
// the file. So we stage and sign the app OUTSIDE the synced tree. Override
// with NETNYAHOO_DIST if you want a different location.
const output = process.env.NETNYAHOO_DIST ?? join(homedir(), "netnyahoo-build");

// Notarize only when Apple credentials are present in the environment, so a
// plain `dist:mac` still produces a signed build offline. Supply EITHER an
// App Store Connect API key (APPLE_API_KEY/_KEY_ID/_ISSUER) OR an Apple ID
// app-specific password (APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID).
const hasNotaryCreds = Boolean(
  (process.env.APPLE_API_KEY &&
    process.env.APPLE_API_KEY_ID &&
    process.env.APPLE_API_ISSUER) ||
    (process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID),
);

/** @type {import("electron-builder").Configuration} */
export default {
  appId: "com.netnyahoo.desktop",
  productName: "netnyahoo",
  copyright: "Copyright © 2026 Mantra Patel",

  directories: {
    // Drop icon.icns (and other packaging assets) into ./build to override the
    // default Electron icon. buildResources is also where entitlements live.
    buildResources: "build",
    output,
  },

  // electron-vite emits the runnable app to out/. Everything below is a set of
  // negations layered on electron-builder's default "**/*" — we keep out/,
  // package.json and the collected production node_modules, and strip the TS
  // sources, configs and local caches that have no business in the bundle.
  files: [
    "out/**/*",
    "package.json",
    "!**/*.{ts,tsx,map,md}",
    "!**/{.turbo,.tanstack,.vscode,.git,.github}",
    "!**/{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/{electron.vite.config.*,vite.config.*,components.json}",
    "!**/{.env,.env.*}",
  ],

  asar: true,

  mac: {
    category: "public.app-category.productivity",
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    // Hardened runtime is mandatory for notarization.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    // electron-builder auto-discovers the "Developer ID Application" identity
    // in the login keychain.
    notarize: hasNotaryCreds,
  },

  dmg: {
    title: "${productName} ${version}",
  },
};
