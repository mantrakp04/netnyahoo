// Lifts every foreground subject out of an image with macOS Vision
// (VNGenerateForegroundInstanceMaskRequest) and writes an RGBA PNG.
// Usage: swift cutout.swift <in.png> <out.png>
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: cutout <in> <out>\n".data(using: .utf8)!)
  exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let input = CIImage(contentsOf: inURL) else { fatalError("cannot read \(inURL.path)") }
let handler = VNImageRequestHandler(ciImage: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let obs = request.results?.first else { fatalError("no foreground found") }
let buffer = try obs.generateMaskedImage(
  ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false)
let masked = CIImage(cvPixelBuffer: buffer)
let ctx = CIContext()
guard let cs = CGColorSpace(name: CGColorSpace.sRGB) else { fatalError() }
try ctx.writePNGRepresentation(of: masked, to: outURL, format: .RGBA8, colorSpace: cs)
print("instances=\(obs.allInstances.count) -> \(outURL.path)")
