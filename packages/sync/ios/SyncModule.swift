import AppKit
import ExpoModulesCore
import NetnyahooImport
import Security

public class SyncModule: Module {
  private let state = KeyState()
  private static let work = DispatchQueue(label: "netnyahoo.sync", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("NetnyahooSync")

    AsyncFunction("folderInfo") { (path: String?) -> [String: Any] in
      let url = path.map { URL(fileURLWithPath: $0, isDirectory: true) } ?? Self.defaultFolder
      var isDirectory: ObjCBool = false
      let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
      return [
        "path": url.path,
        "defaultPath": Self.defaultFolder.path,
        "iCloudAvailable": Self.testFolder != nil || SyncFolder.iCloudDriveAvailable,
        "inICloud": SyncFolder.isInICloudDrive(url),
        "exists": exists,
        "writable": exists && FileManager.default.isWritableFile(atPath: url.path),
        "hasSyncData": exists && SyncFolder.hasSyncData(url),
      ]
    }.runOnQueue(Self.work)

    AsyncFunction("chooseFolder") { (current: String?, promise: Promise) in
      let panel = NSOpenPanel()
      panel.canChooseFiles = false
      panel.canChooseDirectories = true
      panel.canCreateDirectories = true
      panel.allowsMultipleSelection = false
      panel.prompt = "Use Folder"
      panel.message = "Choose a folder that syncs between your Macs, like one in iCloud Drive or Dropbox, or on a NAS or USB drive."
      if let current { panel.directoryURL = URL(fileURLWithPath: current, isDirectory: true) }
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)

    Function("newDeviceId") { SyncKeys.newFileId() }

    Function("deviceName") { Host.current().localizedName ?? "This Mac" }

    AsyncFunction("createPhrase") { (account: String) -> Bool in
      let entropy = RecoveryPhrase.generateEntropy()
      guard Self.keyStore.save(entropy, account: account) else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    AsyncFunction("enterPhrase") { (account: String, text: String, folder: String) -> [String: Any] in
      let entropy: Data
      do {
        entropy = try RecoveryPhrase.entropy(from: text)
      } catch let problem as RecoveryPhrase.Problem {
        switch problem {
        case .wordCount(let n): return ["error": "wordCount", "count": n]
        case .unknownWord(let word): return ["error": "unknownWord", "word": word]
        case .checksum: return ["error": "checksum"]
        }
      }
      let folderURL = URL(fileURLWithPath: folder, isDirectory: true)
      if !SyncVault(folder: folderURL, keys: SyncKeys(entropy: entropy)).chainExists() {
        return ["error": SyncFolder.hasSyncData(folderURL) ? "mismatch" : "noData"]
      }
      guard Self.keyStore.save(entropy, account: account) else { return ["error": "keychain"] }
      self.state.set(entropy)
      return ["ok": true]
    }.runOnQueue(Self.work)

    AsyncFunction("unlock") { (account: String) -> Bool in
      guard let entropy = Self.keyStore.load(account: account), entropy.count == 32 else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    AsyncFunction("forget") { (account: String) in
      Self.keyStore.delete(account: account)
      self.state.set(nil)
    }.runOnQueue(Self.work)

    AsyncFunction("chainStatus") { (folder: String) throws -> String in
      let vault = try self.vault(folder)
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: folder, isDirectory: &isDirectory), isDirectory.boolValue else { return "unavailable" }
      return vault.chainExists() ? "ok" : "missing"
    }.runOnQueue(Self.work)

    AsyncFunction("createChain") { (folder: String) throws in
      try FileManager.default.createDirectory(at: URL(fileURLWithPath: folder, isDirectory: true), withIntermediateDirectories: true)
      try self.vault(folder).createChain()
    }.runOnQueue(Self.work)

    AsyncFunction("write") { (folder: String, scope: String, payload: String) throws -> String in
      try self.vault(folder).write(scope: scope, payload: Data(payload.utf8))
    }.runOnQueue(Self.work)

    AsyncFunction("read") { (folder: String, scope: String, known: [String]) throws -> [String: Any] in
      let listing = try self.vault(folder).read(scope: scope, skipping: Set(known))
      return [
        "files": listing.files.map { ["id": $0.id, "payload": String(decoding: $0.payload, as: UTF8.self)] },
        "pending": listing.pending,
        "damaged": listing.damaged.map { ["id": $0.id, "age": $0.age * 1000] },
        "present": listing.present,
      ]
    }.runOnQueue(Self.work)

    AsyncFunction("remove") { (folder: String, scope: String, ids: [String]) throws in
      try self.vault(folder).remove(scope: scope, ids: ids)
    }.runOnQueue(Self.work)

    AsyncFunction("deleteChain") { (folder: String) throws in
      try self.vault(folder).deleteChain()
    }.runOnQueue(Self.work)

    AsyncFunction("sealLocal") { (text: String) throws -> String in
      guard let keys = self.state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
      return try keys.seal(Data(text.utf8), scopeTag: "local", fileId: "state").base64EncodedString()
    }.runOnQueue(Self.work)

    AsyncFunction("openLocal") { (sealed: String) -> String? in
      guard let keys = self.state.keys, let data = Data(base64Encoded: sealed),
            let plain = try? keys.open(data, scopeTag: "local", fileId: "state") else { return nil }
      return String(decoding: plain, as: UTF8.self)
    }.runOnQueue(Self.work)

    // MARK: Recovery Kit

    AsyncFunction("recoveryWords") { () throws -> [String] in try self.words() }.runOnQueue(Self.work)

    AsyncFunction("qrCode") { () throws -> String? in
      guard let image = RecoveryKit.qrCode(words: try self.words()), let png = RecoveryKit.png(image) else { return nil }
      return "data:image/png;base64," + png.base64EncodedString()
    }.runOnQueue(Self.work)

    AsyncFunction("recoveryKitPreview") { (width: Double) throws -> String? in
      try self.preview(width: CGFloat(width))
    }.runOnQueue(.main)

    AsyncFunction("saveRecoveryKit") { (format: String, promise: Promise) in
      do {
        let words = try self.words()
        let panel = NSSavePanel()
        let text = format == "text"
        panel.nameFieldStringValue = text ? RecoveryKit.textName : RecoveryKit.pdfName
        panel.allowedContentTypes = [text ? .plainText : .pdf]
        panel.canCreateDirectories = true
        panel.begin { response in
          guard response == .OK, let url = panel.url else { return promise.resolve(nil) }
          do {
            try Self.kit(words, text: text).write(to: url, options: [.atomic])
            promise.resolve(url.path)
          } catch {
            promise.reject("save", error.localizedDescription)
          }
        }
      } catch {
        promise.reject("locked", "Sync isn't set up on this Mac.")
      }
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryKit") { () throws in
      let url = try self.temporaryKit()
      NSPasteboard.general.clearContents()
      NSPasteboard.general.writeObjects([url as NSURL])
    }.runOnQueue(.main)

    AsyncFunction("shareRecoveryKit") { () throws in
      let url = try self.temporaryKit()
      guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible), let view = window.contentView else { return }
      let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
      NSSharingServicePicker(items: [url]).show(relativeTo: NSRect(origin: point, size: .zero), of: view, preferredEdge: .minY)
    }.runOnQueue(.main)

    AsyncFunction("copyRecoveryPhrase") { () throws in
      let words = try self.words().joined(separator: " ")
      let pasteboard = NSPasteboard.general
      pasteboard.clearContents()
      pasteboard.declareTypes([.string, NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")], owner: nil)
      pasteboard.setString(words, forType: .string)
      pasteboard.setString("", forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
    }.runOnQueue(.main)

    AsyncFunction("revealFolder") { (path: String) in
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path, isDirectory: true)])
    }.runOnQueue(.main)

    // MARK: Passwords

    AsyncFunction("readPasswords") { (engineProfile: String) -> [[String: Any]]? in
      do {
        let key = ChromiumCrypto.deriveKey(secret: try Self.safeStorageSecret())
        let result = try ChromiumSecrets.logins(profile: Self.profileDirectory(engineProfile), key: key)
        if result.undecryptable > 0 {
          NSLog("[sync] \(result.undecryptable) saved passwords didn't decrypt; not syncing passwords now")
          return nil
        }
        return result.items.map { c in
          ["origin": c.realm ?? c.url, "url": c.url, "username": c.username, "password": c.password, "created": c.created ?? 0]
        }
      } catch ImportError.notFound(_) {
        return []
      } catch {
        NSLog("[sync] reading passwords: \(error)")
        return nil
      }
    }.runOnQueue(Self.work)
  }

