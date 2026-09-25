import Foundation

/// Arc's `~/Library/Application Support/Arc/StorableSidebar.json`.
///
///     { "sidebar": { "containers": [ {"global": {}},
///         { "spaces": [id, {space}, …], "items": [id, {item}, …], "topAppsContainerIDs": [profile, id, …] } ] } }
///
/// `spaces`, `items` and `topAppsContainerIDs` are flat alternating arrays (Swift
/// dictionaries encoded by Arc); every object repeats its own `id`, so objects are read and
/// the keys beside them ignored.
///
/// - space: `id`, `title`, `profile` (`{"default": true}` or
///   `{"custom": {"_0": {"directoryBasename": "Profile 1"}}}`), `containerIDs`
///   (`["pinned", id, "unpinned", id]`) and/or `newContainerIDs`
///   (`[{"pinned": {}}, id, {"unpinned": {…}}, id]`), `customInfo.iconType`
///   (`emoji_v2` / `emoji` / `icon`), `customInfo.windowTheme` (colours).
/// - item: `id`, `parentID`, `childrenIds`, `title` (the user's rename, often null), `data`:
///   `{"tab": {"savedURL", "savedTitle", "timeLastActiveAt"}}`, `{"list": {}}` (folder),
///   `{"splitView": {…}}`, `{"itemContainer": {…}}` (a root), or others we skip.
/// - `topAppsContainerIDs`: profile descriptor, then the favourites container of that profile.
public struct ArcSidebar: Equatable {
  public var spaces: [SpaceSuggestion] = []
  /// Favourites by Arc profile directory ("Default", "Profile 1").
  public var favorites: [String: [ImportedTab]] = [:]

  public static func parse(_ data: Data) throws -> ArcSidebar {
    guard let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let sidebar = top["sidebar"] as? [String: Any],
          let containers = sidebar["containers"] as? [Any] else {
      throw ImportError.unreadable("StorableSidebar.json is not an Arc sidebar")
    }
    guard let box = containers.compactMap({ $0 as? [String: Any] })
      .first(where: { $0["spaces"] != nil || $0["items"] != nil }) else { return ArcSidebar() }

    var items: [String: [String: Any]] = [:]
    for item in objects(box["items"]) {
      if let id = item["id"] as? String { items[id] = item }
    }

    var out = ArcSidebar()
    var untitled = 0
    for space in objects(box["spaces"]) {
      guard let id = space["id"] as? String else { continue }
      let profile = profileDirectory(space["profile"]) ?? "Default"
      let roots = containerIDs(space)
      var seen = Set<String>()
      let pinned = roots["pinned"].map { tree(of: $0, items: items, seen: &seen) } ?? []
      let today = roots["unpinned"].map { flatTabs(of: $0, items: items, seen: &seen, pinned: false) } ?? []
      let info = space["customInfo"] as? [String: Any]
      let icon = info?["iconType"] as? [String: Any]
      let name: String
      if let title = space["title"] as? String, !title.isEmpty {
        name = title
      } else {
        untitled += 1
        name = "Space \(untitled)"
      }
      let theme = info?["windowTheme"]
      out.spaces.append(SpaceSuggestion(
        id: id,
        name: name,
        color: midTone(theme),
        colors: gradient(theme),
        emoji: emoji(icon),
        icon: icon?["icon"] as? String,
        profileId: profile,
        pinned: pinned,
        tabs: today
      ))
    }

    for (descriptor, container) in pairs(box["topAppsContainerIDs"]) {
      guard let profile = profileDirectory(descriptor), let container = container as? String else { continue }
      var seen = Set<String>()
      let tabs = flatTabs(of: container, items: items, seen: &seen, pinned: true)
      if !tabs.isEmpty { out.favorites[profile, default: []] += tabs }
    }
    return out
  }

  // MARK: - Helpers

  static func objects(_ any: Any?) -> [[String: Any]] {
    (any as? [Any] ?? []).compactMap { $0 as? [String: Any] }
  }

  static func pairs(_ any: Any?) -> [(Any, Any)] {
    let list = any as? [Any] ?? []
    return stride(from: 0, to: list.count - 1, by: 2).map { (list[$0], list[$0 + 1]) }
  }

  static func profileDirectory(_ any: Any?) -> String? {
    guard let d = any as? [String: Any] else { return nil }
    if d["default"] != nil { return "Default" }
    guard let custom = (d["custom"] as? [String: Any])?["_0"] as? [String: Any],
          let dir = custom["directoryBasename"] as? String, !dir.isEmpty else { return nil }
    return dir
  }

  /// "pinned"/"unpinned" → container id, from either spelling Arc has used.
  static func containerIDs(_ space: [String: Any]) -> [String: String] {
    var out: [String: String] = [:]
    for (label, value) in pairs(space["newContainerIDs"]) {
      guard let id = value as? String else { continue }
      if let d = label as? [String: Any], let key = d.keys.first { out[key] = out[key] ?? id }
    }
    for (label, value) in pairs(space["containerIDs"]) {
      if let key = label as? String, let id = value as? String { out[key] = out[key] ?? id }
    }
    return out
  }

