import CommonCrypto
import CryptoKit
import Foundation
import Security

/// Chromium's at-rest encryption on macOS ("OSCrypt").
///
/// The browser keeps a random secret in the login Keychain as a generic password
/// (service "<Browser> Safe Storage", account "<Browser>"). The AES key is
/// PBKDF2-HMAC-SHA1(secret, salt "saltysalt", 1003 rounds, 16 bytes); values are
/// `"v10" + AES-128-CBC(key, iv = 16 × 0x20, PKCS#7)`. That covers `Login Data`
/// `password_value`, `Cookies` `encrypted_value`, and encrypted session files.
public enum ChromiumCrypto {
  static let prefix = Data("v10".utf8)
  static let salt = Data("saltysalt".utf8)
  static let rounds: UInt32 = 1003
  static let iv = Data(repeating: 0x20, count: kCCBlockSizeAES128)

  /// Derives the AES key from the Keychain secret. The secret is taken as bytes: a generic
  /// password isn't promised to be UTF-8 and a lossy decode would derive a key that opens
  /// nothing, silently.
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

  /// Decrypts one `v10` value to raw bytes. nil for a wrong key or a damaged value.
  public static func decryptData(_ value: Data, key: Data) -> Data? {
    guard key.count == kCCKeySizeAES128, isEncrypted(value) else { return nil }
    let body = value.dropFirst(prefix.count)
    guard !body.isEmpty, body.count % kCCBlockSizeAES128 == 0 else { return nil }
    return AES.cbc(.decrypt, Data(body), key: key, iv: iv)
  }

  /// Decrypts a password or cookie value to text.
  ///
  /// `hostKey`: since M130 (Cookies `meta.version` ≥ 24) a cookie's plaintext begins with
  /// SHA-256 of its `host_key`, so a value copied to another domain's row decrypts to junk.
  /// It's checked rather than assumed, so older cookies and `Login Data` rows read too.
  /// A value without the `v10` prefix predates encryption and is returned as-is.
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

/// CommonCrypto CBC with PKCS#7, shared by the Chromium and Firefox decryptors.
enum AES {
  enum Operation { case encrypt, decrypt }

  /// Decryption with `padding` checks PKCS#7 strictly itself: CommonCrypto doesn't reliably
  /// reject bad padding, and a bad pad is the only sign a wrong key leaves behind.
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

  /// Strips PKCS#7 padding when it's well-formed and leaves the data alone otherwise (NSS
  /// isn't consistent about padding the keys it wraps).
  static func unpadLeniently(_ data: Data, blockSize: Int) -> Data {
    guard let last = data.last, last > 0, Int(last) <= blockSize, Int(last) <= data.count,
          data.suffix(Int(last)).allSatisfy({ $0 == last }) else { return data }
    return data.dropLast(Int(last))
  }
}

/// Reads a Chromium browser's "Safe Storage" secret from the login Keychain.
///
/// This is the one call in the package that makes macOS show a Keychain prompt
/// ("Netnyahoo wants to use your confidential information stored in 'Chrome Safe Storage'"),
/// so it is only ever reached from an explicit, user-consented unlock in the UI.
public enum SafeStorageKeychain {
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
