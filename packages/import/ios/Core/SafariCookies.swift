import Foundation

// Safari's Cookies.binarycookies. Layout (all offsets checked before use):
//   "cook", page count (BE u32), page sizes (BE u32 each), pages, then a checksum and footer we ignore.
//   Page: 00 00 01 00, cookie count (LE u32), cookie offsets (LE u32, from page start), 00 00 00 00.
//   Cookie (LE): size, version, flags (1 secure, 4 httpOnly), hasPort, domain/name/path/value/comment/commentURL
//   offsets (from cookie start), expiry and creation (Float64 seconds since 2001-01-01), [port u16], NUL-terminated
//   strings.
// The whole file is read into SecretBytes because cookie values sit in it as plaintext.
public enum SafariCookies {
  static let cocoaEpoch = 978_307_200.0
  static let maxFileSize = 512 << 20
  static let headerSize = 56

  public static func file(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
    [
      "Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies",
      "Library/Cookies/Cookies.binarycookies",
    ].map { home.appendingPathComponent($0) }.first { FileManager.default.fileExists(atPath: $0.path) }
  }

  public static func load(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                          cancellation: Cancellation = .init()) throws -> [Cookie] {
    guard let url = file(home: home) else { throw ImportError.notFound("No Safari cookies") }
    return try parse(read(url), cancellation: cancellation)
  }

  static func read(_ url: URL) throws -> SecretBytes {
    let fd = open(url.path, O_RDONLY | O_CLOEXEC)
    guard fd >= 0 else { throw ImportError.unreadable("Couldn't open \(url.lastPathComponent) (errno \(errno))") }
    defer { close(fd) }
    var st = stat()
    guard fstat(fd, &st) == 0 else { throw ImportError.unreadable("Couldn't read \(url.lastPathComponent)") }
    let size = Int(st.st_size)
    guard size >= 0, size <= maxFileSize else { throw ImportError.unreadable("\(url.lastPathComponent) is too large") }
    let bytes = SecretBytes(count: size)
    var done = 0
    try bytes.withUnsafeMutableBytes { dst in
      while done < size {
        let n = Darwin.read(fd, dst.baseAddress! + done, size - done)
        if n < 0 && errno == EINTR { continue }
        guard n > 0 else { throw ImportError.unreadable("Couldn't read \(url.lastPathComponent)") }
        done += n
      }
    }
    return bytes
  }

  public static func parse(_ bytes: SecretBytes, now: Date = Date(), cancellation: Cancellation = .init()) throws -> [Cookie] {
    try bytes.withUnsafeBytes { try parse($0, now: now.timeIntervalSince1970 * 1000, cancellation: cancellation) }
  }

  private struct Malformed: Error {}

  static func parse(_ p: UnsafeRawBufferPointer, now: Double, cancellation: Cancellation) throws -> [Cookie] {
    do {
      return try parseUnchecked(p, now: now, cancellation: cancellation)
    } catch is Malformed {
      throw ImportError.unreadable("Safari's cookie file is damaged")
    }
  }

  private static func parseUnchecked(_ p: UnsafeRawBufferPointer, now: Double, cancellation: Cancellation) throws -> [Cookie] {
    func be32(_ at: Int) throws -> Int {
      guard at >= 0, at + 4 <= p.count else { throw Malformed() }
      return Int(p[at]) << 24 | Int(p[at + 1]) << 16 | Int(p[at + 2]) << 8 | Int(p[at + 3])
    }
    guard p.count >= 8, p[0] == 0x63, p[1] == 0x6F, p[2] == 0x6F, p[3] == 0x6B else { throw Malformed() }  // "cook"
    let pages = try be32(4)
    guard pages <= (p.count - 8) / 4 else { throw Malformed() }
    var pageStart = 8 + 4 * pages
    var out: [Cookie] = []
    for i in 0..<pages {
      try cancellation.check()
      let size = try be32(8 + 4 * i)
      guard size <= p.count - pageStart else { throw Malformed() }
      let page = UnsafeRawBufferPointer(rebasing: p[pageStart..<(pageStart + size)])
      try parsePage(page, now: now, into: &out)
      pageStart += size
    }
    return out
  }

  private static func parsePage(_ page: UnsafeRawBufferPointer, now: Double, into out: inout [Cookie]) throws {
    func le32(_ buf: UnsafeRawBufferPointer, _ at: Int) throws -> Int {
      guard at >= 0, at + 4 <= buf.count else { throw Malformed() }
      return Int(buf[at]) | Int(buf[at + 1]) << 8 | Int(buf[at + 2]) << 16 | Int(buf[at + 3]) << 24
    }
    guard page.count >= 8, page[0] == 0, page[1] == 0, page[2] == 1, page[3] == 0 else { throw Malformed() }
    let count = try le32(page, 4)
    guard count <= (page.count - 8) / 4 else { throw Malformed() }
    for i in 0..<count {
      let start = try le32(page, 8 + 4 * i)
      guard start <= page.count - headerSize else { throw Malformed() }
      let size = try le32(page, start)
      guard size >= headerSize, size <= page.count - start else { throw Malformed() }
      let c = UnsafeRawBufferPointer(rebasing: page[start..<(start + size)])

      func double(_ at: Int) -> Double {
        var bits: UInt64 = 0
        for k in 0..<8 { bits |= UInt64(c[at + k]) << (8 * UInt64(k)) }
        return Double(bitPattern: bits)
      }
      func string(_ field: Int) throws -> UnsafeRawBufferPointer {
        let offset = try le32(c, field)
        guard offset >= headerSize, offset < c.count else { throw Malformed() }
        var end = offset
        while end < c.count && c[end] != 0 { end += 1 }
        guard end < c.count else { throw Malformed() }
        return UnsafeRawBufferPointer(rebasing: c[offset..<end])
      }
      func text(_ field: Int) throws -> String { String(decoding: try string(field), as: UTF8.self) }

      let flags = try le32(c, 8)
      let hasPort = try le32(c, 12) != 0
      let domain = try text(16)
      let name = try text(20)
      let path = try text(24)
      let value = try string(28)
      let expirySeconds = double(40)
      let createdSeconds = double(48)
      var port = -1
      if hasPort {
        guard c.count >= headerSize + 2 else { throw Malformed() }
        port = Int(c[56]) | Int(c[57]) << 8
      }
      guard !domain.isEmpty, !name.isEmpty || value.count > 0 else { continue }
      let expires = expirySeconds.isFinite && expirySeconds > 0 ? (expirySeconds + cocoaEpoch) * 1000 : nil
      if let expires, expires < now { continue }
      let created = createdSeconds.isFinite && createdSeconds > 0 ? (createdSeconds + cocoaEpoch) * 1000 : nil
      out.append(Cookie(
        domain: domain, name: name, value: SecretBytes(copying: value), path: path.isEmpty ? "/" : path,
        created: created, expires: expires, lastAccess: nil,
        secure: flags & 1 != 0, httpOnly: flags & 4 != 0,
        sameSite: "unspecified", priority: "medium", partition: nil,
        sourceScheme: "unset", sourcePort: port
      ))
    }
  }
}
