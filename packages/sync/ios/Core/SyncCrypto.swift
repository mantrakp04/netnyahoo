import CryptoKit
import Foundation

public struct SyncKeys {
  static let magic = Data("NNS1".utf8)
  static let salt = Data("netnyahoo-sync/v1".utf8)
  static let padding = 1024

  let fileKey: SymmetricKey
  let nameKey: SymmetricKey

  public enum Failure: Error, Equatable {
    case format
    case authentication
  }

  public init(entropy: Data) {
    let ikm = SymmetricKey(data: entropy)
    fileKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("file-key".utf8), outputByteCount: 32)
    nameKey = HKDF<SHA256>.deriveKey(inputKeyMaterial: ikm, salt: Self.salt, info: Data("name-key".utf8), outputByteCount: 32)
  }

  public var chainTag: String { tag("chain") }

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

  public static func newFileId() -> String {
    Base32.encode(RecoveryPhrase.generateEntropy().prefix(16))
  }
}

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
