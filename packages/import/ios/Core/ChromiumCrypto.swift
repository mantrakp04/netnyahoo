import CommonCrypto
import CryptoKit
import Foundation
import Security

public enum ChromiumCrypto {
  static let prefix = Data("v10".utf8)
  static let salt = Data("saltysalt".utf8)
  static let rounds: UInt32 = 1003
  static let iv = Data(repeating: 0x20, count: kCCBlockSizeAES128)

  public static func deriveKey(secret: Data) -> Data {
    var key = Data(count: kCCKeySizeAES128)
    let status = key.withUnsafeMutableBytes { out in
      secret.withUnsafeBytes { secret in
        salt.withUnsafeBytes { salt in
          CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                               secret.bindMemory(to: Int8.self).baseAddress, secret.count,
                               salt.bindMemory(to: UInt8.self).baseAddress, salt.count,
                               CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), rounds,
                               out.bindMemory(to: UInt8.self).baseAddress, kCCKeySizeAES128)
        }
      }
    }
    return status == kCCSuccess ? key : Data()
  }

  public static func isEncrypted(_ value: Data) -> Bool {
    value.count > prefix.count && value.prefix(prefix.count) == prefix
  }

  public static func decryptData(_ value: Data, key: Data) -> Data? {
    guard key.count == kCCKeySizeAES128, isEncrypted(value) else { return nil }
    let body = value.dropFirst(prefix.count)
    guard !body.isEmpty, body.count % kCCBlockSizeAES128 == 0 else { return nil }
    return AES.cbc(.decrypt, Data(body), key: key, iv: iv)
  }

  /// Decrypts a v10 value straight into SecretBytes (no Data/String copy of the plaintext). Anything else (v11,
  /// v20, a truncated value) is undecryptable: plaintext lives in its own column. With `hostKey` (Cookies DB
  /// version 24+), the plaintext must start with SHA-256(hostKey), which is stripped; without it the value is rejected.
  static func decryptSecret(_ value: Data, key: Data, hostKey: String? = nil) -> SecretBytes? {
    guard isEncrypted(value) else { return nil }
    guard key.count == kCCKeySizeAES128 else { return nil }
    let bodyCount = value.count - prefix.count
    guard bodyCount > 0, bodyCount % kCCBlockSizeAES128 == 0 else { return nil }
    let scratch = SecretBytes(count: bodyCount)
    var written = 0
    let status = scratch.withUnsafeMutableBytes { dst in
      value.withUnsafeBytes { src in
        iv.withUnsafeBytes { iv in
          key.withUnsafeBytes { key in
            CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                    key.baseAddress, key.count, iv.baseAddress,
                    src.baseAddress! + prefix.count, bodyCount, dst.baseAddress, dst.count, &written)
          }
        }
      }
    }
    guard status == kCCSuccess, written >= 0, written <= bodyCount else {
      scratch.wipe()
      return nil
    }
    var start = 0
    if let hostKey {
      let hash = SHA256.hash(data: Data(hostKey.utf8))
      let matches = written >= SHA256.byteCount && scratch.withUnsafeBytes { plain in
        hash.withUnsafeBytes { memcmp(plain.baseAddress!, $0.baseAddress!, SHA256.byteCount) == 0 }
      }
      guard matches else {
        scratch.wipe()
        return nil
      }
      start = SHA256.byteCount
    }
    let out = scratch.slice(start..<written)
    scratch.wipe()
    return out
  }

  public static func decrypt(_ value: Data, key: Data, hostKey: String? = nil) -> String? {
    guard isEncrypted(value) else { return String(data: value, encoding: .utf8) }
    guard var plain = decryptData(value, key: key) else { return nil }
    if let hostKey {
      let hash = Data(SHA256.hash(data: Data(hostKey.utf8)))
      if plain.count >= hash.count, plain.prefix(hash.count) == hash { plain = plain.dropFirst(hash.count) }
    }
    return String(data: plain, encoding: .utf8)
  }
}

enum AES {
  enum Operation { case encrypt, decrypt }

  static func cbc(_ op: Operation, _ input: Data, key: Data, iv: Data, algorithm: CCAlgorithm = CCAlgorithm(kCCAlgorithmAES),
                  blockSize: Int = kCCBlockSizeAES128, padding: Bool = true) -> Data? {
    if op == .decrypt && padding {
      guard !input.isEmpty, input.count % blockSize == 0,
            let raw = cbc(.decrypt, input, key: key, iv: iv, algorithm: algorithm, blockSize: blockSize, padding: false),
            let pad = raw.last, pad > 0, Int(pad) <= blockSize,
            raw.suffix(Int(pad)).allSatisfy({ $0 == pad }) else { return nil }
      return raw.dropLast(Int(pad))
    }
    var out = Data(count: input.count + blockSize)
    let outCapacity = out.count
    var written = 0
    let status = out.withUnsafeMutableBytes { dst in
      input.withUnsafeBytes { src in
        iv.withUnsafeBytes { iv in
          key.withUnsafeBytes { key in
            CCCrypt(CCOperation(op == .encrypt ? kCCEncrypt : kCCDecrypt), algorithm,
                    CCOptions(padding ? kCCOptionPKCS7Padding : 0),
                    key.baseAddress, key.count, iv.baseAddress,
                    src.baseAddress, src.count, dst.baseAddress, outCapacity, &written)
          }
        }
      }
    }
    return status == kCCSuccess ? out.prefix(written) : nil
  }

  static func unpadLeniently(_ data: Data, blockSize: Int) -> Data {
    guard let last = data.last, last > 0, Int(last) <= blockSize, Int(last) <= data.count,
          data.suffix(Int(last)).allSatisfy({ $0 == last }) else { return data }
    return data.dropLast(Int(last))
  }
}

public enum SafeStorageKeychain {
  // Call only after explicit unlock consent; Keychain access shows a system prompt.
  public static func secret(service: String, account: String) throws -> Data {
    for query in [account as String?, nil] {
      var q: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      if let query { q[kSecAttrAccount as String] = query }
      var item: CFTypeRef?
      let status = SecItemCopyMatching(q as CFDictionary, &item)
      switch status {
      case errSecSuccess:
        guard let data = item as? Data, !data.isEmpty else { throw ImportError.locked("\(service) is empty") }
        return data
      case errSecItemNotFound:
        continue
      case errSecUserCanceled, errSecAuthFailed, errSecInteractionNotAllowed:
        throw ImportError.locked("Access to \(service) was denied")
      default:
        throw ImportError.locked("Keychain error \(status) reading \(service)")
      }
    }
    throw ImportError.notFound("No \(service) item in the Keychain")
  }
}
