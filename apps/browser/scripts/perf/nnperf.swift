// Process probes for native-bench.mjs (built on demand with swiftc; no sudo needed).
//
//   nnperf rusage <pid>...            one JSON line per pid: CPU time, wakeups, phys_footprint
//   nnperf waitwindow <pid> <secs>    prints the epoch ms at which the pid first has an on-screen window ≥ 300×200
//   nnperf windows <pid>              JSON array of the pid's on-screen windows
//   nnperf quit <pid>                 asks that one process to quit (a quit Apple event, as ⌘Q would)
import AppKit
import CoreGraphics
import Darwin
import Foundation

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
default:
  FileHandle.standardError.write("usage: nnperf rusage <pid>... | windows <pid> | quit <pid> | waitwindow <pid> <secs>\n".data(using: .utf8)!)
  exit(64)
}
