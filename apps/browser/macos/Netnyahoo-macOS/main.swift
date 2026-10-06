import AppKit
import NetnyahooNNCore

// NETNYAHOO_PREWARM=1: exit as soon as the process is up, before anything else runs (no NSApp, no window, no Dock
// icon, no data dir, no profile). The updater runs an update Sparkle has staged this way (UpdatePrewarm,
// packages/shell/ios/Updater.swift), so macOS's first-launch checks of a copy it hasn't run happen then, not in the
// user's first launch of the new version (docs/perf/launch-critical-path.md).
if getenv("NETNYAHOO_PREWARM") != nil { exit(0) }

// The app on NNCore: Chromium runs the process and its loop, and the React Native host (AppDelegate) starts inside
// it. Nothing may touch NSApp before this: Chrome makes it its own NSApplication.
exit(NNCoreHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
