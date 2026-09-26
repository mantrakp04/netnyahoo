import Foundation

/// Dia's open and pinned tabs, read through Dia's AppleScript dictionary (`sdef /Applications/Dia.app`).
///
/// Dia's own sidebar store (`tabs.db`) is SQLCipher-encrypted with a key only its team's apps can
/// read, but its scripting interface answers any app the user allows (System Settings › Privacy &
/// Security › Automation). It exposes, per window, the profiles that window shows and each
/// profile's tabs ("favorite tabs, pinned tabs, and window tabs, in that order"), with `id`,
/// `title`, `URL`, `isPinned` and `isFocused`. It doesn't expose custom tab names, colours, spaces
/// or folders, so those stay in Dia.
public enum DiaScript {
  /// Classes of the dictionary, as far as the import reads them.
  public struct Tab: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var url: String?
    public var isPinned: Bool
    public var isFocused: Bool

    public init(id: String, title: String, url: String?, isPinned: Bool, isFocused: Bool = false) {
      self.id = id
      self.title = title
      self.url = url
      self.isPinned = isPinned
      self.isFocused = isFocused
    }
  }

  public struct Profile: Codable, Equatable, Sendable {
    public var name: String
    /// Dia's one-based profile index (its user-visible order).
    public var index: Int
    public var tabs: [Tab]

    public init(name: String, index: Int, tabs: [Tab]) {
      self.name = name
      self.index = index
      self.tabs = tabs
    }
  }

  public struct Window: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    /// Front to back.
    public var index: Int
    public var profiles: [Profile]

    public init(id: String, name: String, index: Int, profiles: [Profile]) {
      self.id = id
      self.name = name
      self.index = index
      self.profiles = profiles
    }
  }
}

/// Reads Dia's windows → profiles → tabs. `DiaAppleEvents` asks Dia itself; tests pass fixtures.
public protocol DiaScriptingSource {
  func windows() throws -> [DiaScript.Window]
}

/// A Dia profile's tabs, proposed as a Netnyahoo profile.
public struct DiaTabsProfile: Codable, Equatable, Sendable {
  /// "<index>:<name>": Dia's profiles have no id in its dictionary.
  public var id: String
  public var name: String
  public var index: Int
  /// Favourites and pinned tabs, in Dia's order, deduplicated.
  public var pinned: [ImportedTab]
  /// Open (unpinned) tabs, windows front to back, deduplicated and without any that are pinned.
  public var tabs: [ImportedTab]
}

public struct DiaTabsResult: Codable, Equatable, Sendable {
  /// Profiles with at least one tab to bring, in Dia's profile order.
  public var profiles: [DiaTabsProfile]
  public var windowCount: Int
  /// Internal pages left out (`chrome://`, `dia://`, `about:`, …).
  public var skipped: Int
  /// Tabs dropped because the profile already had the same page (another window, or pinned).
  public var duplicates: Int
}

public enum DiaTabsImport {
  public static func read(from source: DiaScriptingSource) throws -> DiaTabsResult {
    build(try source.windows())
  }

  /// Merges every window's view of each profile. Pinned tabs come first and win over an open
  /// tab of the same page; a page open in several windows comes once. Only http(s) pages are
  /// kept: Dia's own pages (`dia://`, `chrome://`) have nowhere to go in Netnyahoo.
  public static func build(_ windows: [DiaScript.Window]) -> DiaTabsResult {
    struct Accumulator {
      var name: String
      var index: Int
      var pinned: [ImportedTab] = []
      var tabs: [ImportedTab] = []
      var pinnedKeys = Set<String>()
      var tabKeys = Set<String>()
    }
    var order: [String] = []
    var profiles: [String: Accumulator] = [:]
    var skipped = 0
    var duplicates = 0

    for (windowIndex, window) in windows.sorted(by: { $0.index < $1.index }).enumerated() {
      for profile in window.profiles {
        let id = "\(profile.index):\(profile.name)"
        if profiles[id] == nil {
          order.append(id)
          profiles[id] = Accumulator(name: profile.name, index: profile.index)
        }
        var acc = profiles[id]!
        for tab in profile.tabs {
          let url = tab.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
          guard URL.isWebURL(url), let key = dedupeKey(url) else {
            skipped += 1
            continue
          }
          let imported = ImportedTab(url: url, title: tab.title, pinned: tab.isPinned, windowIndex: windowIndex, active: tab.isFocused)
          if tab.isPinned {
            guard acc.pinnedKeys.insert(key).inserted else {
              duplicates += 1
              continue
            }
            acc.pinned.append(imported)
            if acc.tabKeys.remove(key) != nil {
              acc.tabs.removeAll { dedupeKey($0.url) == key }
              duplicates += 1
            }
          } else {
            guard !acc.pinnedKeys.contains(key), acc.tabKeys.insert(key).inserted else {
              duplicates += 1
              continue
            }
            acc.tabs.append(imported)
          }
        }
        profiles[id] = acc
      }
    }

    let out = order.compactMap { id -> DiaTabsProfile? in
      guard let p = profiles[id], !(p.pinned.isEmpty && p.tabs.isEmpty) else { return nil }
      return DiaTabsProfile(id: id, name: p.name.isEmpty ? "Profile \(p.index)" : p.name, index: p.index,
                            pinned: p.pinned, tabs: p.tabs)
    }
    return DiaTabsResult(profiles: out.sorted { $0.index < $1.index }, windowCount: windows.count,
                         skipped: skipped, duplicates: duplicates)
  }

  /// Same page, spelled differently: scheme and host are case-insensitive, an empty path is "/",
  /// and an empty fragment ("#") is dropped. Query and fragment otherwise count.
  static func dedupeKey(_ url: String) -> String? {
    guard var c = URLComponents(string: url), let scheme = c.scheme, let host = c.host, !host.isEmpty else { return nil }
    c.scheme = scheme.lowercased()
    c.host = host.lowercased()
    if c.path.isEmpty { c.path = "/" }
    if c.fragment?.isEmpty == true { c.fragment = nil }
    return c.string
  }
}
