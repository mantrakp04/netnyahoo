import CryptoKit
import Foundation

/// Keys derived from the recovery phrase's entropy, and the sealed file format.
///
/// - HKDF-SHA256 over the 256-bit entropy (salt "netnyahoo-sync/v1") gives two keys: one for
///   AES-256-GCM on every file, one (HMAC-SHA256) for the folder and scope names.
/// - A file is `"NNS1" | nonce (12) | ciphertext | tag (16)`. The associated data binds it to
///   its place (chain tag, scope tag, file id), so a file copied or renamed elsewhere won't open.
/// - The plaintext is `length (u32, big endian) | payload | zeros` to the next 1 KiB, so a
///   file's size says little about what's in it.
public struct SyncKeys {
  static let magic = Data("NNS1".utf8)
  static let salt = Data("netnyahoo-sync/v1".utf8)
  static let padding = 1024

  let fileKey: SymmetricKey
  let nameKey: SymmetricKey

  public enum Failure: Error, Equatable {
    /// Too short or not ours: still arriving, or not a sync file.
    case format
    /// The tag doesn't match: damaged, cut short, tampered with, or another phrase's.
    case authentication
  }

  public init(entropy: Data) {
    let ikm = SymmetricKey(data: entropy)
    fileKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("file-key".utf8), outputByteCount: 32)
    nameKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("name-key".utf8), outputByteCount: 32)
  }

  /// The folder of this phrase's data inside the sync folder: 26 base32 letters that don't
  /// reveal the phrase, so several phrases (people) can share one sync folder.
  public var chainTag: String { tag("chain") }

  /// The folder of one scope (the app, or one profile) inside the chain.
  public func scopeTag(_ scope: String) -> String { tag("scope/" + scope) }

  func tag(_ label: String) -> String {
    Base32.encode(Data(HMAC<SHA256>.authenticationCode(for: Data(label.utf8), using: nameKey)).prefix(16))
  }

  static func associatedData(chain: String, scope: String, file: String) -> Data {
    magic + Data("\(chain)/\(scope)/\(file)".utf8)
  }

  public func seal(_ payload: Data, scopeTag: String, fileId: String) throws -> Data {
    var plain = withUnsafeBytes(of: UInt32(payload.count).bigEndian) { Data($0) } + payload
    plain.append(Data(count: (Self.padding - plain.count % Self.padding) % Self.padding))
    let box = try AES.GCM.seal(plain, using: fileKey, authenticating: Self.associatedData(chain: chainTag, scope: scopeTag, file: fileId))
    return Self.magic + box.nonce + box.ciphertext + box.tag
  }

  public func open(_ file: Data, scopeTag: String, fileId: String) throws -> Data {
    let file = Data(file)
    guard file.count >= Self.magic.count + 12 + 16 + 4, file.prefix(Self.magic.count) == Self.magic else { throw Failure.format }
    let body = file.dropFirst(Self.magic.count)
    let plain: Data
    do {
      let box = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: body.prefix(12)), ciphertext: body.dropFirst(12).dropLast(16), tag: body.suffix(16))
      plain = try AES.GCM.open(box, using: fileKey, authenticating: Self.associatedData(chain: chainTag, scope: scopeTag, file: fileId))
    } catch {
      throw Failure.authentication
    }
    let length = plain.prefix(4).reduce(0) { $0 << 8 | Int($1) }
    guard length <= plain.count - 4 else { throw Failure.format }
    return Data(plain.dropFirst(4).prefix(length))
  }

  /// A new random file id (128 bits, base32), so names say nothing about what's inside.
  public static func newFileId() -> String {
    Base32.encode(RecoveryPhrase.generateEntropy().prefix(16))
  }
}

/// RFC 4648 base32, lowercase, unpadded: file-system and case-insensitive safe.
enum Base32 {
  static let alphabet = Array("abcdefghijklmnopqrstuvwxyz234567")

  static func encode(_ data: Data) -> String {
    var out = ""
    var buffer = 0, bits = 0
    for byte in data {
      buffer = buffer << 8 | Int(byte)
      bits += 8
      while bits >= 5 {
        out.append(alphabet[(buffer >> (bits - 5)) & 31])
        bits -= 5
      }
      buffer &= (1 << bits) - 1
    }
    if bits > 0 { out.append(alphabet[(buffer << (5 - bits)) & 31]) }
    return out
  }

  static func isTag(_ name: String) -> Bool {
    name.count == 26 && name.allSatisfy { alphabet.contains($0) }
  }
}
