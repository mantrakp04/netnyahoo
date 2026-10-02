import Foundation

// Holds a decrypted secret (cookie value, card number) in memory we own, so it can be zeroed. Never copy the
// contents into a String, Data or [UInt8]: those can't be wiped.
public final class SecretBytes: @unchecked Sendable, Equatable {
  private let buffer: UnsafeMutableRawPointer
  private let capacity: Int
  public private(set) var count: Int

  public init(count: Int) {
    capacity = max(count, 1)
    buffer = UnsafeMutableRawPointer.allocate(byteCount: capacity, alignment: 16)
    buffer.initializeMemory(as: UInt8.self, repeating: 0, count: capacity)
    self.count = max(count, 0)
  }

  public convenience init(copying bytes: UnsafeRawBufferPointer) {
    self.init(count: bytes.count)
    if let base = bytes.baseAddress, bytes.count > 0 { buffer.copyMemory(from: base, byteCount: bytes.count) }
  }

  public convenience init<S: Sequence>(_ bytes: S) where S.Element == UInt8 {
    let array = Array(bytes)
    self.init(count: array.count)
    array.withUnsafeBytes { if let base = $0.baseAddress, !$0.isEmpty { buffer.copyMemory(from: base, byteCount: $0.count) } }
  }

  deinit {
    wipe()
    buffer.deallocate()
  }

  public func withUnsafeBytes<R>(_ body: (UnsafeRawBufferPointer) throws -> R) rethrows -> R {
    try body(UnsafeRawBufferPointer(start: buffer, count: count))
  }

  func withUnsafeMutableBytes<R>(_ body: (UnsafeMutableRawBufferPointer) throws -> R) rethrows -> R {
    try body(UnsafeMutableRawBufferPointer(start: buffer, count: count))
  }

  /// Copies `range` into a new right-sized SecretBytes.
  func slice(_ range: Range<Int>) -> SecretBytes {
    precondition(range.lowerBound >= 0 && range.upperBound <= count)
    return SecretBytes(copying: UnsafeRawBufferPointer(start: buffer + range.lowerBound, count: range.count))
  }

  /// Shrinks the visible length (the tail stays allocated and gets wiped with the rest).
  func truncate(to newCount: Int) {
    precondition(newCount >= 0 && newCount <= count)
    count = newCount
  }

  public func wipe() {
    _ = memset_s(buffer, capacity, 0, capacity)
  }

  public static func == (lhs: SecretBytes, rhs: SecretBytes) -> Bool {
    guard lhs.count == rhs.count else { return false }
    return lhs.count == 0 || memcmp(lhs.buffer, rhs.buffer, lhs.count) == 0
  }

  var isValidUTF8: Bool { withUnsafeBytes { UTF8Check.isValid($0) } }
}

extension SecretBytes: CustomStringConvertible, CustomDebugStringConvertible {
  public var description: String { "SecretBytes(\(count) bytes)" }
  public var debugDescription: String { description }
}

// Growable byte buffer for building wire payloads; every reallocation wipes the old storage.
final class SecretWriter {
  private var storage: SecretBytes
  private(set) var count = 0

  init(capacity: Int = 1024) { storage = SecretBytes(count: max(capacity, 16)) }

  private func reserve(_ extra: Int) {
    guard count + extra > storage.count else { return }
    var newCapacity = storage.count * 2
    while newCapacity < count + extra { newCapacity *= 2 }
    let bigger = SecretBytes(count: newCapacity)
    let used = count
    storage.withUnsafeBytes { src in
      bigger.withUnsafeMutableBytes { dst in
        if used > 0 { dst.baseAddress!.copyMemory(from: src.baseAddress!, byteCount: used) }
      }
    }
    storage.wipe()
    storage = bigger
  }

  func append(_ bytes: UnsafeRawBufferPointer) {
    guard !bytes.isEmpty else { return }
    reserve(bytes.count)
    let at = count
    storage.withUnsafeMutableBytes { dst in (dst.baseAddress! + at).copyMemory(from: bytes.baseAddress!, byteCount: bytes.count) }
    count += bytes.count
  }

  func append(_ byte: UInt8) {
    reserve(1)
    let at = count
    storage.withUnsafeMutableBytes { $0[at] = byte }
    count += 1
  }

  /// For non-secret ASCII/UTF-8 text (keys, numbers, punctuation).
  func append(_ text: String) {
    var text = text
    text.withUTF8 { append(UnsafeRawBufferPointer($0)) }
  }

  func truncate(to n: Int) {
    precondition(n <= count)
    storage.withUnsafeMutableBytes { dst in
      if count > n { _ = memset_s(dst.baseAddress! + n, count - n, 0, count - n) }
    }
    count = n
  }

  /// Hands over the bytes as a right-sized SecretBytes and wipes the working buffer.
  func finish() -> SecretBytes {
    let out = storage.slice(0..<count)
    storage.wipe()
    count = 0
    return out
  }
}

enum UTF8Check {
  static func isValid(_ bytes: UnsafeRawBufferPointer) -> Bool {
    var i = 0
    let n = bytes.count
    while i < n {
      let b = bytes[i]
      if b < 0x80 { i += 1; continue }
      let len: Int
      let min: UInt32
      var cp: UInt32
      switch b {
      case 0xC2...0xDF: len = 2; cp = UInt32(b & 0x1F); min = 0x80
      case 0xE0...0xEF: len = 3; cp = UInt32(b & 0x0F); min = 0x800
      case 0xF0...0xF4: len = 4; cp = UInt32(b & 0x07); min = 0x10000
      default: return false
      }
      guard i + len <= n else { return false }
      for k in 1..<len {
        let c = bytes[i + k]
        guard c & 0xC0 == 0x80 else { return false }
        cp = (cp << 6) | UInt32(c & 0x3F)
      }
      guard cp >= min, cp <= 0x10FFFF, !(0xD800...0xDFFF).contains(cp) else { return false }
      i += len
    }
    return true
  }
}
