import AppKit
import ExpoModulesCore
import NetnyahooImport
import Security

/// Expo glue over the sync core (ios/Core): the phrase and its key, sealed files in the sync
/// folder, the Recovery Kit, and reading this app's own saved passwords. The key never crosses
/// to JS; the words do only for the Recovery Kit sheets. File contents cross as JSON strings.
public class SyncModule: Module {
  private let state = KeyState()
  private static let work = DispatchQueue(label: "netnyahoo.sync", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("NetnyahooSync")

    /// The folder sync uses unless the user picks another, and what's there.
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

    /// A new phrase for this device (sync turned on without another device). Saved to the
    /// Keychain under `account` and held for this launch.
    AsyncFunction("createPhrase") { (account: String) -> Bool in
      let entropy = RecoveryPhrase.generateEntropy()
      guard Self.keyStore.save(entropy, account: account) else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    /// Checks a typed phrase, then that the folder holds its data; keeps it if both hold.
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

    /// Loads this device's key at launch. False if it's gone (another build's Keychain item).
    AsyncFunction("unlock") { (account: String) -> Bool in
      guard let entropy = Self.keyStore.load(account: account), entropy.count == 32 else { return false }
      self.state.set(entropy)
      return true
    }.runOnQueue(Self.work)

    AsyncFunction("forget") { (account: String) in
      Self.keyStore.delete(account: account)
      self.state.set(nil)
    }.runOnQueue(Self.work)

    /// "ok", "missing" (the folder is there but this phrase's data isn't: deleted from another
    /// device) or "unavailable" (the folder isn't there: an unplugged drive, iCloud Drive off).
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

    /// Deletes this phrase's data from the folder (Delete My Sync Data).
    AsyncFunction("deleteChain") { (folder: String) throws in
      try self.vault(folder).deleteChain()
    }.runOnQueue(Self.work)

    /// This Mac's sync state (the replica holds saved passwords), sealed with the sync key for
    /// writing to the app's data folder. Base64.
    AsyncFunction("sealLocal") { (text: String) throws -> String in
      guard let keys = self.state.keys else { throw Exception(name: "locked", description: "Sync isn't set up on this Mac.") }
      return try keys.seal(Data(text.utf8), scopeTag: "local", fileId: "state").base64EncodedString()
    }.runOnQueue(Self.work)

    /// The state `sealLocal` wrote, or null if it doesn't open (another key).
    AsyncFunction("openLocal") { (sealed: String) -> String? in
      guard let keys = self.state.keys, let data = Data(base64Encoded: sealed),
            let plain = try? keys.open(data, scopeTag: "local", fileId: "state") else { return nil }
      return String(decoding: plain, as: UTF8.self)
    }.runOnQueue(Self.work)

    // MARK: Recovery Kit

    AsyncFunction("recoveryWords") { () throws -> [String] in try self.words() }.runOnQueue(Self.work)

    /// The phrase as a QR code (PNG data URL), for the Connect Another Device sheet.
    AsyncFunction("qrCode") { () throws -> String? in
      guard let image = RecoveryKit.qrCode(words: try self.words()), let png = RecoveryKit.png(image) else { return nil }
      return "data:image/png;base64," + png.base64EncodedString()
    }.runOnQueue(Self.work)

    /// The kit's page as a PNG data URL, for the Save Your Recovery Kit sheet.
    AsyncFunction("recoveryKitPreview") { (width: Double) throws -> String? in
      try self.preview(width: CGFloat(width))
    }.runOnQueue(.main)

    /// Save…: the PDF (or, `format` "text", a text sheet) where the user picks.
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

    /// Other Options › Copy: the PDF on the pasteboard, as a file.
    AsyncFunction("copyRecoveryKit") { () throws in
      let url = try self.temporaryKit()
      NSPasteboard.general.clearContents()
      NSPasteboard.general.writeObjects([url as NSURL])
    }.runOnQueue(.main)

    /// Other Options › Share…: the share menu at the mouse, in the key window.
    AsyncFunction("shareRecoveryKit") { () throws in
      let url = try self.temporaryKit()
      guard let window = NSApp.keyWindow ?? NSApp.windows.first(where: \.isVisible), let view = window.contentView else { return }
      let point = view.convert(window.mouseLocationOutsideOfEventStream, from: nil)
      NSSharingServicePicker(items: [url]).show(relativeTo: NSRect(origin: point, size: .zero), of: view, preferredEdge: .minY)
    }.runOnQueue(.main)

    /// Copy Recovery Code (⌥ in the Advanced menu): the words, marked concealed so clipboard
    /// managers skip them, as Dia does.
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

    /// A profile's saved logins, read from Chrome's own store in its profile folder (the
    /// importer's reader), so sync can see them without asking for Touch ID every cycle.
    /// null if they can't be read now.
    AsyncFunction("readPasswords") { (engineProfile: String) -> [[String: Any]]? in
      do {
        let key = ChromiumCrypto.deriveKey(secret: try Self.safeStorageSecret())
        let result = try ChromiumSecrets.logins(profile: Self.profileDirectory(engineProfile), key: key)
        // A partial list would read as deletions: skip this round instead.
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

  /// The PDF in a private temporary folder, for Copy and Share.
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
  /// Tests point every instance at one throwaway folder.
  private static let testFolder = environment["NETNYAHOO_SYNC_DEFAULT_FOLDER"].map { URL(fileURLWithPath: $0, isDirectory: true) }

  /// `~/Library/Mobile Documents/com~apple~CloudDocs/Netnyahoo Sync`. Test instances
  /// (NETNYAHOO_DATA_DIR) never default to iCloud Drive.
  static var defaultFolder: URL {
    if let testFolder { return testFolder }
    if let dataDirectory { return dataDirectory.appendingPathComponent("Netnyahoo Sync", isDirectory: true) }
    return SyncFolder.iCloudDrive.appendingPathComponent("Netnyahoo Sync", isDirectory: true)
  }

  /// Test instances keep the key in their data folder, off the login Keychain (as Chrome's
  /// mock keychain does for them).
  static let keyStore: SyncKeyStore = dataDirectory.map { FileKeyStore(directory: $0) } ?? KeychainKeyStore()

  /// Chrome's user data folder and a profile's folder in it (NNCef.mm ProfilePath).
  static func profileDirectory(_ engineProfile: String) -> URL {
    let root = dataDirectory?.appendingPathComponent("Chromium", isDirectory: true)
      ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.netnyahoo.browser", isDirectory: true)
      .appendingPathComponent("Chromium", isDirectory: true)
    return root.appendingPathComponent(engineProfile.isEmpty ? "Default" : "Profile \(engineProfile)", isDirectory: true)
  }

  /// The secret Chrome encrypts saved passwords with: its "Netnyahoo Safe Storage" item, or
  /// the mock keychain's fixed one where NNCef turns that on (test instances, ad-hoc builds).
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

/// The key for this launch, shared by the module's queues.
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
