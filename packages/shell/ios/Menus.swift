import AppKit

struct MenuState {
  struct Entry: Equatable {
    let id: String
    let title: String
    let current: Bool
  }

  struct Bookmark {
    let id: String
    let title: String
    let url: String?
    let children: [Bookmark]?
  }

  static var current = MenuState()

  var checked = Set<String>()
  var disabled = Set<String>()
  var titles: [String: String] = [:]
  var profiles: [Entry] = []
  var windows: [Entry] = []
  var bookmarkFolders: [Entry] = []
  var recentBookmarks: [Bookmark] = []
  var bookmarksBar: [Bookmark] = []
  var otherBookmarks: [Bookmark] = []
  // Set when the bookmark lists come separately (setMenuBookmarks), bumped each time they do; nil when every
  // update carries them.
  var bookmarksRevision: Int?
  var recentlyClosed: [Entry] = []
  var recentlyClosedGroups: [Entry] = []
  var warnBeforeQuitting = false
  var warnBeforeClosingWindow = false
  var downloadsInProgress = 0
  var shortcuts: [String: [String]] = [:]
  var extensions: [(id: String, title: String, icon: String?)] = []

  init() {}

  static func bookmarks(_ list: Any?) -> [Bookmark] {
    (list as? [[String: Any]] ?? []).map {
      Bookmark(
        id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", url: $0["url"] as? String,
        children: $0["children"] == nil ? nil : bookmarks($0["children"]))
    }
  }

  // The bookmark lists as setMenuBookmarks last sent them.
  private(set) static var sentBookmarks: (state: MenuState, revision: Int)?

  static func setBookmarks(_ d: [String: Any]) {
    var state = MenuState()
    state.bookmarkFolders = (d["bookmarkFolders"] as? [[String: Any]] ?? []).map {
      Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
    }
    state.recentBookmarks = bookmarks(d["recentBookmarks"])
    state.bookmarksBar = bookmarks(d["bookmarksBar"])
    state.otherBookmarks = bookmarks(d["otherBookmarks"])
    let revision = (sentBookmarks?.revision ?? 0) + 1
    sentBookmarks = (state, revision)
    current.bookmarkFolders = state.bookmarkFolders
    current.recentBookmarks = state.recentBookmarks
    current.bookmarksBar = state.bookmarksBar
    current.otherBookmarks = state.otherBookmarks
    current.bookmarksRevision = revision
  }

  init(_ d: [String: Any]) {
    func strings(_ key: String) -> [String] { d[key] as? [String] ?? [] }
    func entries(_ key: String) -> [Entry] {
      (d[key] as? [[String: Any]] ?? []).map {
        Entry(id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", current: $0["current"] as? Bool ?? false)
      }
    }
    checked = Set(strings("checked"))
    disabled = Set(strings("disabled"))
    titles = d["titles"] as? [String: String] ?? [:]
    profiles = entries("profiles")
    windows = entries("windows")
    if d["bookmarksBar"] == nil, let sent = MenuState.sentBookmarks {
      (bookmarkFolders, recentBookmarks, bookmarksBar, otherBookmarks) =
        (sent.state.bookmarkFolders, sent.state.recentBookmarks, sent.state.bookmarksBar, sent.state.otherBookmarks)
      bookmarksRevision = sent.revision
    } else {
      bookmarkFolders = entries("bookmarkFolders")
      recentBookmarks = Self.bookmarks(d["recentBookmarks"])
      bookmarksBar = Self.bookmarks(d["bookmarksBar"])
      otherBookmarks = Self.bookmarks(d["otherBookmarks"])
    }
    recentlyClosed = entries("recentlyClosed")
    recentlyClosedGroups = entries("recentlyClosedGroups")
    warnBeforeQuitting = d["warnBeforeQuitting"] as? Bool ?? false
    warnBeforeClosingWindow = d["warnBeforeClosingWindow"] as? Bool ?? false
    downloadsInProgress = d["downloadsInProgress"] as? Int ?? 0
    shortcuts = d["shortcuts"] as? [String: [String]] ?? [:]
    extensions = (d["extensions"] as? [[String: Any]] ?? []).map {
      (id: $0["id"] as? String ?? "", title: $0["title"] as? String ?? "", icon: $0["icon"] as? String)
    }
  }
}

final class CommandItem: NSMenuItem {
  let command: String
  let arg: String?
  let defaultTitle: String
  var windowless = false
  var tracksChecked = true
  let defaultKey: String
  let defaultModifiers: NSEvent.ModifierFlags

