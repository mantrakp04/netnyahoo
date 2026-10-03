// Writes macOS's own pointer artwork (NSCursor.arrow and .pointingHand, the largest representation) to PNGs, with
// each hot spot, for the film's pointer. usage: swift cursor.swift <out dir>
import AppKit

let dir = CommandLine.arguments[1]
NSApplication.shared.setActivationPolicy(.prohibited)
var spots: [String] = []
for (name, cursor) in [("arrow", NSCursor.arrow), ("hand", NSCursor.pointingHand)] {
  let image = cursor.image
  guard image.size.width > 0 else { fatalError("\(name): no cursor image") }
  // Drawn at 4x: the cursor's representations are vector or several bitmaps; AppKit picks the best for the size.
  let px = NSSize(width: (image.size.width * 4).rounded(), height: (image.size.height * 4).rounded())
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px.width), pixelsHigh: Int(px.height), bitsPerSample: 8,
                             samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  image.draw(in: NSRect(origin: .zero, size: px))
  NSGraphicsContext.restoreGraphicsState()
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(dir)/cursor-\(name).png"))
  spots.append("\"\(name)\": {\"pt\": [\(image.size.width), \(image.size.height)], \"hot\": [\(cursor.hotSpot.x), \(cursor.hotSpot.y)]}")
}
print("{\(spots.joined(separator: ", "))}")
