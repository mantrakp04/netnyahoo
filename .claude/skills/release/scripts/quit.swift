// usage: quit <pid> — asks that one process to quit the way ⌘Q and Sparkle's update do (the quit
// Apple event), never by bundle id: another instance of the app may be the user's own. Prints "sent".
// Compiled on demand by smoke.sh.
import AppKit

guard CommandLine.arguments.count == 2, let pid = pid_t(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid) else {
  print("no app with that pid")
  exit(1)
}
print(app.terminate() ? "sent" : "refused")
