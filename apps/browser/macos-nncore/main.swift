import AppKit
import NetnyahooNNCore

// The app on NNCore: Chromium runs the process and its loop; the React Native host (the same AppDelegate as the
// CEF build) starts inside it. Nothing may touch NSApp before this: Chrome makes it its own NSApplication.
exit(NNCoreHost.run(argc: CommandLine.argc, argv: CommandLine.unsafeArgv) { AppDelegate() })
