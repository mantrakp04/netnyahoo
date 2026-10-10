import AppKit
import ArcadiaCore
import ArcadiaSync

// ARCADIA_PREWARM=1: exit as soon as the process is up, before anything else runs (no NSApp, no window, no Dock
// icon, no data dir, no profile). The updater runs an update Sparkle has staged this way (UpdatePrewarm,
// packages/shell/ios/Updater.swift), so macOS's first-launch checks of a copy it hasn't run happen then, not in the
// user's first launch of the new version (docs/perf/launch-critical-path.md).
if getenv("ARCADIA_PREWARM") != nil { exit(0) }

// An install updated from before the rename is still in a bundle with the old file name (Sparkle installs into the
// installed path): it renames itself to Arcadia.app and starts again from there, so the migration below runs once, in
// the final process, and Chromium resolves its helpers in the bundle's final place. Doesn't return when it moved.
LegacyMigration.moveToNewName()

// An install of the app under its former name: its data folder, preferences and keychain items come across once,
// before anything reads them (packages/sync/ios/Core/LegacyMigration.swift). False: the user chose to quit.
if !LegacyMigration.runAtLaunch() { exit(0) }

// The app on ArcadiaCore: Chromium runs the process and its loop, and the React Native host (AppDelegate) starts inside
// it. Nothing may touch NSApp before this: Chrome makes it its own NSApplication.
exit(ArcadiaCoreHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
