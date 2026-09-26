import ExpoModulesCore
import IOKit.ps

public class CefModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooCEF")
    Events("onDownload", "onPermission", "onPermissionDismissed", "onContentBlocker", "onSystemState")

    OnCreate {
      NNCef.eventHandler = { [weak self] name, payload in
        switch name {
        case "download": self?.sendEvent("onDownload", payload)
        case "permission": self?.sendEvent("onPermission", payload)
        case "permissionDismissed": self?.sendEvent("onPermissionDismissed", payload)
        case "contentBlocker": self?.sendEvent("onContentBlocker", payload)
        default: break
        }
      }
      SystemState.shared.onChange = { [weak self] state in self?.sendEvent("onSystemState", state) }
      SystemState.shared.start()
    }

    // Engine
    AsyncFunction("engineInfo") { NNCef.engineInfo }.runOnQueue(.main)
    AsyncFunction("chromeWindows") { NNCef.chromeWindows }.runOnQueue(.main)
    AsyncFunction("devWindow") { (windowNumber: Int, action: String) in NNCef.devWindow(windowNumber, action: action) }
      .runOnQueue(.main)
    // Synchronous: it must land before the moved tab's views mount and unmount.
    Function("prepareTransfer") { (key: String) in NNBrowserView.prepareTransfer(key) }
    AsyncFunction("components") { NNCef.components }.runOnQueue(.main)

    // Diagnostics
    AsyncFunction("beginTracing") { (promise: Promise) in
      NNCef.beginTracing { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("endTracing") { (keep: Bool, promise: Promise) in
      NNCef.endTracing(keep: keep) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("isTracing") { NNCef.isTracing }.runOnQueue(.main)
    AsyncFunction("setSearchEngineName") { (name: String) in NNCef.searchEngineName = name }.runOnQueue(.main)
    AsyncFunction("setDisplayMediaPicker") { (enabled: Bool) in NNCef.displayMediaPicker = enabled }.runOnQueue(.main)
    AsyncFunction("displayMediaSources") { NNCef.displayMediaSources }.runOnQueue(.main)
    AsyncFunction("listTasks") { NNCef.tasks }.runOnQueue(.main)
    AsyncFunction("killTask") { (id: Int64) in NNCef.killTask(id) }.runOnQueue(.main)
    AsyncFunction("systemState") { SystemState.shared.snapshot }.runOnQueue(.main)

    // Downloads
    AsyncFunction("cancelDownload") { (id: String) in NNCef.cancelDownload(id) }.runOnQueue(.main)
    AsyncFunction("pauseDownload") { (id: String) in NNCef.pauseDownload(id) }.runOnQueue(.main)
    AsyncFunction("resumeDownload") { (id: String) in NNCef.resumeDownload(id) }.runOnQueue(.main)

    // Permissions
    AsyncFunction("resolvePermission") { (id: String, result: String, remember: Bool?) in
      NNCef.resolvePermission(id, result: result, remember: remember ?? false)
    }.runOnQueue(.main)

    // Profiles
    AsyncFunction("clearBrowsingData") { (profile: String, types: [String], since: Double?, promise: Promise) in
      NNCef.clearBrowsingData(profile: profile, types: types, since: since ?? 0) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("releaseProfile") { (profile: String) in NNCef.releaseProfile(profile) }.runOnQueue(.main)
    AsyncFunction("deleteProfileData") { (profile: String) in
      guard !profile.isEmpty, !profile.hasPrefix("incognito") else { return }
      NNCef.releaseProfile(profile)
      let path = (NNCef.rootCachePath as NSString).appendingPathComponent("Profile \(profile)")
      try? FileManager.default.removeItem(atPath: path)
    }.runOnQueue(.main)

    // Favicons
    AsyncFunction("fetchFavicon") { (url: String, profile: String, name: String?, promise: Promise) in
      NNFavicons.fetch(url, profile: profile, name: name) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("pruneFavicons") { (profile: String, keep: [String]) in
      NNFavicons.prune(profile: profile, keeping: keep)
    }.runOnQueue(.main)

    // Content blocking (uBlock Origin Lite)
    AsyncFunction("getContentBlocker") { (promise: Promise) in
      NNContentBlocker.state { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setContentBlockerEnabled") { (enabled: Bool, promise: Promise) in
      NNContentBlocker.setEnabled(enabled) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("setFilterListEnabled") { (id: String, enabled: Bool, promise: Promise) in
      NNContentBlocker.setList(id, enabled: enabled) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("isContentBlockerAllowed") { (host: String, promise: Promise) in
      NNContentBlocker.isAllowed(host: host) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setContentBlockerAllowed") { (host: String, allowed: Bool, promise: Promise) in
      NNContentBlocker.setAllowed(allowed, host: host) { promise.resolve(nil) }
    }.runOnQueue(.main)

    // Site settings
    AsyncFunction("getSiteSetting") { (profile: String, origin: String, type: String) in
      NNSiteSettings.setting(profile: profile, origin: origin, type: type)
    }.runOnQueue(.main)
    AsyncFunction("setSiteSetting") { (profile: String, origin: String, type: String, value: String) in
      NNSiteSettings.setSetting(value, profile: profile, origin: origin, type: type)
    }.runOnQueue(.main)
    AsyncFunction("getSiteSettings") { (profile: String, origin: String) in
      NNSiteSettings.settings(profile: profile, origin: origin)
    }.runOnQueue(.main)
    AsyncFunction("getSiteSettingsOrigins") { (profile: String) in NNSiteSettings.origins(profile: profile) }.runOnQueue(.main)
    AsyncFunction("resetSiteSettings") { (profile: String, origin: String) in
      NNSiteSettings.reset(origin: origin, profile: profile)
    }.runOnQueue(.main)
    AsyncFunction("clearSiteData") { (profile: String, origin: String, promise: Promise) in
      NNSiteSettings.clearSiteData(profile: profile, origin: origin) { promise.resolve($0) }
    }.runOnQueue(.main)

    // Zoom
    AsyncFunction("setZoom") { (profile: String, host: String, zoom: Double) in
      NNZoom.setZoom(zoom, profile: profile, host: host)
    }.runOnQueue(.main)
    AsyncFunction("getZoomLevels") { (profile: String) in NNZoom.zoomLevels(profile: profile) }.runOnQueue(.main)

    // Passwords (Chrome's password manager)
    AsyncFunction("listPasswords") { (profile: String, promise: Promise) in
      NNPasswords.list(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("unlockPasswords") { (profile: String, promise: Promise) in
      NNPasswords.unlock(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getPassword") { (profile: String, origin: String, username: String, promise: Promise) in
      NNPasswords.password(profile: profile, origin: origin, username: username) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("savePassword") { (profile: String, origin: String, username: String, password: String, promise: Promise) in
      NNPasswords.save(profile: profile, origin: origin, username: username, password: password) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("updatePassword") {
      (profile: String, origin: String, username: String, newUsername: String?, newPassword: String?, promise: Promise) in
      NNPasswords.update(profile: profile, origin: origin, username: username, newUsername: newUsername,
                         newPassword: newPassword) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("deletePassword") { (profile: String, origin: String, username: String, promise: Promise) in
      NNPasswords.delete(profile: profile, origin: origin, username: username) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getNeverSavePasswordOrigins") { (profile: String, promise: Promise) in
      NNPasswords.neverSaveOrigins(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("allowSavingPasswords") { (profile: String, origin: String, promise: Promise) in
      NNPasswords.allowSaving(profile: profile, origin: origin) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getPasswordAutofill") { (profile: String) in NNPasswords.autofillEnabled(profile: profile) }.runOnQueue(.main)
    AsyncFunction("setPasswordAutofill") { (profile: String, enabled: Bool) in
      NNPasswords.setAutofillEnabled(enabled, profile: profile)
    }.runOnQueue(.main)

    // Autofill (Chrome's addresses and cards)
    AsyncFunction("getAutofillSettings") { (profile: String) in NNAutofill.settings(profile: profile) }.runOnQueue(.main)
    AsyncFunction("setAutofillSettings") { (profile: String, addresses: Bool?, cards: Bool?) in
      var settings: [String: NSNumber] = [:]
      if let addresses { settings["addresses"] = NSNumber(value: addresses) }
      if let cards { settings["cards"] = NSNumber(value: cards) }
      NNAutofill.setSettings(settings, profile: profile)
    }.runOnQueue(.main)
    AsyncFunction("listAddresses") { (profile: String, promise: Promise) in
      NNAutofill.addresses(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("saveAddress") { (profile: String, address: [String: Any], promise: Promise) in
      NNAutofill.saveAddress(address, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("listCards") { (profile: String, promise: Promise) in
      NNAutofill.cards(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("saveCard") { (profile: String, card: [String: Any], number: String?, promise: Promise) in
      NNAutofill.saveCard(card, number: number, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("deleteAutofillEntry") { (profile: String, id: String, promise: Promise) in
      NNAutofill.deleteEntry(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("revealCardNumber") { (profile: String, id: String, promise: Promise) in
      NNAutofill.revealCardNumber(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)

    View(CefWebView.self) {
      Events(CefWebView.events)

      Prop("url") { (view: CefWebView, url: String?) in view.browser.initialURL = url }
      Prop("profile") { (view: CefWebView, profile: String?) in view.browser.profile = profile ?? "" }
      Prop("adoptId") { (view: CefWebView, id: String?) in view.browser.adoptId = id }
      Prop("transferKey") { (view: CefWebView, key: String?) in view.browser.transferKey = key }
      Prop("standalone") { (view: CefWebView, standalone: Bool?) in view.browser.standalone = standalone ?? false }
      Prop("visible") { (view: CefWebView, visible: Bool?) in view.browser.visible = visible ?? true }
      Prop("pageBackgroundColor") { (view: CefWebView, color: NSColor?) in view.browser.pageBackgroundColor = color }
      Prop("autoPictureInPicture") { (view: CefWebView, enabled: Bool?) in
        view.browser.autoPictureInPicture = enabled ?? false
      }

      AsyncFunction("loadUrl") { (view: CefWebView, url: String, userInitiated: Bool?) in
        view.browser.loadURL(url, userInitiated: userInitiated ?? false)
      }.runOnQueue(.main)
      AsyncFunction("goBack") { (view: CefWebView) in view.browser.goBack() }.runOnQueue(.main)
      AsyncFunction("goForward") { (view: CefWebView) in view.browser.goForward() }.runOnQueue(.main)
      AsyncFunction("goToOffset") { (view: CefWebView, offset: Int) in view.browser.go(toHistoryOffset: offset) }.runOnQueue(.main)
      AsyncFunction("reload") { (view: CefWebView) in view.browser.reload() }.runOnQueue(.main)
      AsyncFunction("forceReload") { (view: CefWebView) in view.browser.reloadIgnoringCache() }.runOnQueue(.main)
      AsyncFunction("stopLoading") { (view: CefWebView) in view.browser.stopLoading() }.runOnQueue(.main)
      AsyncFunction("focus") { (view: CefWebView) in view.browser.focusPage() }.runOnQueue(.main)
      AsyncFunction("setMuted") { (view: CefWebView, muted: Bool) in view.browser.setMuted(muted) }.runOnQueue(.main)
      AsyncFunction("zoomStep") { (view: CefWebView, direction: Int) in view.browser.zoomStep(direction) }.runOnQueue(.main)
      AsyncFunction("find") { (view: CefWebView, text: String, forward: Bool, findNext: Bool) in
        view.browser.find(text, forward: forward, findNext: findNext)
      }.runOnQueue(.main)
      AsyncFunction("stopFinding") { (view: CefWebView, clear: Bool) in view.browser.stopFinding(clear) }.runOnQueue(.main)
      AsyncFunction("print") { (view: CefWebView) in view.browser.print() }.runOnQueue(.main)
      AsyncFunction("showDevTools") { (view: CefWebView, panel: String?) in view.browser.showDevTools(panel: panel) }
        .runOnQueue(.main)
      AsyncFunction("executeJavaScript") { (view: CefWebView, code: String) in
        view.browser.executeJavaScript(code)
      }.runOnQueue(.main)
      AsyncFunction("evaluate") { (view: CefWebView, code: String, promise: Promise) in
        view.browser.evaluate(code) { json in promise.resolve(json) }
      }.runOnQueue(.main)
      AsyncFunction("navigationEntries") { (view: CefWebView, promise: Promise) in
        view.browser.navigationEntries { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadFavicon") { (view: CefWebView, url: String, name: String?, promise: Promise) in
        view.browser.downloadFavicon(url, name: name) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadImage") { (view: CefWebView, url: String, maxPixels: Int, promise: Promise) in
        view.browser.downloadImage(url, maxPixels: maxPixels) { promise.resolve($0) }
      }.runOnQueue(.main)

      // Media
      AsyncFunction("mediaCommand") { (view: CefWebView, action: String, seconds: Double?) in
        view.browser.mediaCommand(action, seconds: seconds ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("requestPictureInPicture") { (view: CefWebView, promise: Promise) in
        view.browser.requestPictureInPicture { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("exitPictureInPicture") { (view: CefWebView) in view.browser.exitPictureInPicture() }.runOnQueue(.main)

      // Site controls
      AsyncFunction("getSecurityInfo") { (view: CefWebView, promise: Promise) in
        view.browser.securityInfo { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("openBlockedPopup") { (view: CefWebView, id: String, always: Bool?) in
        view.browser.openBlockedPopup(id, always: always ?? false)
      }.runOnQueue(.main)
      AsyncFunction("clearSiteData") { (view: CefWebView, promise: Promise) in
        view.browser.clearSiteData { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("resolvePasswordPrompt") { (view: CefWebView, action: String, username: String?, password: String?) in
        view.browser.resolvePasswordPrompt(action, username: username, password: password)
      }.runOnQueue(.main)
      AsyncFunction("setTabStrip") { (view: CefWebView, index: Int, pinned: Bool) in
        view.browser.setTabStrip(index: index, pinned: pinned)
      }.runOnQueue(.main)
      AsyncFunction("executeExtensionAction") { (view: CefWebView, extensionId: String) in
        view.browser.executeExtensionAction(extensionId)
      }.runOnQueue(.main)

      AsyncFunction("resolveDisplayMedia") { (view: CefWebView, id: String, sourceId: String?) in
        view.browser.resolveDisplayMedia(id, sourceId: sourceId)
      }.runOnQueue(.main)
      AsyncFunction("mediaCaptureSourceId") { (view: CefWebView) in view.browser.mediaCaptureSourceId }.runOnQueue(.main)
      AsyncFunction("notificationAction") { (view: CefWebView, id: String, action: String) in
        view.browser.notificationAction(id, action: action)
      }.runOnQueue(.main)

      // Robustness
      AsyncFunction("resolveUnresponsive") { (view: CefWebView, terminate: Bool) in
        view.browser.resolveUnresponsive(terminate: terminate)
      }.runOnQueue(.main)
      AsyncFunction("discard") { (view: CefWebView, unload: Bool?) in view.browser.discard(unload: unload ?? false) }
        .runOnQueue(.main)
      AsyncFunction("setFrozen") { (view: CefWebView, frozen: Bool) in view.browser.frozen = frozen }.runOnQueue(.main)

      OnViewDidUpdateProps { (view: CefWebView) in view.propsDidUpdate() }
    }
  }
}

/// Hosts one NNBrowserView and forwards its events as Expo view events.
final class CefWebView: ExpoView, NNBrowserViewDelegate {
  static let events = [
    "onNavigationChange",
    "onProgress",
    "onFavicon",
    "onMedia",
    "onNowPlaying",
    "onMediaAccess",
    "onOpenWindow",
    "onPopupBlocked",
    "onFindResult",
    "onFullscreen",
    "onStatus",
    "onCrashed",
    "onUnresponsive",
    "onResponsive",
    "onLoadError",
    "onSecurity",
    "onZoom",
    "onContentBlocked",
    "onDownloadNavigation",
    "onNotification",
    "onNotificationClose",
    "onPictureInPicture",
    "onActivateRequest",
    "onDisplayMediaRequest",
    "onWindowClose",
    "onCommand",
    "onPageFocus",
    "onPageMessage",
    "onReady",
    "onDiscarded",
    "onPasswordPrompt",
    "onTabStrip",
  ]

  let browser = NNBrowserView(frame: .zero)

  // Expo finds dispatchers by property name, so each event needs one.
  let onNavigationChange = EventDispatcher()
  let onProgress = EventDispatcher()
  let onFavicon = EventDispatcher()
  let onMedia = EventDispatcher()
  let onNowPlaying = EventDispatcher()
  let onMediaAccess = EventDispatcher()
  let onOpenWindow = EventDispatcher()
  let onPopupBlocked = EventDispatcher()
  let onFindResult = EventDispatcher()
  let onFullscreen = EventDispatcher()
  let onStatus = EventDispatcher()
  let onCrashed = EventDispatcher()
  let onUnresponsive = EventDispatcher()
  let onResponsive = EventDispatcher()
  let onLoadError = EventDispatcher()
  let onSecurity = EventDispatcher()
  let onZoom = EventDispatcher()
  let onContentBlocked = EventDispatcher()
  let onDownloadNavigation = EventDispatcher()
  let onNotification = EventDispatcher()
  let onNotificationClose = EventDispatcher()
  let onPictureInPicture = EventDispatcher()
  let onActivateRequest = EventDispatcher()
  let onDisplayMediaRequest = EventDispatcher()
  let onWindowClose = EventDispatcher()
  let onCommand = EventDispatcher()
  let onPageFocus = EventDispatcher()
  let onPageMessage = EventDispatcher()
  let onReady = EventDispatcher()
  let onDiscarded = EventDispatcher()
  let onPasswordPrompt = EventDispatcher()
  let onTabStrip = EventDispatcher()

  private var propsReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    browser.delegate = self
    wantsLayer = true
  }

  // RN macOS assigns frames directly and doesn't autoresize subviews.
  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    browser.frame = bounds
  }

  /// The browser is created when NNBrowserView joins a window, so it's only
  /// added once the initial props (profile, url, adoptId) have arrived.
  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    browser.frame = bounds
    addSubview(browser)
  }

  deinit {
    browser.closeBrowser()
  }

  func browserView(_ view: NNBrowserView, event name: String, payload: [String: Any]) {
    switch name {
    case "navigation": onNavigationChange(payload)
    case "progress": onProgress(payload)
    case "favicon": onFavicon(payload)
    case "media": onMedia(payload)
    case "nowPlaying": onNowPlaying(payload)
    case "mediaAccess": onMediaAccess(payload)
    case "openWindow": onOpenWindow(payload)
    case "popupBlocked": onPopupBlocked(payload)
    case "find": onFindResult(payload)
    case "fullscreen": onFullscreen(payload)
    case "status": onStatus(payload)
    case "crashed": onCrashed(payload)
    case "unresponsive": onUnresponsive(payload)
    case "responsive": onResponsive(payload)
    case "loadError": onLoadError(payload)
    case "security": onSecurity(payload)
    case "zoom": onZoom(payload)
    case "contentBlocked": onContentBlocked(payload)
    case "downloadNavigation": onDownloadNavigation(payload)
    case "notification": onNotification(payload)
    case "notificationClose": onNotificationClose(payload)
    case "pictureInPicture": onPictureInPicture(payload)
    case "activateRequest": onActivateRequest(payload)
    case "displayMediaRequest": onDisplayMediaRequest(payload)
    case "windowClose": onWindowClose(payload)
    case "command": onCommand(payload)
    case "focus": onPageFocus(payload)
    case "pageMessage": onPageMessage(payload)
    case "ready": onReady(payload)
    case "discarded": onDiscarded(payload)
    case "passwordPrompt": onPasswordPrompt(payload)
    case "tabStrip": onTabStrip(payload)
    default: break
    }
  }
}

/// Power source, Low Power Mode, memory pressure and RAM: what the app's tab
/// lifecycle policy (sleeping tabs, Battery Saver) decides by.
final class SystemState {
  static let shared = SystemState()
  var onChange: (([String: Any]) -> Void)?
  private var memoryPressure = "normal"
  private var memorySource: DispatchSourceMemoryPressure?
  private var powerSource: CFRunLoopSource?
  private var lowPowerObserver: NSObjectProtocol?

  var snapshot: [String: Any] {
    let battery = SystemState.battery()
    return [
      "onBattery": battery.onBattery,
      "batteryLevel": battery.level as Any,
      "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled,
      "memoryPressure": memoryPressure,
      "physicalMemory": Double(ProcessInfo.processInfo.physicalMemory),
    ]
  }

  func start() {
    guard memorySource == nil else { return }
    let source = DispatchSource.makeMemoryPressureSource(eventMask: [.normal, .warning, .critical], queue: .main)
    source.setEventHandler { [weak self, weak source] in
      guard let self, let event = source?.data else { return }
      self.memoryPressure = event.contains(.critical) ? "critical" : event.contains(.warning) ? "warning" : "normal"
      self.changed()
    }
    source.resume()
    memorySource = source

    let context = Unmanaged.passUnretained(self).toOpaque()
    if let loop = IOPSNotificationCreateRunLoopSource({ context in
      guard let context else { return }
      Unmanaged<SystemState>.fromOpaque(context).takeUnretainedValue().changed()
    }, context)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), loop, .defaultMode)
      powerSource = loop
    }
    lowPowerObserver = NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.changed() }
  }

  private func changed() {
    let state = snapshot
    if Thread.isMainThread { onChange?(state) } else { DispatchQueue.main.async { self.onChange?(state) } }
  }

  /// Whether the Mac runs on its battery now, and the charge (0–1) if it has one.
  private static func battery() -> (onBattery: Bool, level: Double?) {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return (false, nil) }
    let providing = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?
    var level: Double?
    let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] ?? []
    for source in sources {
      guard let description = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any],
        description[kIOPSTypeKey] as? String == kIOPSInternalBatteryType,
        let current = description[kIOPSCurrentCapacityKey] as? Double,
        let max = description[kIOPSMaxCapacityKey] as? Double, max > 0
      else { continue }
      level = current / max
    }
    return (providing == kIOPMBatteryPowerKey, level)
  }
}
