// Process probes for native-bench.mjs (built on demand with swiftc; no sudo needed).
//
//   nnperf rusage <pid>...            one JSON line per pid: CPU time, wakeups, phys_footprint
//   nnperf waitwindow <pid> <secs>    prints the epoch ms at which the pid first has an on-screen window ≥ 300×200
//   nnperf windows <pid>              JSON array of the pid's on-screen windows
//   nnperf newwindow <pid> <secs>     prints "ready" once it knows the pid's windows, then {"at": epoch ms, "id": window
//                                     number} when a new one is on screen (≥ 300×200, alpha > 0), polling every 2 ms
//   nnperf quit <pid>                 asks that one process to quit (a quit Apple event, as ⌘Q would)
//   nnperf postkeys <pid> <gap ms> <spec>...
//                                     real key events posted to that one process (CGEventPostToPid: the window server's
//                                     event path into the app's queue, as a keyboard's are). A spec is a chord (`cmd+t`,
//                                     `enter`, `esc`) or `text:<chars>` (US layout, a key down and up per character,
//                                     <gap ms> apart). Prints {"spec", "at"} per spec: epoch ms when its first key down
//                                     was created, the instant the press starts for the journey rows
//   nnperf input <pid> <secs>         {"inputSecs", "overWindowSecs"}: how long, polling every 250 ms, someone used the
//                                     mouse, trackpad or keyboard (HIDIdleTime), and how much of that with the pointer
//                                     moving over one of the pid's windows
import AppKit
import CoreGraphics
import Darwin
import Foundation
import IOKit

let args = CommandLine.arguments
var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func nanos(_ ticks: UInt64) -> UInt64 { ticks * UInt64(timebase.numer) / UInt64(timebase.denom) }
func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

func rusage(_ pid: pid_t) -> [String: Any]? {
  var info = rusage_info_v4()
  let rc = withUnsafeMutablePointer(to: &info) {
    $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
  }
  guard rc == 0 else { return nil }
  return [
    "pid": pid,
    "cpuNs": nanos(info.ri_user_time) + nanos(info.ri_system_time),
    "idleWakeups": info.ri_pkg_idle_wkups,
    "interruptWakeups": info.ri_interrupt_wkups,
    "footprint": info.ri_phys_footprint,
    "resident": info.ri_resident_size,
    "energyNj": info.ri_billed_energy,
    "at": nowMs(),
  ]
}

func windows(_ pid: pid_t) -> [[String: Any]] {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.compactMap { w in
    guard (w[kCGWindowOwnerPID as String] as? Int32) == pid else { return nil }
    let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
    return ["id": w[kCGWindowNumber as String] ?? 0, "layer": w[kCGWindowLayer as String] ?? 0,
            "alpha": w[kCGWindowAlpha as String] ?? 0, "w": b["Width"] ?? 0, "h": b["Height"] ?? 0]
  }
}

// Nanoseconds since the last mouse, trackpad or keyboard event, from anyone (no permission needed).
func hidIdleNs() -> UInt64? {
  let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))
  guard service != 0 else { return nil }
  defer { IOObjectRelease(service) }
  return (IORegistryEntryCreateCFProperty(service, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?
    .takeRetainedValue() as? NSNumber)?.uint64Value
}

func printJSON(_ value: Any) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
}

