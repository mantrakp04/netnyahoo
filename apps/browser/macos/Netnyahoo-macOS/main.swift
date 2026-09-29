import AppKit
import NetnyahooCEF

let app = NNApplication.shared
guard NNCef.start(withArgc: CommandLine.argc, argv: CommandLine.unsafeArgv) else { exit(0) }
let delegate = AppDelegate()
app.delegate = delegate
_ = NSApplicationMain(CommandLine.argc, CommandLine.unsafeArgv)
