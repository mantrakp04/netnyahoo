import Compression
import Foundation

/// Minimal ZIP reader for Safari's export archive: central directory, stored and deflated
/// entries (Apple's `COMPRESSION_ZLIB` is raw DEFLATE, which is exactly ZIP method 8).
/// ZIP64 and encryption aren't needed for Safari exports and are reported as unsupported.
struct ZipArchive {
  struct Entry {
    var name: String
    var method: UInt16
    var compressedSize: Int
    var size: Int
    var localHeaderOffset: Int
  }

  let data: Data
  let entries: [Entry]

  init(_ data: Data) throws {
    self.data = data
    // End of central directory: signature 0x06054b50 within the last 64 KiB + 22 bytes.
    let minEOCD = 22
    guard data.count >= minEOCD else { throw ImportError.unreadable("Not a zip file") }
    var eocd: Int?
    var i = data.count - minEOCD
    let floor = max(0, data.count - minEOCD - 0xFFFF)
    while i >= floor {
      if data[i] == 0x50, data[i + 1] == 0x4B, data[i + 2] == 0x05, data[i + 3] == 0x06 { eocd = i; break }
      i -= 1
    }
    guard let eocd else { throw ImportError.unreadable("Not a zip file") }
    var r = ByteReader(data.subdata(in: eocd..<data.count))
    _ = r.skip(10)
    guard let count = r.u16(), let _ = r.u32(), let dirOffset = r.u32() else { throw ImportError.unreadable("Damaged zip file") }
    if count == 0xFFFF || dirOffset == 0xFFFF_FFFF { throw ImportError.unsupported("ZIP64 archives aren't supported") }

    var list: [Entry] = []
    var offset = Int(dirOffset)
    for _ in 0..<count {
      guard offset + 46 <= data.count else { throw ImportError.unreadable("Damaged zip directory") }
      var h = ByteReader(data.subdata(in: offset..<offset + 46))
      guard h.u32() == 0x0201_4B50 else { throw ImportError.unreadable("Damaged zip directory") }
      _ = h.skip(4)
      let flags = h.u16() ?? 0
      let method = h.u16() ?? 0
      _ = h.skip(8)
      let csize = Int(h.u32() ?? 0)
      let usize = Int(h.u32() ?? 0)
      let nameLength = Int(h.u16() ?? 0)
      let extraLength = Int(h.u16() ?? 0)
      let commentLength = Int(h.u16() ?? 0)
      _ = h.skip(8)
      let local = Int(h.u32() ?? 0)
      guard offset + 46 + nameLength <= data.count else { throw ImportError.unreadable("Damaged zip directory") }
      let nameData = data.subdata(in: offset + 46..<offset + 46 + nameLength)
      // Bit 11: UTF-8 names. Otherwise CP437, which is ASCII for the names Safari writes.
      let name = String(data: nameData, encoding: flags & 0x800 != 0 ? .utf8 : .isoLatin1) ?? ""
      if flags & 0x1 == 0 {
        list.append(Entry(name: name, method: method, compressedSize: csize, size: usize, localHeaderOffset: local))
      }
      offset += 46 + nameLength + extraLength + commentLength
    }
    entries = list
  }

  func extract(_ entry: Entry) throws -> Data {
    let o = entry.localHeaderOffset
    guard o + 30 <= data.count else { throw ImportError.unreadable("Damaged zip entry") }
    var h = ByteReader(data.subdata(in: o..<o + 30))
    guard h.u32() == 0x0403_4B50 else { throw ImportError.unreadable("Damaged zip entry") }
    _ = h.skip(22)
    let start = o + 30 + Int(h.u16() ?? 0) + Int(h.u16() ?? 0)
    guard start + entry.compressedSize <= data.count else { throw ImportError.unreadable("Damaged zip entry") }
    let body = data.subdata(in: start..<start + entry.compressedSize)
    switch entry.method {
    case 0:
      return body
    case 8:
      guard entry.size > 0 else { return Data() }
      var out = Data(count: entry.size)
      let written = out.withUnsafeMutableBytes { dst in
        body.withUnsafeBytes { src in
          compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, entry.size,
                                    src.bindMemory(to: UInt8.self).baseAddress!, body.count, nil, COMPRESSION_ZLIB)
        }
      }
      guard written == entry.size else { throw ImportError.unreadable("Couldn't inflate \(entry.name)") }
      return out
    default:
      throw ImportError.unsupported("Unsupported zip compression method \(entry.method)")
    }
  }
}
