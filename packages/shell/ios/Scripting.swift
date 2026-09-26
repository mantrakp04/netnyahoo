import AppKit

/// AppleScript support (Netnyahoo.sdef). Windows, tabs and profiles live in the JS store, so
/// JS pushes a snapshot of them (`setScriptState`) that property reads are answered from, and
/// every change is a request to JS: the Apple event is suspended until JS replies (after
/// pushing a fresh snapshot), so `make new tab` followed by `URL of active tab` sees the tab.
public enum ShellScripting {
  struct TabInfo {
    let id: String
    let windowId: String
    let title: String
    let url: String
    let loading: Bool
    let pinned: Bool
  }

  struct WindowInfo {
    let id: String
    let title: String
    let profileId: String
    let incognito: Bool
    let activeTabId: String?
    let tabs: [TabInfo]
  }

  struct ProfileInfo {
    let id: String
    let name: String
  }

  static var windowInfos: [WindowInfo] = []
  static var profileInfos: [ProfileInfo] = []

  /// Emits a request to JS ("onScriptCommand"); set by the app module.
  static var send: (([String: Any]) -> Void)?
  private static var pending: [String: (Any?, String?) -> Void] = [:]
  private static var seq = 0

  static func setState(_ d: [String: Any]) {
    windowInfos = (d["windows"] as? [[String: Any]] ?? []).map { w in
      let id = w["id"] as? String ?? ""
      return WindowInfo(
        id: id,
        title: w["title"] as? String ?? "",
        profileId: w["profileId"] as? String ?? "",
        incognito: w["incognito"] as? Bool ?? false,
        activeTabId: w["activeTabId"] as? String,
        tabs: (w["tabs"] as? [[String: Any]] ?? []).map { t in
          TabInfo(
            id: t["id"] as? String ?? "", windowId: id, title: t["title"] as? String ?? "", url: t["url"] as? String ?? "",
            loading: t["loading"] as? Bool ?? false, pinned: t["pinned"] as? Bool ?? false)
        })
    }
    profileInfos = (d["profiles"] as? [[String: Any]] ?? []).map {
      ProfileInfo(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "")
    }
  }

  // MARK: Lookups

  /// Front to back, like `window 1` in every other app.
  static var orderedWindowInfos: [WindowInfo] {
    let byId = Dictionary(windowInfos.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    let front = NSApp.orderedWindows.compactMap { WindowManager.shared.id(of: $0) }.compactMap { byId[$0] }
    let seen = Set(front.map(\.id))
    return front + windowInfos.filter { !seen.contains($0.id) }
  }

  static func window(_ id: String) -> WindowInfo? { windowInfos.first { $0.id == id } }

  static func tab(_ id: String) -> TabInfo? {
    for w in windowInfos { if let t = w.tabs.first(where: { $0.id == id }) { return t } }
    return nil
  }

  /// For the app delegate: `application(_:delegateHandlesKey:)`.
  public static func handles(_ key: String) -> Bool {
    ["appleScriptWindows", "appleScriptProfiles", "version"].contains(key)
  }

  public static var windows: [NSObject] { orderedWindowInfos.map { ScriptWindow(id: $0.id) } }
  public static var profiles: [NSObject] { profileInfos.map { ScriptProfile(id: $0.id) } }
  public static var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "" }

  // MARK: Requests to JS

  static func reply(_ id: String, result: Any?, error: String?) {
    pending.removeValue(forKey: id)?(result, error)
  }

  /// Suspends the running Apple event until JS answers `body`, then resumes it with
  /// `transform(result)` (or the error JS reported).
  static func perform(_ body: [String: Any], transform: @escaping ([String: Any]) -> Any? = { _ in nil }) -> Any? {
    #if DEBUG
    if !Thread.isMainThread { NSLog("Netnyahoo: an Apple event is being handled off the main thread") }
    #endif
    guard let send else {
      NSScriptCommand.current()?.setError("Netnyahoo isn't ready yet.")
      return nil
    }
    seq += 1
    let id = "as-\(seq)"
    let command = NSScriptCommand.current()
    command?.suspendExecution()
    var finished = false
    pending[id] = { result, error in
      guard !finished else { return }
      finished = true
      if let error { command?.setError(error) }
      let value = error == nil ? transform(result as? [String: Any] ?? [:]) : nil
      // A reply AppKit can't convert throws; fail the script, not the app.
      if let failure = NNTryCatch({ command?.resumeExecution(withResult: value) }) {
        NSLog("Netnyahoo: AppleScript reply failed: \(failure)")
      }
    }
    var request = body
    request["id"] = id
    send(request)
    // Scripts shouldn't hang forever on a stuck page.
    DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
      reply(id, result: nil, error: "Netnyahoo didn't respond in time.")
    }
    return nil
  }
}

