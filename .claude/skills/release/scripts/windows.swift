// usage: windows <pid> — that process's on-screen windows, front to back, as JSON lines:
// {"id", "x", "y", "w", "h", "layer", "alpha", "title"}. Compiled on demand by smoke.sh.
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid {
  let b = w[kCGWindowBounds as String] as! [String: Any]
  let row: [String: Any] = [
    "id": w[kCGWindowNumber as String]!, "x": b["X"]!, "y": b["Y"]!, "w": b["Width"]!, "h": b["Height"]!,
    "layer": w[kCGWindowLayer as String]!, "alpha": w[kCGWindowAlpha as String]!,
    "title": w[kCGWindowName as String] ?? "",
  ]
  print(String(data: try! JSONSerialization.data(withJSONObject: row), encoding: .utf8)!)
}
