import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, let pid = pid_t(args[1]), let code = CGKeyCode(args[2]) else {
  print("usage: keys <pid> <keyCode> [modifiers]")
  exit(1)
}
var flags: CGEventFlags = []
for ch in args.count > 3 ? args[3] : "" {
  switch ch {
  case "c": flags.insert(.maskCommand)
  case "s": flags.insert(.maskShift)
  case "o": flags.insert(.maskAlternate)
  case "t": flags.insert(.maskControl)
  default: break
  }
}
let source = CGEventSource(stateID: .privateState)
for down in [true, false] {
  guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { exit(1) }
  event.flags = flags
  event.postToPid(pid)
  usleep(20_000)
}
