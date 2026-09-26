import AppKit
import CoreImage
import Foundation

/// The Recovery Kit the user saves when sync is turned on: a one-page PDF (as Dia's
/// "Dia Recovery Kit.pdf", US Letter) or a plain text sheet, with the 24 words and a QR code
/// of them for moving them to another Mac.
public enum RecoveryKit {
  public static let pdfName = "Netnyahoo Recovery Kit.pdf"
  public static let textName = "Netnyahoo Recovery Kit.txt"

  static let intro = "If you don’t have access to the Mac on which you first turned on sync, you can still get your synced data on another Mac:"
  static let steps = [
    "Open Netnyahoo › Settings › Sync, and choose the same sync folder.",
    "Click Enter Recovery Phrase.",
    "Paste the 24 words below.",
  ]
  static let warning = "Keep this kit somewhere safe, like a password manager or a printed copy. Anyone with these words and your sync folder can read your synced data. Netnyahoo can’t recover the words for you: there’s no server and no other copy."

  public static func text(words: [String], created: Date, device: String) -> String {
    let date = DateFormatter.localizedString(from: created, dateStyle: .long, timeStyle: .none)
    var lines = ["Netnyahoo Recovery Kit", "Created \(date) on \(device)", "", intro, ""]
    lines += steps.enumerated().map { "\($0 + 1). \($1)" }
    lines += ["", "Recovery phrase:", ""]
    lines += words.enumerated().map { String(format: "%2d. %@", $0 + 1, $1) }
    lines += ["", warning, ""]
    return lines.joined(separator: "\n")
  }

  /// A QR code of the phrase (space-separated words), `scale` points per module.
  public static func qrCode(words: [String], scale: CGFloat = 8) -> CGImage? {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(Data(words.joined(separator: " ").utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)) else { return nil }
    return CIContext(options: [.useSoftwareRenderer: true]).createCGImage(output, from: output.extent)
  }

  public static func png(_ image: CGImage) -> Data? {
    NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
  }

  public static func pdf(words: [String], created: Date, device: String) -> Data {
    let data = NSMutableData()
    var box = CGRect(x: 0, y: 0, width: 612, height: 792)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
          let context = CGContext(consumer: consumer, mediaBox: &box, [kCGPDFContextTitle as String: "Netnyahoo Recovery Kit"] as CFDictionary)
    else { return Data() }
    context.beginPDFPage(nil)
    let previous = NSGraphicsContext.current
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    // Flipped: y grows downwards from the top of the page.
    context.translateBy(x: 0, y: box.height)
    context.scaleBy(x: 1, y: -1)
    draw(words: words, created: created, device: device, in: box.size)
    NSGraphicsContext.current = previous
    context.endPDFPage()
    context.closePDF()
    return data as Data
  }

  static func draw(words: [String], created: Date, device: String, in page: CGSize) {
    let margin: CGFloat = 60
    let width = page.width - margin * 2
    let ink = NSColor(white: 0.1, alpha: 1)
    let grey = NSColor(white: 0.4, alpha: 1)
    var y: CGFloat = 64

    func text(_ string: String, _ font: NSFont, _ color: NSColor, x: CGFloat = margin, width: CGFloat = width, spacing: CGFloat = 8) {
      let style = NSMutableParagraphStyle()
      style.lineSpacing = 3
      let attributed = NSAttributedString(string: string, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: style])
      let height = ceil(attributed.boundingRect(with: CGSize(width: width, height: 1000), options: [.usesLineFragmentOrigin]).height)
      attributed.draw(with: CGRect(x: x, y: y, width: width, height: height), options: [.usesLineFragmentOrigin])
      y += height + spacing
    }

    text("Netnyahoo Recovery Kit", .boldSystemFont(ofSize: 26), ink, spacing: 4)
    let date = DateFormatter.localizedString(from: created, dateStyle: .long, timeStyle: .none)
    text("Created \(date) on \(device)", .systemFont(ofSize: 12), grey, spacing: 26)
    text(intro, .systemFont(ofSize: 13), ink, spacing: 10)
    for (i, step) in steps.enumerated() {
      text("\(i + 1).  \(step)", .systemFont(ofSize: 13), ink, x: margin + 8, width: width - 8, spacing: 4)
    }
    y += 18

    // The words: four columns of six, in a rounded box.
    let boxRect = CGRect(x: margin, y: y, width: width, height: 6 * 26 + 30)
    let path = NSBezierPath(roundedRect: boxRect, xRadius: 12, yRadius: 12)
    NSColor(white: 0.96, alpha: 1).setFill()
    path.fill()
    NSColor(white: 0.82, alpha: 1).setStroke()
    path.lineWidth = 1
    path.stroke()
    let columnWidth = (boxRect.width - 36) / 4
    let number = NSFont.monospacedDigitSystemFont(ofSize: 10, weight: .regular)
    let wordFont = NSFont(name: "Courier-Bold", size: 14) ?? .monospacedSystemFont(ofSize: 14, weight: .bold)
    for (i, word) in words.enumerated() {
      let x = boxRect.minX + 18 + CGFloat(i / 6) * columnWidth
      let rowY = boxRect.minY + 15 + CGFloat(i % 6) * 26
      let label = NSAttributedString(string: "\(i + 1)", attributes: [.font: number, .foregroundColor: grey])
      label.draw(at: CGPoint(x: x + 14 - label.size().width, y: rowY + 3))
      NSAttributedString(string: word, attributes: [.font: wordFont, .foregroundColor: ink]).draw(at: CGPoint(x: x + 20, y: rowY))
    }
    y = boxRect.maxY + 22

    // The QR code of the words, with what it's for.
    let qrSide: CGFloat = 112
    if let qr = qrCode(words: words, scale: 4) {
      NSGraphicsContext.current?.imageInterpolation = .none
      NSImage(cgImage: qr, size: CGSize(width: qrSide, height: qrSide))
        .draw(in: CGRect(x: margin, y: y, width: qrSide, height: qrSide), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }
    let captionY = y
    y += 18
    text("Moving to a new Mac?", .boldSystemFont(ofSize: 12), ink, x: margin + qrSide + 18, width: width - qrSide - 18, spacing: 4)
    text("Scan this code with your iPhone’s camera to copy the words, then paste them on the new Mac with Universal Clipboard.",
         .systemFont(ofSize: 12), grey, x: margin + qrSide + 18, width: width - qrSide - 18)
    y = max(y, captionY + qrSide) + 26
    text(warning, .systemFont(ofSize: 11), grey)
  }
}