extension NSScriptCommand {
  func setError(_ message: String) {
    scriptErrorNumber = -10000 // errAEEventFailed
    scriptErrorString = message
  }
}

private let appDescription = NSScriptClassDescription(for: NSApplication.self)

@objc(NNScriptWindow)
final class ScriptWindow: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  private var info: ShellScripting.WindowInfo? { ShellScripting.window(uniqueID) }
  private var nsWindow: NSWindow? { WindowManager.shared.windows[uniqueID] }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    NSUniqueIDSpecifier(containerClassDescription: appDescription!, containerSpecifier: nil, key: "appleScriptWindows", uniqueID: uniqueID)
  }

  @objc var name: String { info?.title ?? "" }
  @objc var orderedIndex: Int { (ShellScripting.orderedWindowInfos.firstIndex { $0.id == uniqueID } ?? -1) + 1 }
  @objc var incognito: Bool { info?.incognito ?? false }
  @objc var appleScriptTabs: [ScriptTab] { info?.tabs.map { ScriptTab(id: $0.id) } ?? [] }
  @objc var activeTab: ScriptTab? { info?.activeTabId.map(ScriptTab.init(id:)) }
  /// The active tab's address. A window property so `make new window with properties {URL:…}`
  /// passes AppleScript's record check (the create command opens it).
  @objc var URL: String { info.flatMap { i in i.tabs.first { $0.id == i.activeTabId }?.url } ?? "" }
  @objc var activeProfile: ScriptProfile? {
    guard let info, !info.incognito else { return nil }
    return ScriptProfile(id: info.profileId)
  }

  @objc func valueInAppleScriptTabsWithUniqueID(_ id: String) -> ScriptTab? {
    info?.tabs.contains { $0.id == id } == true ? ScriptTab(id: id) : nil
  }

  /// 1-based, like Chrome's `active tab index`; setting it selects that tab.
  @objc var activeTabIndex: Int {
    get { (info?.tabs.firstIndex { $0.id == info?.activeTabId } ?? -1) + 1 }
    set { _ = ShellScripting.perform(["command": "setActiveTabIndex", "windowId": uniqueID, "index": newValue]) }
  }

  @objc var isVisible: Bool { nsWindow?.isVisible ?? false }
  @objc var isMiniaturized: Bool {
    get { nsWindow?.isMiniaturized ?? false }
    set { newValue ? nsWindow?.miniaturize(nil) : nsWindow?.deminiaturize(nil) }
  }
  @objc var isZoomed: Bool {
    get { nsWindow?.isZoomed ?? false }
    set { if newValue != nsWindow?.isZoomed { nsWindow?.zoom(nil) } }
  }

  @objc func handleCloseScriptCommand(_ command: NSCloseCommand) -> Any? {
    ShellScripting.perform(["command": "closeWindow", "windowId": uniqueID])
  }
}

