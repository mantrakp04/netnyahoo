import Foundation
import Security

/// Where this Mac keeps the phrase's entropy between launches.
public protocol SyncKeyStore {
  func load(account: String) -> Data?
  func save(_ secret: Data, account: String) -> Bool
  func delete(account: String)
}

/// The login Keychain: a generic password that stays on this Mac (not in iCloud Keychain),
/// readable after the first unlock since boot.
public struct KeychainKeyStore: SyncKeyStore {
  public let service: String

  public init(service: String = "Netnyahoo Sync Key") { self.service = service }

  func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrSynchronizable as String: false,
    ]
  }

  public func load(account: String) -> Data? {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    #if DEBUG
    // Each Debug build is signed differently: an item an earlier build saved would raise a
    // Keychain prompt (and take focus). Treat it as missing; the phrase can be entered again.
    // (The login keychain's ACL prompt honours this flag, as Keychain.swift in the shell relies on;
    // an LAContext's interactionNotAllowed only covers data-protection items.)
    q[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
    #endif
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return data
  }

  public func save(_ secret: Data, account: String) -> Bool {
    SecItemDelete(query(account) as CFDictionary)
    var add = query(account)
    add[kSecValueData as String] = secret
    add[kSecAttrLabel as String] = service
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }

  public func delete(account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}

/// For isolated test instances (NETNYAHOO_DATA_DIR), which keep off the login Keychain as
/// Chrome's mock keychain does: a 0600 file in the instance's data folder.
public struct FileKeyStore: SyncKeyStore {
  public let directory: URL

  public init(directory: URL) { self.directory = directory }

  func url(_ account: String) -> URL { directory.appendingPathComponent("sync-key-\(account)") }

  public func load(account: String) -> Data? { try? Data(contentsOf: url(account)) }

  public func save(_ secret: Data, account: String) -> Bool {
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try secret.write(to: url(account), options: [.atomic])
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url(account).path)
      return true
    } catch {
      return false
    }
  }

  public func delete(account: String) { try? FileManager.default.removeItem(at: url(account)) }
}
