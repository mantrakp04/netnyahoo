import CryptoKit
import Foundation
import Security

public enum RecoveryPhrase {
  public static let wordCount = 24
  static let entropyBytes = 32

  public enum Problem: Error, Equatable {
    case wordCount(Int)
    case unknownWord(String)
    case checksum
  }

  public static func generateEntropy() -> Data {
    var bytes = Data(count: entropyBytes)
    let status = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, entropyBytes, $0.baseAddress!) }
    precondition(status == errSecSuccess, "SecRandomCopyBytes failed: \(status)")
    return bytes
  }

  public static func words(for entropy: Data) -> [String] {
    precondition(entropy.count == entropyBytes)
    var bits = entropy.flatMap { byte in (0..<8).reversed().map { (byte >> $0) & 1 } }
    let checksum = Data(SHA256.hash(data: entropy)).first!
    bits += (0..<8).reversed().map { (checksum >> $0) & 1 }
    return stride(from: 0, to: bits.count, by: 11).map { start in
      Wordlist.english[bits[start..<start + 11].reduce(0) { $0 << 1 | Int($1) }]
    }
  }

  public static func tokens(in text: String) -> [String] {
    text.lowercased().components(separatedBy: CharacterSet.lowercaseLetters.inverted).filter { !$0.isEmpty }
  }

  static func index(of token: String) -> Int? {
    if let i = lookup[token] { return i }
    guard token.count >= 4 else { return nil }
    return prefixes[String(token.prefix(4))].flatMap { i in Wordlist.english[i].hasPrefix(token) ? i : nil }
  }

  public static func entropy(from text: String) throws -> Data {
    let tokens = tokens(in: text)
    guard tokens.count == wordCount else { throw Problem.wordCount(tokens.count) }
    var bits: [UInt8] = []
    for token in tokens {
      guard let i = index(of: token) else { throw Problem.unknownWord(token) }
      bits += (0..<11).reversed().map { UInt8((i >> $0) & 1) }
    }
    let entropy = Data(stride(from: 0, to: entropyBytes * 8, by: 8).map { start in
      bits[start..<start + 8].reduce(UInt8(0)) { $0 << 1 | $1 }
    })
    let checksum = bits[(entropyBytes * 8)...].reduce(UInt8(0)) { $0 << 1 | $1 }
    guard Data(SHA256.hash(data: entropy)).first! == checksum else { throw Problem.checksum }
    return entropy
  }

  private static let lookup = Dictionary(uniqueKeysWithValues: Wordlist.english.enumerated().map { ($1, $0) })
  private static let prefixes = Dictionary(uniqueKeysWithValues: Wordlist.english.enumerated().map { (String($1.prefix(4)), $0) })
}
