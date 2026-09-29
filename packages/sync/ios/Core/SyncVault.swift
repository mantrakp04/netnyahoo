import Foundation

public final class SyncVault {
  public static let fileExtension = "nns"

  public let folder: URL
  let keys: SyncKeys
  let fileManager = FileManager.default

  public init(folder: URL, keys: SyncKeys) {
    self.folder = folder
    self.keys = keys
  }

  public var chainURL: URL { folder.appendingPathComponent(keys.chainTag, isDirectory: true) }
  func scopeURL(_ scope: String) -> URL { chainURL.appendingPathComponent(keys.scopeTag(scope), isDirectory: true) }

  public func chainExists() -> Bool {
    var isDirectory: ObjCBool = false
    return fileManager.fileExists(atPath: chainURL.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  public func createChain() throws {
    try fileManager.createDirectory(at: chainURL, withIntermediateDirectories: true)
  }

  // MARK: Writing

  @discardableResult
  public func write(scope: String, payload: Data) throws -> String {
    let id = SyncKeys.newFileId()
    let scopeTag = keys.scopeTag(scope)
    let sealed = try keys.seal(payload, scopeTag: scopeTag, fileId: id)
    let directory = scopeURL(scope)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    let destination = directory.appendingPathComponent("\(id).\(Self.fileExtension)")
    // Stage then rename so sync clients never see a partial file.
    let staging = try fileManager.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: directory, create: true)
    defer { try? fileManager.removeItem(at: staging) }
    let temporary = staging.appendingPathComponent(id)
    try sealed.write(to: temporary)
    try coordinate(writing: destination, options: .forReplacing) { url in
      try self.fileManager.moveItem(at: temporary, to: url)
    }
    return id
  }

  public func remove(scope: String, ids: [String]) {
    let directory = scopeURL(scope)
    for id in ids {
      let url = directory.appendingPathComponent("\(id).\(Self.fileExtension)")
      try? coordinate(writing: url, options: .forDeleting) { url in try self.fileManager.removeItem(at: url) }
      try? fileManager.removeItem(at: directory.appendingPathComponent(".\(id).\(Self.fileExtension).icloud"))
    }
  }

  public func deleteChain() throws {
    guard chainExists() else { return }
    try coordinate(writing: chainURL, options: .forDeleting) { url in try self.fileManager.removeItem(at: url) }
  }

  // MARK: Reading

  public struct File {
    public let id: String
    public let payload: Data
  }

  public struct Listing {
    public var files: [File] = []
    public var pending: [String] = []
    public var damaged: [(id: String, age: TimeInterval)] = []
    public var present: [String] = []
  }

  public func read(scope: String, skipping known: Set<String>) -> Listing {
    var listing = Listing()
    let directory = scopeURL(scope)
    let keysToRead: [URLResourceKey] = [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey, .contentModificationDateKey]
    guard let names = try? fileManager.contentsOfDirectory(atPath: directory.path) else { return listing }
    let suffix = ".\(Self.fileExtension)"
    let scopeTag = keys.scopeTag(scope)
    for name in names.sorted() {
      if name.hasPrefix("."), name.hasSuffix("\(suffix).icloud") {
        let id = String(name.dropFirst().dropLast(suffix.count + ".icloud".count))
        guard Base32.isTag(id), !listing.present.contains(id) else { continue }
        listing.present.append(id)
        if !known.contains(id) {
          listing.pending.append(id)
          try? fileManager.startDownloadingUbiquitousItem(at: directory.appendingPathComponent("\(id)\(suffix)"))
        }
        continue
      }
      guard name.hasSuffix(suffix) else { continue }
      let id = String(name.dropLast(suffix.count))
      guard Base32.isTag(id) else { continue }
      if !listing.present.contains(id) { listing.present.append(id) }
      if known.contains(id) { continue }
      let url = directory.appendingPathComponent(name)
      let values = try? url.resourceValues(forKeys: Set(keysToRead))
      if values?.isUbiquitousItem == true, let status = values?.ubiquitousItemDownloadingStatus, status != .current {
        listing.pending.append(id)
        try? fileManager.startDownloadingUbiquitousItem(at: url)
        continue
      }
      do {
        let data = try coordinate(reading: url) { try Data(contentsOf: $0) }
        listing.files.append(File(id: id, payload: try keys.open(data, scopeTag: scopeTag, fileId: id)))
      } catch {
        let modified = values?.contentModificationDate ?? Date()
        listing.damaged.append((id, max(0, Date().timeIntervalSince(modified))))
      }
    }
    return listing
  }

  // MARK: Coordination

  private func coordinate(writing url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: options, error: &coordinationError) { url in
      do { try body(url) } catch { bodyError = error }
    }
    if let error = coordinationError ?? bodyError { throw error }
  }

  private func coordinate<T>(reading url: URL, _ body: (URL) throws -> T) throws -> T {
    var coordinationError: NSError?
    var result: Result<T, Error> = .failure(CocoaError(.fileReadUnknown))
    NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [.withoutChanges], error: &coordinationError) { url in
      result = Result { try body(url) }
    }
    if let coordinationError { throw coordinationError }
    return try result.get()
  }
}

public enum SyncFolder {
  public static var iCloudDrive: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
  }

  public static var iCloudDriveAvailable: Bool {
    var isDirectory: ObjCBool = false
    return FileManager.default.fileExists(atPath: iCloudDrive.path, isDirectory: &isDirectory) && isDirectory.boolValue
  }

  public static func isInICloudDrive(_ url: URL) -> Bool {
    url.standardizedFileURL.path.hasPrefix(iCloudDrive.standardizedFileURL.path)
  }

  public static func hasSyncData(_ folder: URL) -> Bool {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    return names.contains { Base32.isTag($0) }
  }
}