@objc(NNScriptTab)
final class ScriptTab: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  private var info: ShellScripting.TabInfo? { ShellScripting.tab(uniqueID) }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    guard let windowId = info?.windowId else { return nil }
    let window = ScriptWindow(id: windowId)
    return NSUniqueIDSpecifier(
      containerClassDescription: NSScriptClassDescription(for: ScriptWindow.self)!, containerSpecifier: window.objectSpecifier,
      key: "appleScriptTabs", uniqueID: uniqueID)
  }

  @objc var title: String { info?.title ?? "" }
  @objc var loading: Bool { info?.loading ?? false }
  @objc var isPinned: Bool { info?.pinned ?? false }
  @objc var isFocused: Bool {
    guard let info else { return false }
    return ShellScripting.window(info.windowId)?.activeTabId == uniqueID
  }

  /// "" for the New Tab page. Setting it navigates the tab.
  @objc(URL) var scriptURL: String {
    get { info?.url ?? "" }
    set { _ = ShellScripting.perform(["command": "setURL", "tabId": uniqueID, "url": newValue]) }
  }

  @objc func handleCloseScriptCommand(_ command: NSCloseCommand) -> Any? {
    ShellScripting.perform(["command": "closeTab", "tabId": uniqueID])
  }

  @objc func handleReloadScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "reload", "tabId": uniqueID])
  }

  @objc func handleGoBackScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "back", "tabId": uniqueID])
  }

  @objc func handleGoForwardScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "forward", "tabId": uniqueID])
  }

  @objc func handleFocusScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "focusTab", "tabId": uniqueID])
  }

  /// `execute tab … javascript "…"` → the value of the last expression, as text.
  @objc func handleExecuteScriptCommand(_ command: NSScriptCommand) -> Any? {
    guard let code = command.evaluatedArguments?["javascript"] as? String else {
      command.setError("Missing the “javascript” parameter.")
      return nil
    }
    return ShellScripting.perform(["command": "execute", "tabId": uniqueID, "code": code]) { $0["value"] as? String ?? "" }
  }
}

@objc(NNScriptProfile)
final class ScriptProfile: NSObject {
  @objc let uniqueID: String

  init(id: String) {
    uniqueID = id
  }

  override var objectSpecifier: NSScriptObjectSpecifier? {
    NSUniqueIDSpecifier(containerClassDescription: appDescription!, containerSpecifier: nil, key: "appleScriptProfiles", uniqueID: uniqueID)
  }

  @objc var name: String { ShellScripting.profileInfos.first { $0.id == uniqueID }?.name ?? "" }
  @objc var orderedIndex: Int { (ShellScripting.profileInfos.firstIndex { $0.id == uniqueID } ?? -1) + 1 }

  /// Every open tab in this profile, window by window (front to back).
  @objc var appleScriptTabs: [ScriptTab] {
    ShellScripting.orderedWindowInfos.filter { $0.profileId == uniqueID }.flatMap { $0.tabs.map { ScriptTab(id: $0.id) } }
  }

  /// Shows this profile in the front window.
  @objc func handleFocusScriptCommand(_ command: NSScriptCommand) -> Any? {
    ShellScripting.perform(["command": "focusProfile", "profileId": uniqueID])
  }
}

/// `make new window` / `make new tab [at …] [with properties {URL: …}]`.
@objc(NNScriptCreateCommand)
final class ScriptCreateCommand: NSCreateCommand {
  override func performDefaultImplementation() -> Any? {
    let properties = resolvedKeyDictionary
    let url = properties["URL"] as? String
    switch createClassDescription.className {
    case "window":
      var body: [String: Any] = ["command": "newWindow", "incognito": properties["incognito"] as? Bool ?? false]
      if let url { body["url"] = url }
      if let profile = properties["activeProfile"] as? ScriptProfile { body["profileId"] = profile.uniqueID }
      // Replies must be specifiers, not the objects: a resumed command doesn't convert them.
      return ShellScripting.perform(body) { ($0["windowId"] as? String).flatMap { ScriptWindow(id: $0).objectSpecifier } }
    case "tab":
      var body: [String: Any] = ["command": "newTab"]
      if let url { body["url"] = url }
      let location = arguments?["Location"] as? NSPositionalSpecifier
      if let window = (location?.insertionContainer as? ScriptWindow) ?? ShellScripting.orderedWindowInfos.first.map({ ScriptWindow(id: $0.id) }) {
        body["windowId"] = window.uniqueID
        // `at end of tabs` → -1; `at beginning` → 0; `at after tab 2` → 2.
        if let index = location?.insertionIndex, index >= 0 { body["index"] = index }
      }
      return ShellScripting.perform(body) { ($0["tabId"] as? String).flatMap { ScriptTab(id: $0).objectSpecifier } }
    default:
      setError("Netnyahoo can't make a new \(createClassDescription.className).")
      return nil
    }
  }
}
