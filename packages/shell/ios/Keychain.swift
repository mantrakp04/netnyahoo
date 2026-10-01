import ExpoModulesCore
import Foundation
import Security

public class KeychainModule: Module {
  private static let service = "Netnyahoo Connected Accounts"

  public func definition() -> ModuleDefinition {
    Name("NetnyahooKeychain")

    AsyncFunction("get") { (account: String) -> String? in
      if let store = IsolatedSecrets.shared { return store.get(account) }
      var query = Self.query(account)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      #if DEBUG
      // Skip cross-build keychain reads to avoid access prompts.
      query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
      #endif
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("set") { (account: String, secret: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, secret) }
      let data = Data(secret.utf8)
      let update: [String: Any] = [kSecValueData as String: data]
      var status = SecItemUpdate(Self.query(account) as CFDictionary, update as CFDictionary)
      if status == errSecItemNotFound {
        var add = Self.query(account)
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Netnyahoo: \(account)"
        status = SecItemAdd(add as CFDictionary, nil)
      } else if status != errSecSuccess {
        SecItemDelete(Self.query(account) as CFDictionary)
        var add = Self.query(account)
        add[kSecValueData as String] = data
        status = SecItemAdd(add as CFDictionary, nil)
      }
      return status == errSecSuccess
    }

    AsyncFunction("delete") { (account: String) -> Bool in
      if let store = IsolatedSecrets.shared { return store.set(account, nil) }
      let status = SecItemDelete(Self.query(account) as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }
  }

  private static func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }
}

// A test instance's connected accounts: a file in its data dir instead of items in the owner's login keychain.
private final class IsolatedSecrets {
  static let shared = NNIsolatedDataDirectory().map {
    IsolatedSecrets(URL(fileURLWithPath: $0, isDirectory: true).appendingPathComponent("Connected Accounts.json"))
  }

  private let url: URL
  private let lock = NSLock()

  private init(_ url: URL) { self.url = url }

  // Nil when the file is there but unreadable: a write then fails instead of dropping the other accounts.
  private func load() -> [String: String]? {
    guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode([String: String].self, from: data)
  }

  func get(_ account: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return load()?[account]
  }

  func set(_ account: String, _ secret: String?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard var secrets = load() else { return false }
    secrets[account] = secret
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(secrets).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
      return true
    } catch {
      return false
    }
  }
}