  var stateKey: String { arg.map { "\(command):\($0)" } ?? command }

  init(_ title: String, _ command: String, arg: String? = nil, key: String = "", _ mods: NSEvent.ModifierFlags = .command) {
    self.command = command
    self.arg = arg
    defaultTitle = title
    defaultKey = key
    defaultModifiers = mods
    super.init(title: title, action: #selector(MenuTarget.performCommand(_:)), keyEquivalent: key)
    keyEquivalentModifierMask = mods
    target = MenuTarget.shared
    tag = Self.chromeMenuTag
  }

// Chrome only leaves non-Chrome tagged `commandDispatch:` items for AppKit.
  static let chromeMenuTag = 1

  required init(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func hiddenShortcut() -> CommandItem {
    isHidden = true
    allowsKeyEquivalentWhenHidden = true
    return self
  }

  func alternate() -> CommandItem {
    isAlternate = true
    return self
  }
}

final class MenuTarget: NSObject, NSMenuItemValidation {
  static let shared = MenuTarget()
  var handler: ((String, String?, String?) -> Void)?

  @objc(commandDispatch:) func performCommand(_ sender: NSMenuItem) {
    guard let item = sender as? CommandItem else { return }
    handler?(item.command, item.arg, item.windowless ? nil : WindowManager.shared.keyWindowId)
  }

  func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
    if menuItem.action == #selector(closeWindow(_:)) { return WindowManager.shared.closableWindow != nil }
    if menuItem.action == #selector(toggleKeepOnTop(_:)) {
      guard let window = WindowManager.shared.keyBrowserWindow else { return false }
      menuItem.state = window.level == .floating ? .on : .off
      return true
    }
    guard let item = menuItem as? CommandItem else { return true }
    let state = MenuState.current
    if item.tracksChecked { item.state = state.checked.contains(item.stateKey) ? .on : .off }
    let title = state.titles[item.stateKey] ?? item.defaultTitle
    if item.title != title { item.title = title }
    if item.keyEquivalent == "\r", NSApp.keyWindow?.firstResponder is NSText { return false }
    if item.keyEquivalent == MainMenu.leftArrow || item.keyEquivalent == MainMenu.rightArrow,
       item.keyEquivalentModifierMask == .command, NSApp.keyWindow?.firstResponder is NSText { return false }
    return !state.disabled.contains(item.stateKey) && !state.disabled.contains(item.command)
  }

  @objc func quit(_ sender: Any?) { WindowManager.shared.confirmQuit() }
  @objc func arrangeWindowsInFront(_ sender: Any?) { NSApp.arrangeInFront(sender) }
  @objc func toggleKeepOnTop(_ sender: Any?) { WindowManager.shared.toggleKeepOnTop() }
  @objc func closeWindow(_ sender: Any?) { WindowManager.shared.closableWindow?.performClose(sender) }

  @objc func pasteAndMatchStyle(_ sender: Any?) {
    let web = Selector(("pasteAndMatchStyle:"))
    if NSApp.target(forAction: web) != nil {
      NSApp.sendAction(web, to: nil, from: sender)
    } else {
      NSApp.sendAction(#selector(NSTextView.pasteAsPlainText(_:)), to: nil, from: sender)
    }
  }
}

enum MainMenu {
  private static var moveToProfile = NSMenu(title: "Move to Profile")
  private static var moveToWindow = NSMenu(title: "Move to Window")
  private static var bookmarkToFolder = NSMenu(title: "Add Bookmark to Folder")
  private static var profiles = NSMenu(title: "Profiles")
  private static var profilesItem = NSMenuItem(title: "Profiles", action: nil, keyEquivalent: "")
  private static var profilesSeparator = NSMenuItem.separator()
  private static var bookmarks = NSMenu(title: "Bookmarks")
  private static var bookmarksFixedCount = 0
  private static var history = NSMenu(title: "History")
  private static var extensions = NSMenu(title: "Extensions")
  private static var extensionIcons: [String: NSImage] = [:]

