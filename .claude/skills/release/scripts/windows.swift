// usage: windows <pid> — that process's on-screen windows, front to back, as JSON lines:
// {"id", "x", "y", "w", "h", "layer", "alpha", "title"}. Compiled on demand by smoke.sh.
// windows --locked — "1" if the screen is locked (window order and animations are then unreliable).
import CoreGraphics
import Foundation

if CommandLine.arguments[1] == "--locked" {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  print((session?["CGSSessionScreenIsLocked"] as? Bool) == true ? "1" : "0")
  exit(0)
}
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
