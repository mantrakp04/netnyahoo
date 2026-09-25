import Foundation

/// The Netscape bookmark file every browser exports (`<!DOCTYPE NETSCAPE-Bookmark-file-1>`),
/// including Safari's `Bookmarks.html`.
///
///     <DL><p>
///       <DT><H3 ADD_DATE="…" PERSONAL_TOOLBAR_FOLDER="true">Folder</H3>
///       <DL><p> … </DL><p>
///       <DT><A HREF="…" ADD_DATE="…">Title</A>
///     </DL><p>
///
/// The format is loose HTML (unclosed `<DT>`/`<p>`, any case, optional quotes), so this is
/// a tolerant tag scanner rather than an HTML parser: an `<H3>` names the next `<DL>`, an
/// `<A>` is a link in the current `<DL>`. `ADD_DATE` is Unix seconds.
public enum NetscapeBookmarks {
  public static func parse(_ html: String) -> BookmarkNode {
    var stack: [BookmarkNode] = [.folder("Bookmarks", [])]
    var pendingFolder: BookmarkNode?
    var scanner = TagScanner(html)
    var sawRootList = false

    while let token = scanner.next() {
      switch token {
      case .open("h3", let attrs):
        let title = decodeEntities(scanner.text(until: "h3")).trimmingCharacters(in: .whitespacesAndNewlines)
        var folder = BookmarkNode.folder(title, [], dateAdded: seconds(attrs["add_date"]))
        if attrs["personal_toolbar_folder"]?.lowercased() == "true" || attrs["id"] == "com.apple.FavoritesBar" {
          folder.role = "toolbar"
        } else if attrs["unfiled_bookmarks_folder"]?.lowercased() == "true" {
          folder.role = "other"
        } else if attrs["id"] == "com.apple.ReadingList" {
          folder.role = "readingList"
        }
        if let pending = pendingFolder { stack[stack.count - 1].children?.append(pending) }
        pendingFolder = folder
      case .open("dl", _):
        if let folder = pendingFolder {
          stack.append(folder)
          pendingFolder = nil
        } else if !sawRootList {
          sawRootList = true
        } else {
          // A <DL> with no heading: keep its links in an untitled folder rather than lose them.
          stack.append(.folder("", []))
        }
      case .close("dl"):
        if let pending = pendingFolder {
          stack[stack.count - 1].children?.append(pending)
          pendingFolder = nil
        }
        if stack.count > 1 {
          let done = stack.removeLast()
          stack[stack.count - 1].children?.append(done)
        }
      case .open("a", let attrs):
        let title = decodeEntities(scanner.text(until: "a")).trimmingCharacters(in: .whitespacesAndNewlines)
        guard let href = attrs["href"].map(decodeEntities), !href.isEmpty else { continue }
        if let pending = pendingFolder {
          // A heading that never got a list is an empty folder.
          stack[stack.count - 1].children?.append(pending)
          pendingFolder = nil
        }
        stack[stack.count - 1].children?.append(.link(title.isEmpty ? href : title, href, dateAdded: seconds(attrs["add_date"])))
      default:
        break
      }
    }
    if let pending = pendingFolder { stack[stack.count - 1].children?.append(pending) }
    while stack.count > 1 {
      let done = stack.removeLast()
      stack[stack.count - 1].children?.append(done)
    }
    return stack[0]
  }

  public static func load(_ url: URL) throws -> BookmarkNode {
    let data = try Data(contentsOf: url)
    guard let html = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
      throw ImportError.unreadable("Couldn't read \(url.lastPathComponent)")
    }
    let root = parse(html)
    guard root.linkCount > 0 || !(root.children ?? []).isEmpty else {
      throw ImportError.unreadable("\(url.lastPathComponent) has no bookmarks")
    }
    return root
  }

  static func seconds(_ s: String?) -> Double? {
    s.flatMap(Double.init).flatMap { $0 > 0 ? $0 * 1000 : nil }
  }

  static func decodeEntities(_ s: String) -> String {
    guard s.contains("&") else { return s }
    var out = ""
    var i = s.startIndex
    while i < s.endIndex {
      if s[i] == "&", let semi = s[i...].prefix(12).firstIndex(of: ";") {
        let name = s[s.index(after: i)..<semi]
        var replacement: String?
        switch name {
        case "amp": replacement = "&"
        case "lt": replacement = "<"
        case "gt": replacement = ">"
        case "quot": replacement = "\""
        case "apos": replacement = "'"
        case "nbsp": replacement = "\u{00A0}"
        default:
          if name.hasPrefix("#x") || name.hasPrefix("#X"), let v = UInt32(name.dropFirst(2), radix: 16), let u = Unicode.Scalar(v) {
            replacement = String(u)
          } else if name.hasPrefix("#"), let v = UInt32(name.dropFirst()), let u = Unicode.Scalar(v) {
            replacement = String(u)
          }
        }
        if let replacement {
          out += replacement
          i = s.index(after: semi)
          continue
        }
      }
      out.append(s[i])
      i = s.index(after: i)
    }
    return out
  }
}

/// Yields opening/closing tags (lower-cased names, lower-cased attribute keys).
struct TagScanner {
  enum Token: Equatable {
    case open(String, [String: String])
    case close(String)
  }

  private let s: [Character]
  private var i = 0

  init(_ html: String) { s = Array(html) }

  mutating func next() -> Token? {
    while i < s.count {
      guard s[i] == "<" else { i += 1; continue }
      if i + 3 < s.count, s[i + 1] == "!", s[i + 2] == "-", s[i + 3] == "-" {
        // Comment: skip to -->
        i += 4
        while i + 2 < s.count, !(s[i] == "-" && s[i + 1] == "-" && s[i + 2] == ">") { i += 1 }
        i += 3
        continue
      }
      i += 1
      let closing = i < s.count && s[i] == "/"
      if closing { i += 1 }
      var name = ""
      while i < s.count, s[i].isLetter || s[i].isNumber { name.append(s[i]); i += 1 }
      if name.isEmpty { continue }
      var attrs: [String: String] = [:]
      while i < s.count, s[i] != ">" {
        if s[i].isWhitespace || s[i] == "/" { i += 1; continue }
        var key = ""
        while i < s.count, !s[i].isWhitespace, s[i] != "=", s[i] != ">" { key.append(s[i]); i += 1 }
        var value = ""
        if i < s.count, s[i] == "=" {
          i += 1
          if i < s.count, s[i] == "\"" || s[i] == "'" {
            let quote = s[i]
            i += 1
            while i < s.count, s[i] != quote { value.append(s[i]); i += 1 }
            i += 1
          } else {
            while i < s.count, !s[i].isWhitespace, s[i] != ">" { value.append(s[i]); i += 1 }
          }
        }
        if !key.isEmpty { attrs[key.lowercased()] = value }
      }
      i += 1
      return closing ? .close(name.lowercased()) : .open(name.lowercased(), attrs)
    }
    return nil
  }

  /// Raw text up to `</name>` (tags inside are dropped), consuming the closing tag.
  mutating func text(until name: String) -> String {
    var out = ""
    while i < s.count {
      if s[i] == "<" {
        let start = i
        if let token = next() {
          if token == .close(name) { return out }
          if case .open(let n, _) = token, ["dt", "dl", "h3", "a"].contains(n) {
            // Unterminated element: give the tag back to the caller.
            i = start
            return out
          }
        }
        continue
      }
      out.append(s[i])
      i += 1
    }
    return out
  }
}