switch args.count > 1 ? args[1] : "" {
case "rusage":
  for p in args.dropFirst(2) { if let pid = pid_t(p), let r = rusage(pid) { printJSON(r) } }
case "windows":
  printJSON(windows(pid_t(args[2]) ?? 0))
case "quit":
  exit(NSRunningApplication(processIdentifier: pid_t(args[2]) ?? 0)?.terminate() == true ? 0 : 1)
case "waitwindow":
  let pid = pid_t(args[2]) ?? 0
  let deadline = Date().addingTimeInterval(Double(args[3]) ?? 30)
  while Date() < deadline {
    if windows(pid).contains(where: { ($0["w"] as? Double ?? 0) >= 300 && ($0["h"] as? Double ?? 0) >= 200 && ($0["alpha"] as? Double ?? 0) > 0 }) {
      print(String(format: "%.0f", nowMs()))
      exit(0)
    }
    if kill(pid, 0) != 0 { exit(3) }
    usleep(4000)
  }
  exit(2)
case "newwindow":
  let pid = pid_t(args[2]) ?? 0
  let deadline = Date().addingTimeInterval(Double(args[3]) ?? 30)
  let shown = { windows(pid).filter { ($0["w"] as? Double ?? 0) >= 300 && ($0["h"] as? Double ?? 0) >= 200 && ($0["alpha"] as? Double ?? 0) > 0 } }
  let before = Set(shown().compactMap { $0["id"] as? Int })
  print("ready")
  fflush(stdout)
  while Date() < deadline {
    if let new = shown().first(where: { !before.contains($0["id"] as? Int ?? 0) }) {
      print(String(format: "{\"at\":%.1f,\"id\":%d}", nowMs(), new["id"] as? Int ?? 0))
      exit(0)
    }
    if kill(pid, 0) != 0 { exit(3) }
    usleep(2000)
  }
  exit(2)
case "input":
  // The bench's windows are on screen, often in front: a pointer moving over them makes the app work (hover, cursor
  // updates), so an idle window someone used the Mac in doesn't measure the app alone. Counts are 250 ms ticks.
  let pid = pid_t(args[2]) ?? 0
  let tick = 0.25
  let deadline = Date().addingTimeInterval(Double(args[3]) ?? 60)
  guard hidIdleNs() != nil else {
    printJSON(["error": "no HIDIdleTime"])
    exit(1)
  }
  // Whether the frontmost window under the point is one of the pid's (below the Dock, menu bar and overlays).
  func overOwnWindow(_ at: CGPoint) -> Bool {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return false }
    for w in list {
      guard let layer = w[kCGWindowLayer as String] as? Int, layer < 20, (w[kCGWindowAlpha as String] as? Double ?? 0) > 0,
            let b = w[kCGWindowBounds as String] as? [String: Double],
            CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0).contains(at)
      else { continue }
      return (w[kCGWindowOwnerPID as String] as? Int32) == pid
    }
    return false
  }
  var input = 0, over = 0
  var last = CGEvent(source: nil)?.location
  while Date() < deadline {
    usleep(UInt32(tick * 1e6))
    let at = CGEvent(source: nil)?.location
    defer { last = at }
    guard let idle = hidIdleNs(), Double(idle) < tick * 1e9 else { continue }
    input += 1
    if let at, at != last, overOwnWindow(at) { over += 1 }
  }
  printJSON(["inputSecs": Double(input) * tick, "overWindowSecs": Double(over) * tick])
case "postkeys":
  guard args.count >= 5, let pid = pid_t(args[2]), pid > 1, let gap = Double(args[3]) else {
    FileHandle.standardError.write("usage: nnperf postkeys <pid> <gap ms> <spec>...\n".data(using: .utf8)!)
    exit(64)
  }
  // US ANSI virtual key codes; `shifted` are the characters typed with shift on the same key.
  let codes: [Character: UInt16] = [
    "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
    "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38, "k": 40, ";": 41, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, " ": 49,
  ]
  let shifted: [Character: Character] = ["?": "/", ":": ";", "_": "-", "+": "=", "&": "7"]
  let named: [String: UInt16] = ["enter": 36, "return": 36, "tab": 48, "esc": 53, "escape": 53, "delete": 51, "space": 49, "down": 125, "up": 126]
  let source = CGEventSource(stateID: .combinedSessionState)
  // One key press (down, then up) to the pid, as a keyboard makes it; returns when its key down was created.
  func press(_ code: UInt16, _ flags: CGEventFlags, _ chars: String?) -> Double {
    let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)
    let at = nowMs()
    down?.flags = flags
    if let chars { down?.keyboardSetUnicodeString(stringLength: chars.utf16.count, unicodeString: Array(chars.utf16)) }
    down?.postToPid(pid)
    let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.postToPid(pid)
    return at
  }
  for spec in args.dropFirst(4) {
    var first = 0.0
    if spec.hasPrefix("text:") {
      for (i, ch) in spec.dropFirst(5).enumerated() {
        let shift = shifted[ch] != nil || (ch.isUppercase)
        let base = shifted[ch] ?? Character(ch.lowercased())
        guard let code = codes[base] else {
          FileHandle.standardError.write("nnperf postkeys: no key for \(ch)\n".data(using: .utf8)!)
          exit(64)
        }
        let at = press(code, shift ? .maskShift : [], String(ch))
        if i == 0 { first = at }
        if gap > 0 { usleep(UInt32(gap * 1000)) }
      }
    } else {
      var flags: CGEventFlags = []
      var key = ""
      for part in spec.split(separator: "+").map(String.init) {
        switch part {
        case "cmd": flags.insert(.maskCommand)
        case "shift": flags.insert(.maskShift)
        case "opt": flags.insert(.maskAlternate)
        case "ctrl": flags.insert(.maskControl)
        default: key = part
        }
      }
      guard let code = named[key] ?? key.first.flatMap({ key.count == 1 ? codes[$0] : nil }) else {
        FileHandle.standardError.write("nnperf postkeys: no key for \(spec)\n".data(using: .utf8)!)
        exit(64)
      }
      first = press(code, flags, flags.isEmpty && key.count == 1 ? key : nil)
    }
    printJSON(["spec": spec, "at": (first * 10).rounded() / 10])
    fflush(stdout)
  }
default:
  FileHandle.standardError.write("usage: nnperf rusage <pid>... | windows <pid> | quit <pid> | waitwindow <pid> <secs> | newwindow <pid> <secs> | input <pid> <secs> | postkeys <pid> <gap ms> <spec>...\n".data(using: .utf8)!)
  exit(64)
}
