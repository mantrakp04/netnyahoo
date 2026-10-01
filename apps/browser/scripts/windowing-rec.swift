// The frame recorder windowing-test.mjs builds and runs: every on-screen window of one process, composited as the
// screen shows them (ScreenCaptureKit, the display's own frames, at up to 60 fps), as small grey pictures.
//
//   windowing-rec <pid> <seconds> <out.jsonl>
//
// One JSON line per frame: {"t": <unix ms>, "w": <px>, "h": <px>, "g": <base64 grey bytes>}, at an eighth of the
// display's size in points (one pixel per 8 × 8 points). Windows the process opens while it records join in. Only
// this process's windows: an application filter would take every instance of the bundle (the owner's too).
import AppKit
import CoreImage
import ScreenCaptureKit

let args = CommandLine.arguments
guard args.count == 4, let pid = Int32(args[1]), let seconds = Double(args[2]) else {
  FileHandle.standardError.write("usage: windowing-rec <pid> <seconds> <out.jsonl>\n".data(using: .utf8)!)
  exit(2)
}
let out = FileHandle(forWritingAtPath: args[3]) ?? {
  FileManager.default.createFile(atPath: args[3], contents: nil)
  return FileHandle(forWritingAtPath: args[3])!
}()

final class Recorder: NSObject, SCStreamOutput {
  let context = CIContext()
  var frames = 0
  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, let pixels = CMSampleBufferGetImageBuffer(buffer) else { return }
    if let info = (CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]])?.first,
      let status = info[.status] as? Int, status != SCFrameStatus.complete.rawValue
    { return }
    let image = CIImage(cvPixelBuffer: pixels)
    let width = Int(image.extent.width), height = Int(image.extent.height)
    var grey = [UInt8](repeating: 0, count: width * height)
    let space = CGColorSpaceCreateDeviceGray()
    grey.withUnsafeMutableBytes { bytes in
      context.render(image, toBitmap: bytes.baseAddress!, rowBytes: width, bounds: image.extent, format: .L8, colorSpace: space)
    }
    let t = Int(Date().timeIntervalSince1970 * 1000)
    let line = "{\"t\":\(t),\"w\":\(width),\"h\":\(height),\"g\":\"\(Data(grey).base64EncodedString())\"}\n"
    out.write(line.data(using: .utf8)!)
    frames += 1
  }
}

let recorder = Recorder()
Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let display = content.displays.first else { print("no display"); exit(1) }
    let mine = { (all: [SCWindow]) in all.filter { $0.owningApplication?.processID == pid } }
    let config = SCStreamConfiguration()
    config.width = display.width / 8
    config.height = display.height / 8
    config.minimumFrameInterval = CMTime(value: 1, timescale: 60)
    config.showsCursor = false
    config.queueDepth = 8
    let stream = SCStream(filter: SCContentFilter(display: display, including: mine(content.windows)), configuration: config, delegate: nil)
    try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: DispatchQueue(label: "frames"))
    try await stream.startCapture()
    print("started"); fflush(stdout)
    var known = Set(mine(content.windows).map(\.windowID))
    let end = Date().addingTimeInterval(seconds)
    while Date() < end {
      try await Task.sleep(nanoseconds: 30_000_000)
      guard let now = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true) else { continue }
      let windows = mine(now.windows)
      let ids = Set(windows.map(\.windowID))
      if ids != known {
        known = ids
        try? await stream.updateContentFilter(SCContentFilter(display: display, including: windows))
      }
    }
    try await stream.stopCapture()
    print("frames \(recorder.frames)"); exit(0)
  } catch {
    print("error \(error)"); exit(1)
  }
}
RunLoop.main.run()
