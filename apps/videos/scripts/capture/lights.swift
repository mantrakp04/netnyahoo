// Renders macOS's own traffic-light buttons (AppKit's artwork, as an active window draws them) to a PNG, offscreen.
// The in-process window snapshot doesn't include the title bar, so the film adds these. usage: swift lights.swift out.png [dark|light]
import AppKit

final class KeyWindow: NSWindow {
  override var isKeyWindow: Bool { true }
  override var isMainWindow: Bool { true }
  // AppKit's own question when it picks the active or inactive artwork.
  @objc func _hasActiveAppearance() -> Bool { true }
  @objc func _hasActiveAppearanceIgnoringKeyFocus() -> Bool { true }
  @objc func _hasKeyAppearance() -> Bool { true }
  @objc func _hasMainAppearance() -> Bool { true }
}

let out = CommandLine.arguments[1]
let dark = CommandLine.arguments.count < 3 || CommandLine.arguments[2] == "dark"
// Reads as active, so the buttons draw in colour, without ever activating (the policy is .prohibited).
final class ActiveApp: NSApplication {
  override var isActive: Bool { true }
}
let app = ActiveApp.shared
app.setActivationPolicy(.prohibited)
app.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
let window = KeyWindow(contentRect: NSRect(x: -10000, y: -10000, width: 200, height: 60), styleMask: style, backing: .buffered, defer: true)
window.titlebarAppearsTransparent = true
// Measure spacing from a real titled window's layout.
window.contentView = NSView(frame: window.contentRect(forFrameRect: window.frame))
let real = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { window.standardWindowButton($0) }
var frames: [NSRect] = []
for b in real { frames.append(b.convert(b.bounds, to: nil)) }
let minX = frames.map(\.minX).min() ?? 0
let maxX = frames.map(\.maxX).max() ?? 60
let minY = frames.map(\.minY).min() ?? 0
let maxY = frames.map(\.maxY).max() ?? 16
let scale: CGFloat = 2
let pad: CGFloat = 2
let w = maxX - minX + pad * 2, h = maxY - minY + pad * 2
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(w * scale), pixelsHigh: Int(h * scale), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = ctx
ctx.cgContext.scaleBy(x: scale, y: scale)
window.displayIfNeeded()
for b in real { b.needsDisplay = true; b.isHighlighted = false; b.display() }
for (b, f) in zip(real, frames) {
  ctx.cgContext.saveGState()
  ctx.cgContext.translateBy(x: f.minX - minX + pad, y: f.minY - minY + pad)
  b.displayIgnoringOpacity(b.bounds, in: ctx)
  ctx.cgContext.restoreGState()
}
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
// Where the first button sits from the window's top-left, in points, for placement.
let top = window.frame.height - maxY
print("{\"x\": \(minX - pad), \"y\": \(top - pad), \"w\": \(w), \"h\": \(h)}")
