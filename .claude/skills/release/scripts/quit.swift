import AppKit

guard CommandLine.arguments.count == 2, let pid = pid_t(CommandLine.arguments[1]),
      let app = NSRunningApplication(processIdentifier: pid) else {
  print("no app with that pid")
  exit(1)
}
print(app.terminate() ? "sent" : "refused")
