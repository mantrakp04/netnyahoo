import Foundation

public struct ImportedExtension: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var webStoreUrl: String
}

// The Chrome Web Store extensions a Chromium-family profile has installed (its Preferences' extensions.settings),
// so the app can offer them on the Web Store. Nothing is installed from the source's files.
public enum ChromiumExtensions {
  public static func list(profile: URL) -> [ImportedExtension] {
    var settings: [String: Any] = [:]
    for file in ["Preferences", "Secure Preferences"] {
      guard let data = try? Data(contentsOf: profile.appendingPathComponent(file)),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let found = (root["extensions"] as? [String: Any])?["settings"] as? [String: Any] else { continue }
      settings.merge(found) { old, new in
        guard var a = old as? [String: Any], let b = new as? [String: Any] else { return new }
        a.merge(b) { $1 }
        return a
      }
    }
    var out: [ImportedExtension] = []
    for (id, value) in settings {
      guard isExtensionId(id), let entry = value as? [String: Any], entry["from_webstore"] as? Bool == true else { continue }
      // Component and external (policy, preinstalled) extensions aren't the user's choice.
      if let location = entry["location"] as? Int, location != 1 { continue }
      out.append(ImportedExtension(id: id, name: name(id: id, entry: entry, profile: profile) ?? id,
                                   webStoreUrl: "https://chromewebstore.google.com/detail/\(id)"))
    }
    return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }

  static func isExtensionId(_ id: String) -> Bool {
    id.count == 32 && id.allSatisfy { ("a"..."p").contains($0) }
  }

  static func name(id: String, entry: [String: Any], profile: URL) -> String? {
    var manifest = entry["manifest"] as? [String: Any]
    var dir: URL?
    if let path = entry["path"] as? String, !path.hasPrefix("/"), !path.contains("..") {
      let folder = profile.appendingPathComponent("Extensions").appendingPathComponent(path, isDirectory: true)
      dir = folder
      if manifest == nil, let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")) {
        manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      }
    }
    guard let raw = (manifest?["name"] as? String)?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
    guard raw.hasPrefix("__MSG_"), raw.hasSuffix("__") else { return raw }
    // A localized name: the default locale's messages.json.
    let key = String(raw.dropFirst(6).dropLast(2)).lowercased()
    guard let dir, let locale = manifest?["default_locale"] as? String,
          let data = try? Data(contentsOf: dir.appendingPathComponent("_locales/\(locale)/messages.json")),
          let messages = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    let match = messages.first { $0.key.lowercased() == key }?.value as? [String: Any]
    return (match?["message"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  }
}
