import Foundation

/// Chromium `History` and Firefox `places.sqlite` history, newest first, delivered in chunks.
///
/// Chromium: `urls(url, title, visit_count, typed_count, last_visit_time µs-since-1601, hidden)`.
/// Firefox:  `moz_places(url, title, visit_count, last_visit_date µs-since-1970, hidden)`.
/// Only http(s) rows are kept: `chrome://`, `about:` and `file:` pages aren't history a new
/// browser can do anything with.
public enum HistoryReader {
  public enum Flavor { case chromium, firefox }

  private static let webOnly = "(url LIKE 'http://%' OR url LIKE 'https://%')"

  public static func read(_ db: URL, flavor: Flavor, options: ImportOptions = .init(),
                          observer: ImportObserver = .silent, cancellation: Cancellation = .init()) throws -> (entries: [HistoryEntry], count: Int) {
    let snapshot = try SQLiteSnapshot(copying: db)
    let sql: String
    var bindings: [SQLiteSnapshot.Value] = []
    switch flavor {
    case .chromium:
      guard snapshot.tableExists("urls") else { throw ImportError.unreadable("History has no urls table") }
      var whereClause = "hidden = 0 AND last_visit_time > 0 AND \(webOnly)"
      if let since = options.historySince {
        whereClause += " AND last_visit_time >= ?"
        bindings.append(.int(Int64(since * 1000) + 11_644_473_600_000_000))
      }
      sql = "SELECT url, title, visit_count, last_visit_time, typed_count FROM urls WHERE \(whereClause) ORDER BY last_visit_time DESC"
    case .firefox:
      guard snapshot.tableExists("moz_places") else { throw ImportError.unreadable("places.sqlite has no moz_places table") }
      var whereClause = "hidden = 0 AND visit_count > 0 AND last_visit_date IS NOT NULL AND \(webOnly)"
      if let since = options.historySince {
        whereClause += " AND last_visit_date >= ?"
        bindings.append(.int(Int64(since * 1000)))
      }
      sql = "SELECT url, title, visit_count, last_visit_date, typed FROM moz_places WHERE \(whereClause) ORDER BY last_visit_date DESC"
    }

    let total = try snapshot.scalar("SELECT count(*) FROM (\(sql))", bindings).map(Int.init)
    let limit = options.historyLimit
    let expected = limit.map { min($0, total ?? $0) } ?? total
    observer.progress(ImportProgress(kind: .history, phase: .start, processed: 0, total: expected))

    var all: [HistoryEntry] = []
    var chunk: [HistoryEntry] = []
    var count = 0
    let stream = options.streamHistory && observer.history != nil

    try snapshot.query(sql, bindings) { row in
      if count % 256 == 0 { try cancellation.check() }
      guard let url = row.text(0), URL.isWebURL(url) else { return true }
      let time = row.int(3)
      let entry = HistoryEntry(
        url: url,
        title: row.text(1) ?? "",
        visits: max(1, Int(row.int(2))),
        lastVisit: (flavor == .chromium ? Time.fromWebKit(time) : Time.fromUnixMicros(time)) ?? 0,
        typedCount: row.isNull(4) ? nil : Int(row.int(4))
      )
      count += 1
      if stream {
        chunk.append(entry)
        if chunk.count >= observer.chunkSize {
          observer.history?(chunk)
          chunk.removeAll(keepingCapacity: true)
          observer.progress(ImportProgress(kind: .history, phase: .progress, processed: count, total: expected))
        }
      } else {
        all.append(entry)
        if count % observer.chunkSize == 0 {
          observer.progress(ImportProgress(kind: .history, phase: .progress, processed: count, total: expected))
        }
      }
      return limit.map { count < $0 } ?? true
    }
    if stream, !chunk.isEmpty { observer.history?(chunk) }
    observer.progress(ImportProgress(kind: .history, phase: .end, processed: count, total: count))
    return (all, count)
  }
}
