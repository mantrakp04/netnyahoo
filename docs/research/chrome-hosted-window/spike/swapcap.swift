// Records what one app's windows show in a screen region, frame by frame (ScreenCaptureKit, up to
// 120 fps), to measure a window swap: other apps' windows are left out of the capture, so nothing
// covers the swap and the app never needs to be in front.
// usage: swapcap <pid> <seconds> <outDir> <x> <y> <w> <h> [fps]
//   x y w h: the region in global points (top-left origin of the main display), e.g. the window frame.
// Writes <outDir>/NNNNN.png and <outDir>/times.txt ("frame seconds"). Needs Screen Recording
// permission for the terminal running it, and an unlocked screen (a locked one delivers no frames).
// Build: swiftc -O swapcap.swift -o swapcap
import CoreImage
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 8, let pid = pid_t(args[1]), let seconds = Double(args[2]) else {
  FileHandle.standardError.write("usage: swapcap <pid> <seconds> <outDir> <x> <y> <w> <h> [fps]\n".data(using: .utf8)!)
  exit(2)
}
let outDir = args[3]
let region = CGRect(x: Double(args[4])!, y: Double(args[5])!, width: Double(args[6])!, height: Double(args[7])!)
let fps = args.count > 8 ? Int32(args[8])! : 120
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

final class Sink: NSObject, SCStreamOutput {
  let ctx = CIContext()
  let queue = DispatchQueue(label: "write")
  var count = 0
  var first: CMTime?
  var times: [String] = []
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, let pb = sb.imageBuffer else { return }
    // Only frames with new content (idle frames repeat the last one).
    if let info = (CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
       let raw = info[.status] as? Int, SCFrameStatus(rawValue: raw) != .complete { return }
    let pts = sb.presentationTimeStamp
    if first == nil { first = pts }
    let t = CMTimeGetSeconds(CMTimeSubtract(pts, first!))
    count += 1
    let n = count
    let image = CIImage(cvPixelBuffer: pb)
    guard let cg = ctx.createCGImage(image, from: image.extent) else { return }
    times.append(String(format: "%05d %.4f", n, t))
    queue.async {
      let url = URL(fileURLWithPath: "\(outDir)/\(String(format: "%05d", n)).png")
      guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
      CGImageDestinationAddImage(dest, cg, nil)
      CGImageDestinationFinalize(dest)
    }
  }
}

let sink = Sink()
let done = DispatchSemaphore(value: 0)
Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let app = content.applications.first(where: { $0.processID == pid }) else {
      print("no app with pid \(pid)"); exit(1)
    }
    guard let display = content.displays.first(where: { $0.frame.contains(region.origin) }) ?? content.displays.first else {
      print("no display"); exit(1)
    }
    let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
    let config = SCStreamConfiguration()
    // The region relative to the display, in points.
    config.sourceRect = CGRect(x: region.minX - display.frame.minX, y: region.minY - display.frame.minY,
                               width: region.width, height: region.height)
    config.width = Int(region.width * 2)
    config.height = Int(region.height * 2)
    config.minimumFrameInterval = CMTime(value: 1, timescale: fps)
    config.queueDepth = 8
    config.showsCursor = false
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
    try await stream.startCapture()
    try await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
    try await stream.stopCapture()
    sink.queue.sync {}
    try sink.times.joined(separator: "\n").write(toFile: "\(outDir)/times.txt", atomically: true, encoding: .utf8)
    print("\(sink.count) frames in \(outDir)")
  } catch {
    print("capture failed: \(error)")
    exit(1)
  }
  done.signal()
}
done.wait()
