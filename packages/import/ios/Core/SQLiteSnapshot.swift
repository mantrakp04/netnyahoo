import Foundation
import SQLite3

final class SQLiteSnapshot {
  private var db: OpaquePointer?
  private let tempDir: URL

  init(copying source: URL) throws {
    // Copy the database with its WAL before opening; never read the live profile directly.
    let fm = FileManager.default
    guard fm.fileExists(atPath: source.path) else {
      throw ImportError.notFound("\(source.lastPathComponent) not found")
    }
    tempDir = fm.temporaryDirectory.appendingPathComponent("arcadia-import-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: tempDir, withIntermediateDirectories: true)
    let copy = tempDir.appendingPathComponent("db.sqlite")
    do {
      try fm.copyItem(at: source, to: copy)
      for suffix in ["-wal", "-journal"] {
        let sibling = URL(fileURLWithPath: source.path + suffix)
        if fm.fileExists(atPath: sibling.path) {
          try? fm.copyItem(at: sibling, to: URL(fileURLWithPath: copy.path + suffix))
        }
      }
    } catch {
      try? fm.removeItem(at: tempDir)
      throw ImportError.unreadable("Couldn't copy \(source.lastPathComponent): \(error.localizedDescription)")
    }

    if sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READWRITE, nil) != SQLITE_OK {
      sqlite3_close(db)
      db = nil
      let uri = "file:\(copy.path)?immutable=1"
      if sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) != SQLITE_OK {
        let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
        sqlite3_close(db)
        db = nil
        try? fm.removeItem(at: tempDir)
        throw ImportError.unreadable("Couldn't open \(source.lastPathComponent): \(message)")
      }
    }
    sqlite3_busy_timeout(db, 2000)
  }

  deinit {
    sqlite3_close(db)
    try? FileManager.default.removeItem(at: tempDir)
  }

  func tableExists(_ name: String) -> Bool {
    (try? scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", [.text(name)])) ?? 0 > 0
  }

  func scalar(_ sql: String, _ bindings: [Value] = []) throws -> Int64? {
    var result: Int64?
    try query(sql, bindings) { row in
      result = row.int(0)
      return false
    }
    return result
  }

  enum Value {
    case int(Int64)
    case text(String)
  }

  func query(_ sql: String, _ bindings: [Value] = [], _ body: (Row) throws -> Bool) throws {
    var stmt: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
      throw ImportError.unreadable(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(stmt) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (i, value) in bindings.enumerated() {
      switch value {
      case .int(let v): sqlite3_bind_int64(stmt, Int32(i + 1), v)
      case .text(let v): sqlite3_bind_text(stmt, Int32(i + 1), v, -1, transient)
      }
    }
    let row = Row(stmt: stmt!)
    while true {
      let rc = sqlite3_step(stmt)
      if rc == SQLITE_DONE { return }
      guard rc == SQLITE_ROW else { throw ImportError.unreadable(String(cString: sqlite3_errmsg(db))) }
      if try !body(row) { return }
    }
  }

  struct Row {
    let stmt: OpaquePointer
    private let columns: [String: Int32]

    init(stmt: OpaquePointer) {
      self.stmt = stmt
      var columns: [String: Int32] = [:]
      for i in 0..<sqlite3_column_count(stmt) {
        let name = String(cString: sqlite3_column_name(stmt, i))
        if columns[name] == nil { columns[name] = i }
      }
      self.columns = columns
    }

    func index(_ name: String) -> Int32? { columns[name] }

    func isNull(_ i: Int32) -> Bool { sqlite3_column_type(stmt, i) == SQLITE_NULL }

    func int(_ i: Int32) -> Int64 { sqlite3_column_int64(stmt, i) }
    func int(_ name: String) -> Int64? { index(name).flatMap { isNull($0) ? nil : int($0) } }

    func text(_ i: Int32) -> String? {
      guard let p = sqlite3_column_text(stmt, i) else { return nil }
      return String(cString: p)
    }
    func text(_ name: String) -> String? { index(name).flatMap { text($0) } }

    func blob(_ i: Int32) -> Data? {
      let count = Int(sqlite3_column_bytes(stmt, i))
      guard let p = sqlite3_column_blob(stmt, i) else { return count == 0 && !isNull(i) ? Data() : nil }
      return Data(bytes: p, count: count)
    }
    func blob(_ name: String) -> Data? { index(name).flatMap { blob($0) } }

    /// The column's raw bytes, valid only until the next step. Use to move plaintext secrets into SecretBytes
    /// without a Data/String copy.
    func blobPointer(_ i: Int32) -> UnsafeRawBufferPointer? {
      guard !isNull(i) else { return nil }
      let p = sqlite3_column_blob(stmt, i)
      let count = Int(sqlite3_column_bytes(stmt, i))
      return UnsafeRawBufferPointer(start: count > 0 ? p : nil, count: count)
    }

    func secret(_ name: String) -> SecretBytes? {
      index(name).flatMap { blobPointer($0) }.map { SecretBytes(copying: $0) }
    }

    func has(_ name: String) -> Bool { index(name) != nil }
  }
}
