import CryptoKit
import Foundation
import Security

/// The recovery phrase: 24 BIP-39 English words, as Dia's. They encode 256 bits of entropy
/// from the system CSPRNG plus an 8-bit checksum (the first byte of the entropy's SHA-256), so a
/// typo is caught before anything is tried against the folder.
public enum RecoveryPhrase {
  public static let wordCount = 24
  static let entropyBytes = 32

  public enum Problem: Error, Equatable {
    /// Not 24 words (the count found).
    case wordCount(Int)
    /// A word that isn't on the list (as typed).
    case unknownWord(String)
    /// Every word is on the list but the checksum doesn't match: a word is wrong or out of order.
    case checksum
  }

  /// 32 bytes from SecRandomCopyBytes.
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

  /// The words in `text`, lowercased. Anything that isn't a letter separates words, so the
  /// numbered lines of the recovery kit ("1. abandon") paste as they are.
  public static func tokens(in text: String) -> [String] {
    text.lowercased().components(separatedBy: CharacterSet.lowercaseLetters.inverted).filter { !$0.isEmpty }
  }

  /// A word on the list: the word itself, or its first four letters (BIP-39 keeps them unique).
  static func index(of token: String) -> Int? {
    if let i = lookup[token] { return i }
    guard token.count >= 4 else { return nil }
    return prefixes[String(token.prefix(4))].flatMap { i in Wordlist.english[i].hasPrefix(token) ? i : nil }
  }

  /// The entropy a phrase encodes, or the first problem with it.
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
