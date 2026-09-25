import ExpoModulesCore
import Foundation
import Security

/// Secrets for connected services (live folders' GitHub / Bitbucket / Notion / Confluence /
/// Google tokens) as generic passwords in the login keychain, never in the session files.
public class KeychainModule: Module {
  private static let service = "Netnyahoo Connected Accounts"

  public func definition() -> ModuleDefinition {
    Name("NetnyahooKeychain")

    /// The secret stored for `account`, or null.
    AsyncFunction("get") { (account: String) -> String? in
      var query = Self.query(account)
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      #if DEBUG
      // Every Debug build is signed differently, so reading an item an earlier build saved
      // would show a keychain prompt (and take focus); treat it as missing instead.
      query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
      #endif
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("set") { (account: String, secret: String) -> Bool in
      let data = Data(secret.utf8)
      let update: [String: Any] = [kSecValueData as String: data]
      var status = SecItemUpdate(Self.query(account) as CFDictionary, update as CFDictionary)
      if status == errSecItemNotFound {
        var add = Self.query(account)
        add[kSecValueData as String] = data
        add[kSecAttrLabel as String] = "Netnyahoo: \(account)"
        status = SecItemAdd(add as CFDictionary, nil)
      } else if status != errSecSuccess {
        // An item this build can't update (saved by an older Debug build): replace it.
        SecItemDelete(Self.query(account) as CFDictionary)
        var add = Self.query(account)
        add[kSecValueData as String] = data
        status = SecItemAdd(add as CFDictionary, nil)
      }
      return status == errSecSuccess
    }

    AsyncFunction("delete") { (account: String) -> Bool in
      let status = SecItemDelete(Self.query(account) as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }
  }

  private static func query(_ account: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }
}
