import Foundation

public enum ChromiumBookmarks {
  static let roots: [(key: String, role: String, title: String)] = [
    ("bookmark_bar", "toolbar", "Bookmarks Bar"),
    ("other", "other", "Other Bookmarks"),
    ("synced", "mobile", "Mobile Bookmarks"),
  ]

  public static func parse(_ data: Data) throws -> BookmarkNode {
    guard let top = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let rootsJSON = top["roots"] as? [String: Any] else {
      throw ImportError.unreadable("Bookmarks file is not Chromium bookmarks JSON")
    }
    var children: [BookmarkNode] = []
    for root in roots {
      guard let json = rootsJSON[root.key] as? [String: Any], var node = node(json) else { continue }
      guard !(node.children ?? []).isEmpty else { continue }
      node.role = root.role
      node.title = (json["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? root.title
      children.append(node)
    }
    return .folder("Bookmarks", children)
  }

  public static func load(profile: URL) throws -> BookmarkNode {
    let local = profile.appendingPathComponent("Bookmarks")
    let account = profile.appendingPathComponent("AccountBookmarks")
    let fm = FileManager.default
    guard fm.fileExists(atPath: local.path) || fm.fileExists(atPath: account.path) else {
      throw ImportError.notFound("No bookmarks in this profile")
    }
    var result = fm.fileExists(atPath: local.path) ? try parse(Data(contentsOf: local)) : .folder("Bookmarks", [])
    if fm.fileExists(atPath: account.path), let extra = try? parse(Data(contentsOf: account)) {
      for folder in extra.children ?? [] {
        if let i = result.children?.firstIndex(where: { $0.role == folder.role }) {
          result.children?[i].children?.append(contentsOf: folder.children ?? [])
        } else {
          result.children?.append(folder)
        }
      }
    }
    return result
  }

  static func node(_ json: [String: Any]) -> BookmarkNode? {
    let title = json["name"] as? String ?? ""
    let added = Time.fromWebKit(json["date_added"] as? String)
    switch json["type"] as? String {
    case "url":
      guard let url = json["url"] as? String, !url.isEmpty else { return nil }
      return .link(title, url, dateAdded: added)
    case "folder":
      let kids = (json["children"] as? [[String: Any]] ?? []).compactMap(node)
      return .folder(title, kids, dateAdded: added)
    default:
      return nil
    }
  }
}