  static func build() -> NSMenu {
    let appName = ProcessInfo.processInfo.processName
    let main = NSMenu()
    moveToProfile = NSMenu(title: "Move to Profile")
    moveToWindow = NSMenu(title: "Move to Window")
    bookmarkToFolder = NSMenu(title: "Add Bookmark to Folder")
    profiles = NSMenu(title: "Profiles")
    profilesSeparator = NSMenuItem.separator()

    func std(_ title: String, _ action: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
      item.keyEquivalentModifierMask = mods
      return item
    }
    func sub(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenuItem {
      let submenu = menu ?? NSMenu(title: title)
      submenu.autoenablesItems = true
      items.forEach(submenu.addItem)
      let root = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      root.submenu = submenu
      return root
    }
    func top(_ title: String, _ items: [NSMenuItem], menu: NSMenu? = nil) -> NSMenu {
      let item = sub(title, items, menu: menu)
      main.addItem(item)
      return item.submenu!
    }
    func cmd(_ title: String, _ command: String, arg: String? = nil, _ key: String = "", _ mods: NSEvent.ModifierFlags = .command) -> CommandItem {
      CommandItem(title, command, arg: arg, key: key, mods)
    }

    let quit = std("Quit \(appName)", #selector(MenuTarget.quit(_:)), "q")
    quit.target = MenuTarget.shared
    let closeWindow = std("Close Window", #selector(MenuTarget.closeWindow(_:)), "w", [.command, .shift])
    closeWindow.target = MenuTarget.shared
    let services = NSMenu(title: "Services")
    NSApp.servicesMenu = services
    _ = top(appName, [
      std("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      updatesItem(),
      .separator(),
      cmd("Settings…", "openSettings", ","),
      cmd("Import from Another Browser…", "importBrowserData"),
      .separator(),
      sub("Services", [], menu: services),
      .separator(),
      std("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
      std("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      std("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      quit,
    ])

    _ = top("File", [
      cmd("New Tab", "newTab", "t"),
      cmd("New Tab in Group", "newTabInGroup", "t", [.command, .option]),
      cmd("New Window", "newWindow", "n"),
      cmd("New Incognito Window", "newIncognitoWindow", "n", [.command, .shift]),
      cmd("New Small Yahu Window", "newSmallYahu", "n", [.command, .option]),
      // Its title says where links from other apps will go once chosen (JS sets it from the setting).
      cmd("Open Links from Other Apps in Main Window", "toggleOpenLinksInSmallYahu"),
      cmd("Reopen Closed Tab", "reopenClosedTab", "t", [.command, .shift]),
      cmd("Reopen Closed Window", "reopenClosedWindow"),
      cmd("Open File…", "openFile", "o"),
      .separator(),
      cmd("Open Command Bar", "focusCommandBar", "l"),
      cmd("Open Command Bar", "focusCommandBar", functionKey(NSF5FunctionKey), .control).hiddenShortcut(),
      .separator(),
      closeWindow,
      cmd("Close Tab", "closeTab", "w"),
      cmd("Close All Tabs", "closeAllTabs", "k", [.command, .shift]),
      cmd("Clean Up Tabs", "cleanUpTabs", "k", [.command, .option]),
      .separator(),
      cmd("Save Page As…", "savePage"),
      cmd("Share…", "share"),
      cmd("Email Page Location", "emailPageLocation", "i", [.command, .shift]),
      cmd("Print…", "print", "p"),
      cmd("Print Using System Dialog…", "printWithSystemDialog", "p", [.command, .option]),
    ])

    let paste = NSMenuItem(title: "Paste and Match Style", action: #selector(MenuTarget.pasteAndMatchStyle(_:)), keyEquivalent: "v")
    paste.keyEquivalentModifierMask = [.command, .shift]
    paste.target = MenuTarget.shared
    _ = top("Edit", [
      std("Undo", Selector(("undo:")), "z"),
      std("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      std("Cut", #selector(NSText.cut(_:)), "x"),
      std("Copy", #selector(NSText.copy(_:)), "c"),
      cmd("Copy URL", "copyUrl", "c", [.command, .shift]),
      cmd("Copy URL as Markdown", "copyUrlAsMarkdown", "c", [.command, .option, .shift]),
      std("Paste", #selector(NSText.paste(_:)), "v"),
      paste,
      std("Delete", #selector(NSText.delete(_:))),
      std("Select All", #selector(NSText.selectAll(_:)), "a"),
      .separator(),
      sub("Find", [
        cmd("Find…", "findInPage", "f"),
        cmd("Find and Replace…", "findAndReplace", "f", [.command, .option]),
        cmd("Find Next", "findNext", "g"),
        cmd("Find Previous", "findPrevious", "g", [.command, .shift]),
        cmd("Use Selection for Find", "useSelectionForFind", "e"),
        cmd("Jump to Selection", "jumpToSelection", "j"),
      ]),
      sub("Spelling and Grammar", [
        std("Show Spelling and Grammar", #selector(NSText.showGuessPanel(_:)), ":"),
        std("Check Document Now", #selector(NSText.checkSpelling(_:)), ";"),
        .separator(),
        std("Check Spelling While Typing", #selector(NSTextView.toggleContinuousSpellChecking(_:))),
        std("Check Grammar With Spelling", #selector(NSTextView.toggleGrammarChecking(_:))),
        std("Correct Spelling Automatically", #selector(NSTextView.toggleAutomaticSpellingCorrection(_:))),
      ]),
      sub("Substitutions", [
        std("Show Substitutions", #selector(NSTextView.orderFrontSubstitutionsPanel(_:))),
        .separator(),
        std("Smart Copy/Paste", #selector(NSTextView.toggleSmartInsertDelete(_:))),
        std("Smart Quotes", #selector(NSTextView.toggleAutomaticQuoteSubstitution(_:))),
        std("Smart Dashes", #selector(NSTextView.toggleAutomaticDashSubstitution(_:))),
        std("Smart Links", #selector(NSTextView.toggleAutomaticLinkDetection(_:))),
        std("Data Detectors", #selector(NSTextView.toggleAutomaticDataDetection(_:))),
        std("Text Replacement", #selector(NSTextView.toggleAutomaticTextReplacement(_:))),
      ]),
      sub("Transformations", [
        std("Make Upper Case", #selector(NSResponder.uppercaseWord(_:))),
        std("Make Lower Case", #selector(NSResponder.lowercaseWord(_:))),
        std("Capitalize", #selector(NSResponder.capitalizeWord(_:))),
      ]),
      sub("Speech", [
        std("Start Speaking", #selector(NSTextView.startSpeaking(_:))),
        std("Stop Speaking", #selector(NSTextView.stopSpeaking(_:))),
      ]),
      sub("AutoFill", [
        cmd("Contact…", "autofill", arg: "contact"),
        cmd("Passwords…", "autofill", arg: "passwords"),
        cmd("Credit Card…", "autofill", arg: "creditCard"),
      ]),
    ])

    let fullScreen = std("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", .function)
    let fullScreenAlias = std("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])
    fullScreenAlias.isHidden = true
    fullScreenAlias.allowsKeyEquivalentWhenHidden = true
    _ = top("View", [
      sub("Appearance", [
        cmd("Automatic", "setAppearance", arg: "auto"),
        cmd("Light", "setAppearance", arg: "light"),
        cmd("Dark", "setAppearance", arg: "dark"),
      ]),
      cmd("Stop", "stop", "."),
      cmd("Refresh", "reload", "r"),
      cmd("Force Refresh the Page", "forceReload", "r", [.command, .shift]).alternate(),
      .separator(),
      cmd("Show Tabs in Sidebar", "toggleTabLayout", "s", [.command, .shift]),
      cmd("Auto-Hide Tabs", "toggleSidebar", "s"),
      cmd("Auto-Hide Tabs", "toggleSidebar", "l", [.command, .shift]).hiddenShortcut(),
      cmd("Auto-Hide Tabs", "toggleSidebar", "f", [.command, .shift]).hiddenShortcut(),
      .separator(),
      cmd("Open Split Pane", "openSplitPane", "=", [.control, .shift]),
      cmd("Focus Next Split Pane", "focusNextPane", "]", [.control, .shift]),
      cmd("Focus Previous Split Pane", "focusPreviousPane", "[", [.control, .shift]),
      cmd("Open Split Pane", "openSplitPane", "+", .control).hiddenShortcut(),
      cmd("Focus Next Split Pane", "focusNextPane", "}", .control).hiddenShortcut(),
      cmd("Focus Previous Split Pane", "focusPreviousPane", "{", .control).hiddenShortcut(),
      .separator(),
      sub("Show Bookmarks Bar", [
        cmd("Always", "setBookmarksBar", arg: "always"),
        cmd("On New Tab Only", "setBookmarksBar", arg: "newTab"),
        cmd("Never", "setBookmarksBar", arg: "never"),
        .separator(),
        cmd("Toggle Bookmarks Bar", "toggleBookmarksBar", "b", [.command, .shift]),
      ]),
      .separator(),
      cmd("Show Full URL", "toggleFullUrl"),
      cmd("Show Address Bar in Sidebar", "toggleAddressBar"),
      cmd("Cast…", "cast"),
      .separator(),
      cmd("Zoom to Actual Size", "zoomReset", "0"),
      cmd("Zoom In", "zoomIn", "+"),
      cmd("Zoom In", "zoomIn", "=").hiddenShortcut(),
      cmd("Zoom Out", "zoomOut", "-"),
      .separator(),
      fullScreen,
      fullScreenAlias,
      .separator(),
      sub("Developer", [
        cmd("View Source", "viewSource", "u", [.command, .option]),
        cmd("Developer Tools", "devTools", "i", [.command, .option]),
        cmd("Inspect Elements", "inspectElements", "c", [.command, .option]),
        cmd("JavaScript Console", "javaScriptConsole", "j", [.command, .option]),
        cmd("Developer Tools", "toggleDevTools", functionKey(NSF12FunctionKey), []).hiddenShortcut(),
        cmd("Caret Browsing", "caretBrowsing", functionKey(NSF7FunctionKey), []).hiddenShortcut(),
      ]),
    ])

    let selectTab = (1...8).map { cmd("Tab \($0)", "selectTab", arg: "\($0)", "\($0)").hiddenShortcut() }
    _ = top("Tabs", [
      cmd("Go Back", "back", "["),
      cmd("Go Forward", "forward", "]"),
      cmd("Go Back", "back", leftArrow).hiddenShortcut(),
      cmd("Go Forward", "forward", rightArrow).hiddenShortcut(),
      .separator(),
      cmd("Next Tab", "nextTab", "]", [.command, .shift]),
      cmd("Previous Tab", "previousTab", "[", [.command, .shift]),
      cmd("Next Tab", "nextTab", "}").hiddenShortcut(),
      cmd("Previous Tab", "previousTab", "{").hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSRightArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSLeftArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSPageDownFunctionKey), .control).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSPageUpFunctionKey), .control).hiddenShortcut(),
      cmd("Next Tab", "nextTab", functionKey(NSDownArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Previous Tab", "previousTab", functionKey(NSUpArrowFunctionKey), [.command, .option]).hiddenShortcut(),
      cmd("Move Tab Down", "moveTabDown", functionKey(NSPageDownFunctionKey), [.control, .shift]).hiddenShortcut(),
      cmd("Move Tab Up", "moveTabUp", functionKey(NSPageUpFunctionKey), [.control, .shift]).hiddenShortcut(),
      cmd("Search Tabs…", "searchTabs", "a", [.command, .shift]),
      cmd("Tab Switcher (forward)", "tabSwitcher", arg: "forward", "\t", .control).hiddenShortcut(),
      cmd("Tab Switcher (backward)", "tabSwitcher", arg: "backward", "\t", [.control, .shift]).hiddenShortcut(),
      cmd("Back to Pinned URL", "returnToPinnedUrl", "\r").hiddenShortcut(),
    ] + selectTab + [
      cmd("Last Tab", "selectLastTab", "9").hiddenShortcut(),
      .separator(),
      cmd("Pin", "togglePin"),
      cmd("Duplicate", "duplicateTab"),
      cmd("New Group with Tab", "newGroupWithTabs", "n", [.command, .control]),
      cmd("New Group with Tab", "newGroupWithTabs", "p", [.command, .control]).hiddenShortcut(),
      cmd("New Tab in Group", "newTabInGroup", "c", [.command, .control]).hiddenShortcut(),
      cmd("Close Group", "closeTabGroup", "w", [.command, .control]).hiddenShortcut(),
      .separator(),
      sub("Move to Profile", [], menu: moveToProfile),
      sub("Move to Window", [], menu: moveToWindow),
      .separator(),
      cmd("Add to Bookmarks…", "bookmarkPage", "d"),
      sub("Add Bookmark to Folder", [], menu: bookmarkToFolder),
      .separator(),
      cmd("Rename…", "renameTab"),
      cmd("Change Icon…", "changeTabIcon"),
      cmd("Mute Site", "toggleMute"),
    ])

    bookmarks = top("Bookmarks", [
      cmd("Bookmark This Page", "bookmarkPage", "d"),
      cmd("Bookmark All Tabs…", "bookmarkAllTabs", "d", [.command, .shift]),
      cmd("Manage Bookmarks", "manageBookmarks", "b", [.command, .option]),
    ])
    bookmarksFixedCount = bookmarks.items.count
    history = top("History", [])
    extensions = top("Extensions", [])

    profilesItem = sub("Profiles", [], menu: profiles)
    let minimizeAll = std("Minimize All", #selector(NSApplication.miniaturizeAll(_:)), "m", [.command, .option])
    let arrange = NSMenuItem(title: "Arrange in Front", action: #selector(MenuTarget.arrangeWindowsInFront(_:)), keyEquivalent: "")
    arrange.target = MenuTarget.shared
    let keepOnTop = NSMenuItem(title: "Keep Window on Top", action: #selector(MenuTarget.toggleKeepOnTop(_:)), keyEquivalent: "")
    keepOnTop.target = MenuTarget.shared
    minimizeAll.isAlternate = true
    let windowMenu = top("Window", [
      std("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
      minimizeAll,
      arrange,
      keepOnTop,
      .separator(),
      cmd("Downloads", "downloads", "j", [.command, .shift]),
      cmd("Downloads", "downloads", "l", [.command, .option]).hiddenShortcut(),
      CommandItem("Task Manager", "taskManager", key: ""),
      cmd("Merge All Windows", "mergeAllWindows"),
      profilesSeparator,
      profilesItem,
      cmd("Profiles", "openProfileMenu", "m", [.command, .shift]).hiddenShortcut(),
    ])
    NSApp.windowsMenu = windowMenu

    NSApp.helpMenu = top("Help", helpItems())

    built = nil
    refresh()
    return main
  }

  private static func functionKey(_ key: Int) -> String { String(Character(UnicodeScalar(UInt16(key))!)) }
  static let leftArrow = functionKey(NSLeftArrowFunctionKey), rightArrow = functionKey(NSRightArrowFunctionKey)

  private static func updatesItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Check for Updates…", action: #selector(AppUpdater.checkForUpdates(_:)), keyEquivalent: "")
    item.target = AppUpdater.shared
    item.isHidden = !AppUpdater.shared.isAvailable
    return item
  }

  private static func videoTourItem() -> NSMenuItem {
    let item = CommandItem("Video Tour", "videoTour", key: "")
    let url = Bundle.main.object(forInfoDictionaryKey: "NNVideoTourURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func releaseNotesItem() -> NSMenuItem {
    let item = CommandItem("Release Notes", "releaseNotes", key: "")
    let url = Bundle.main.object(forInfoDictionaryKey: "NNReleaseNotesURL") as? String ?? ""
    item.isHidden = URL(string: url)?.scheme?.hasPrefix("http") != true
    return item
  }

  private static func helpItems() -> [NSMenuItem] {
    var items: [NSMenuItem] = [
      CommandItem("Send Feedback…", "sendFeedback", key: "i", [.command, .option, .shift]),
      CommandItem("Keyboard Shortcuts", "keyboardShortcuts", key: ""),
      CommandItem("Tool Tour", "toolTour", key: ""),
      videoTourItem(),
      releaseNotesItem(),
      .separator(),
      CommandItem("Copy Diagnostics", "copyDiagnostics", key: ""),
      CommandItem("Record Performance Issue…", "recordPerformanceIssue", key: ""),
    ]
    #if DEBUG
    items += [.separator(), CommandItem("Show Onboarding", "showOnboarding", key: "")]
    #endif
    return items
  }

  private static func extensionIcon(_ dataURL: String?) -> NSImage? {
    guard let dataURL, let comma = dataURL.firstIndex(of: ",") else { return nil }
    if let cached = extensionIcons[dataURL] { return cached }
    guard let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
      let image = NSImage(data: data)
    else { return nil }
    image.size = NSSize(width: 16, height: 16)
    extensionIcons[dataURL] = image
    return image
  }

  // What each rebuilt submenu was last built from: a menu state update (every 120 ms at most while the store
  // changes) rebuilds only the submenus whose contents changed, so thousands of bookmarks aren't rebuilt for a
  // loading spinner.
  private static var built: (profiles: [MenuState.Entry], windows: [MenuState.Entry], bookmarks: Int?,
                             extensions: [String], history: [[MenuState.Entry]])?

  static func refresh() {
    let state = MenuState.current
    let last = built
    let extensionKeys = state.extensions.map { "\($0.id)|\($0.title)|\($0.icon ?? "")" }
    let history = [state.recentlyClosed, state.recentlyClosedGroups]
    built = (state.profiles, state.windows, state.bookmarksRevision, extensionKeys, history)
    if last?.profiles != state.profiles { buildProfileMenus(state) }
    if last?.windows != state.windows { buildMoveToWindow(state) }
    if state.bookmarksRevision == nil || last?.bookmarks != state.bookmarksRevision { buildBookmarkMenus(state) }
    if last?.extensions != extensionKeys { buildExtensions(state) }
    if last?.history != history { buildHistory(state) }
    applyShortcuts(state.shortcuts)
  }

  private static func buildProfileMenus(_ state: MenuState) {
    moveToProfile.removeAllItems()
    for p in state.profiles {
      let item = CommandItem(p.title, "moveTabToProfile", arg: p.id)
      item.tracksChecked = false
      item.state = p.current ? .on : .off
      moveToProfile.addItem(item)
    }
    moveToProfile.addItem(.separator())
    moveToProfile.addItem(CommandItem("New Profile…", "moveTabToProfile", arg: "new"))

    profiles.removeAllItems()
    profilesItem.isHidden = state.profiles.count < 2
    profilesSeparator.isHidden = profilesItem.isHidden
    for (i, p) in state.profiles.enumerated() {
      let item = CommandItem(p.title, "switchProfile", arg: p.id, key: i < 9 ? "\(i + 1)" : "", .control)
      item.tracksChecked = false
      item.state = p.current ? .on : .off
      profiles.addItem(item)
    }
    profiles.addItem(.separator())
    profiles.addItem(CommandItem("Next Profile", "nextProfile"))
    profiles.addItem(CommandItem("Previous Profile", "previousProfile"))
    profiles.addItem(.separator())
    profiles.addItem(CommandItem("New Profile…", "newProfile"))
  }

  private static func buildMoveToWindow(_ state: MenuState) {
    moveToWindow.removeAllItems()
    for w in state.windows { moveToWindow.addItem(CommandItem(w.title, "moveTabToWindow", arg: w.id)) }
    if !state.windows.isEmpty { moveToWindow.addItem(.separator()) }
    moveToWindow.addItem(CommandItem("New Window", "moveTabToWindow", arg: "new"))
  }

  private static func buildBookmarkMenus(_ state: MenuState) {
    bookmarkToFolder.removeAllItems()
    for f in state.bookmarkFolders { bookmarkToFolder.addItem(CommandItem(f.title, "addBookmarkToFolder", arg: f.id)) }
    bookmarkToFolder.addItem(.separator())
    bookmarkToFolder.addItem(CommandItem("New Folder…", "addBookmarkToFolder", arg: "new"))

    while bookmarks.items.count > bookmarksFixedCount { bookmarks.removeItem(at: bookmarksFixedCount) }
    bookmarks.addItem(.separator())
    if !state.recentBookmarks.isEmpty {
      let header = NSMenuItem(title: "Recent Bookmarks", action: nil, keyEquivalent: "")
      header.isEnabled = false
      bookmarks.addItem(header)
      addBookmarks(state.recentBookmarks, to: bookmarks)
      bookmarks.addItem(.separator())
    }
    bookmarks.addItem(folderItem("Bookmarks Bar", state.bookmarksBar))
    bookmarks.addItem(folderItem("Other Bookmarks", state.otherBookmarks))
  }

  private static func buildExtensions(_ state: MenuState) {
    extensions.removeAllItems()
    for ext in state.extensions {
      let item = CommandItem(ext.title, "openExtension", arg: ext.id)
      item.image = extensionIcon(ext.icon)
      extensions.addItem(item)
    }
    if !state.extensions.isEmpty { extensions.addItem(.separator()) }
    extensions.addItem(CommandItem("Add Extension…", "addExtension"))
    extensions.addItem(CommandItem("Manage Extensions…", "manageExtensions"))
    extensions.addItem(CommandItem("Pin Extensions…", "pinExtensions"))
  }

  private static func buildHistory(_ state: MenuState) {
    history.removeAllItems()
    history.addItem(CommandItem("Show History…", "showHistory", key: "y"))
    history.addItem(CommandItem("Clear Browsing Data…", "clearBrowsingData", key: "\u{8}", [.command, .shift]))
    history.addItem(.separator())
    let header = NSMenuItem(title: "Recently Closed", action: nil, keyEquivalent: "")
    header.isEnabled = false
    history.addItem(header)
    for entry in state.recentlyClosed { history.addItem(CommandItem(entry.title, "restoreClosed", arg: entry.id)) }
    if state.recentlyClosed.isEmpty { history.addItem(emptyItem()) }
    if !state.recentlyClosedGroups.isEmpty {
      history.addItem(.separator())
      let groupsHeader = NSMenuItem(title: "Recently Closed Groups", action: nil, keyEquivalent: "")
      groupsHeader.isEnabled = false
      history.addItem(groupsHeader)
      for entry in state.recentlyClosedGroups { history.addItem(CommandItem(entry.title, "restoreClosed", arg: entry.id)) }
    }
  }

  // MARK: Keyboard Shortcuts settings

  private static let modifierNames: [(String, NSEvent.ModifierFlags)] = [
    ("control", .control), ("option", .option), ("shift", .shift), ("command", .command), ("function", .function),
  ]
  private static let dynamicCommands: Set<String> = [
    "openBookmark", "restoreClosed", "moveTabToProfile", "moveTabToWindow", "addBookmarkToFolder", "switchProfile",
  ]

  private static func walk(_ menu: NSMenu?, path: [String] = [], _ visit: (NSMenuItem, [String]) -> Void) {
    for item in menu?.items ?? [] where !item.isSeparatorItem {
      if let submenu = item.submenu {
        walk(submenu, path: path + [item.title], visit)
      } else {
        visit(item, path)
      }
    }
  }

  private static func applyShortcuts(_ overrides: [String: [String]]) {
    walk(NSApp.mainMenu) { item, _ in
      guard let item = item as? CommandItem else { return }
      if let o = overrides[item.stateKey] {
        let key = item.isHidden ? "" : (o.first ?? "")
        let mods = NSEvent.ModifierFlags(modifierNames.filter { o.dropFirst().contains($0.0) }.map(\.1))
        if item.keyEquivalent != key { item.keyEquivalent = key }
        if item.keyEquivalentModifierMask != mods { item.keyEquivalentModifierMask = mods }
      } else if item.keyEquivalent != item.defaultKey || item.keyEquivalentModifierMask != item.defaultModifiers {
        item.keyEquivalent = item.defaultKey
        item.keyEquivalentModifierMask = item.defaultModifiers
      }
    }
  }

  static func shortcutList() -> [[String: Any]] {
    var list: [[String: Any]] = []
    var seen = Set<String>()
    func names(_ mods: NSEvent.ModifierFlags) -> [String] {
      modifierNames.filter { mods.contains($0.1) }.map(\.0)
    }
    walk(NSApp.mainMenu) { item, path in
      guard !item.isHidden, !item.isAlternate || item is CommandItem, !item.title.isEmpty, item.title != "Empty" else { return }
      if let item = item as? CommandItem {
        guard !dynamicCommands.contains(item.command), seen.insert(item.stateKey).inserted else { return }
        list.append([
          "id": item.stateKey, "title": item.defaultTitle, "path": path, "key": item.keyEquivalent,
          "modifiers": item.keyEquivalent.isEmpty ? [] : names(item.keyEquivalentModifierMask), "defaultKey": item.defaultKey,
          "defaultModifiers": item.defaultKey.isEmpty ? [] : names(item.defaultModifiers), "remappable": true,
        ])
      } else if !item.keyEquivalent.isEmpty, item.action != nil {
        let id = "std:" + (path + [item.title]).joined(separator: " > ")
        guard seen.insert(id).inserted else { return }
        let mods = names(item.keyEquivalentModifierMask)
        list.append([
          "id": id, "title": item.title, "path": path, "key": item.keyEquivalent, "modifiers": mods,
          "defaultKey": item.keyEquivalent, "defaultModifiers": mods, "remappable": false,
        ])
      }
    }
    return list
  }

  private static func emptyItem() -> NSMenuItem {
    let item = NSMenuItem(title: "Empty", action: nil, keyEquivalent: "")
    item.isEnabled = false
    return item
  }

  private static func folderItem(_ title: String, _ children: [MenuState.Bookmark]) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let menu = NSMenu(title: title)
    addBookmarks(children, to: menu)
    if children.isEmpty { menu.addItem(emptyItem()) }
    item.submenu = menu
    item.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
    return item
  }

  private static func addBookmarks(_ nodes: [MenuState.Bookmark], to menu: NSMenu) {
    for node in nodes {
      if let children = node.children {
        menu.addItem(folderItem(node.title, children))
      } else {
        menu.addItem(CommandItem(node.title.isEmpty ? (node.url ?? "") : node.title, "openBookmark", arg: node.id))
      }
    }
  }

  static func dockMenu() -> NSMenu {
    let menu = NSMenu()
    let state = MenuState.current
    if state.profiles.count > 1 {
      for p in state.profiles {
        let item = CommandItem("New \(p.title) Window", "newWindow", arg: p.id)
        item.windowless = true
        menu.addItem(item)
      }
    } else {
      let item = CommandItem("New Window", "newWindow")
      item.windowless = true
      menu.addItem(item)
    }
    let incognito = CommandItem("New Incognito Window", "newIncognitoWindow")
    incognito.windowless = true
    menu.addItem(incognito)
    let small = CommandItem("New Small Yahu Window", "newSmallYahu")
    small.windowless = true
    menu.addItem(small)
    return menu
  }
}
