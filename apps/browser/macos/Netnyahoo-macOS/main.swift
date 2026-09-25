import AppKit
import NetnyahooCEF

// No storyboard: the window and menus are built in code (see BrowserWindow and
// the NetnyahooShell module). CEF needs its NSApplication subclass to exist
// before anything touches NSApp, and must be initialized before the run loop.
let app = NNApplication.shared
guard NNCef.start(withArgc: CommandLine.argc, argv: CommandLine.unsafeArgv) else { exit(0) }
let delegate = AppDelegate()
app.delegate = delegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