  /// Arc's rename, when the user gave the row one.
  static func customTitle(_ item: [String: Any]) -> String? {
    (item["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  }

  static func tab(_ item: [String: Any], pinned: Bool) -> ImportedTab? {
    guard let tab = (item["data"] as? [String: Any])?["tab"] as? [String: Any],
          let url = tab["savedURL"] as? String, !url.isEmpty else { return nil }
    // `timeLastActiveAt` is an NSDate reference time (seconds since 2001-01-01).
    let last = (tab["timeLastActiveAt"] as? NSNumber).map { ($0.doubleValue + 978_307_200) * 1000 }
    return ImportedTab(url: url, title: tab["savedTitle"] as? String ?? "", pinned: pinned,
                       customTitle: customTitle(item), lastActive: last)
  }

  /// Pinned section as a tree: tabs become links titled with the rename (or saved title),
  /// folders keep their structure. A split view's two tabs are kept side by side in order.
  static func tree(of containerID: String, items: [String: [String: Any]], seen: inout Set<String>, depth: Int = 0) -> [BookmarkNode] {
    guard depth < 64, let container = items[containerID], seen.insert(containerID).inserted else { return [] }
    var out: [BookmarkNode] = []
    for id in container["childrenIds"] as? [String] ?? [] {
      guard let item = items[id] else { continue }
      let data = item["data"] as? [String: Any] ?? [:]
      if let t = tab(item, pinned: true) {
        guard seen.insert(id).inserted else { continue }
        var link = BookmarkNode.link(t.customTitle ?? t.title, t.url)
        if t.customTitle != nil { link.pageTitle = t.title }
        out.append(link)
      } else if data["list"] != nil {
        let kids = tree(of: id, items: items, seen: &seen, depth: depth + 1)
        out.append(.folder(customTitle(item) ?? "Folder", kids))
      } else if data["splitView"] != nil {
        out += tree(of: id, items: items, seen: &seen, depth: depth + 1)
      }
    }
    return out
  }

  /// Every tab under a container in drawing order, folders flattened.
  static func flatTabs(of containerID: String, items: [String: [String: Any]], seen: inout Set<String>, pinned: Bool, depth: Int = 0) -> [ImportedTab] {
    guard depth < 64, let container = items[containerID], seen.insert(containerID).inserted else { return [] }
    var out: [ImportedTab] = []
    for id in container["childrenIds"] as? [String] ?? [] {
      guard let item = items[id] else { continue }
      if let t = tab(item, pinned: pinned) {
        if seen.insert(id).inserted { out.append(t) }
      } else {
        out += flatTabs(of: id, items: items, seen: &seen, pinned: pinned, depth: depth + 1)
      }
    }
    return out
  }

  static func emoji(_ icon: [String: Any]?) -> String? {
    if let e = icon?["emoji_v2"] as? String, !e.isEmpty { return e }
    if let e = icon?["emoji"] as? String, !e.isEmpty { return e }
    // Older files store the emoji as a Unicode scalar value.
    if let n = icon?["emoji"] as? Int, let scalar = Unicode.Scalar(n) { return String(Character(scalar)) }
    return nil
  }

  static func color(_ any: Any?) -> String? {
    guard let c = any as? [String: Any], let r = c["red"] as? Double, let g = c["green"] as? Double,
          let b = c["blue"] as? Double else { return nil }
    return Hex.color(red: r, green: g, blue: b)
  }

  /// `windowTheme.primaryColorPalette.midTone`: the one colour Arc tints the space dot with.
  /// Falls back to the first colour found anywhere in the theme.
  static func midTone(_ theme: Any?) -> String? {
    if let palette = (theme as? [String: Any])?["primaryColorPalette"] as? [String: Any], let c = color(palette["midTone"]) {
      return c
    }
    return firstColor(theme, depth: 0)
  }

  private static func firstColor(_ any: Any?, depth: Int) -> String? {
    guard depth < 12 else { return nil }
    if let c = color(any) { return c }
    if let d = any as? [String: Any] {
      for key in d.keys.sorted() { if let c = firstColor(d[key], depth: depth + 1) { return c } }
    } else if let a = any as? [Any] {
      for v in a { if let c = firstColor(v, depth: depth + 1) { return c } }
    }
    return nil
  }

  /// A gradient theme's `baseColors`, wherever the theme style nests them.
  static func gradient(_ theme: Any?) -> [String]? {
    func find(_ any: Any?, _ depth: Int) -> [Any]? {
      guard depth < 12 else { return nil }
      if let d = any as? [String: Any] {
        if let base = d["baseColors"] as? [Any] { return base }
        for key in d.keys.sorted() { if let r = find(d[key], depth + 1) { return r } }
      } else if let a = any as? [Any] {
        for v in a { if let r = find(v, depth + 1) { return r } }
      }
      return nil
    }
    let colors = (find(theme, 0) ?? []).compactMap { entry -> String? in
      color(entry) ?? firstColor(entry, depth: 0)
    }
    return colors.isEmpty ? nil : colors
  }
}