  // MARK: Helpers

  private func vault(_ folder: String) throws -> SyncVault {
    guard let keys = state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return SyncVault(folder: URL(fileURLWithPath: folder, isDirectory: true), keys: keys)
  }

  private func words() throws -> [String] {
    guard let entropy = state.entropy else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
    return RecoveryPhrase.words(for: entropy)
  }

  private static func kit(_ words: [String], text: Bool) -> Data {
    let device = Host.current().localizedName ?? "this Mac"
    return text ? Data(RecoveryKit.text(words: words, created: Date(), device: device).utf8)
      : RecoveryKit.pdf(words: words, created: Date(), device: device)
  }

  private func temporaryKit() throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("Netnyahoo Recovery Kit", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let url = dir.appendingPathComponent(RecoveryKit.pdfName)
    try Self.kit(try words(), text: false).write(to: url, options: [.atomic])
    return url
  }

  private func preview(width: CGFloat) throws -> String? {
    let pdf = Self.kit(try words(), text: false)
    guard let page = NSImage(data: pdf) else { return nil }
    let scale = (NSScreen.main?.backingScaleFactor ?? 2)
    let size = NSSize(width: width, height: width * page.size.height / page.size.width)
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale),
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor.white.setFill()
    NSRect(origin: .zero, size: size).fill()
    page.draw(in: NSRect(origin: .zero, size: size))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
  }

  // MARK: Environment

  private static let environment = ProcessInfo.processInfo.environment
  private static let dataDirectory = environment["NETNYAHOO_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
  private static let testFolder = environment["NETNYAHOO_SYNC_DEFAULT_FOLDER"].map { URL(fileURLWithPath: $0, isDirectory: true) }

  static var defaultFolder: URL {
    if let testFolder { return testFolder }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Netnyahoo Sync", isDirectory: true) }
    return SyncFolder.iCloudDrive.appendingPathComponent("Netnyahoo Sync", isDirectory: true)
  }

  static let keyStore: SyncKeyStore = dataDirectory.map { FileKeyStore(directory: $0) } ?? KeychainKeyStore()

  static func profileDirectory(_ engineProfile: String) -> URL {
    let root = dataDirectory?.appendingPathComponent("Chromium", isDirectory: true)
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.netnyahoo.browser", isDirectory: true)
      .appendingPathComponent("Chromium", isDirectory: true)
    return root.appendingPathComponent(engineProfile.isEmpty ? "Default" : "Profile \(engineProfile)", isDirectory: true)
  }

  static func safeStorageSecret() throws -> Data {
    if dataDirectory != nil || !isTeamSigned { return Data("mock_password".utf8) }
    return try SafeStorageKeychain.secret(service: "Netnyahoo Safe Storage", account: "Netnyahoo")
  }

  static let isTeamSigned: Bool = {
    var code: SecCode?
    guard SecCodeCopySelf([], &code) == errSecSuccess, let code else { return false }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return false }
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let dict = info as? [String: Any] else { return false }
    return dict[kSecCodeInfoTeamIdentifier as String] != nil
  }()
}

private final class KeyState {
  private let lock = NSLock()
  private var _entropy: Data?
  private var _keys: SyncKeys?

  func set(_ entropy: Data?) {
    lock.lock()
    defer { lock.unlock() }
    _entropy = entropy
    _keys = entropy.map(SyncKeys.init(entropy:))
  }

  var entropy: Data? {
    lock.lock()
    defer { lock.unlock() }
    return _entropy
  }

  var keys: SyncKeys? {
    lock.lock()
    defer { lock.unlock() }
    return _keys
  }
}
