import ExpoModulesCore
import IOKit.ps

// "NetnyahooCEF" on NNCore: the same module, events and view as packages/cef/ios/CefModule.swift, so the JS
// (packages/cef/src) runs unchanged. What NNCore doesn't do yet answers the way an empty engine would (no
// downloads, no saved passwords…) and is listed in docs/nncore-parity.md.
public class CefModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooCEF")
    Events("onDownload", "onPermission", "onPermissionDismissed", "onContentBlocker", "onSystemState", "onEngineEvent", "onTabStrip")

    OnCreate {
      NNCoreEngineBridge.setEventHandler { [weak self] topic, json in self?.sendEvent("onEngineEvent", ["topic": topic, "payload": json]) }
      NNCoreTabStrip.setHandler { [weak self] tx in self?.sendEvent("onTabStrip", tx) }
      NNCoreServices.downloadsHandler = { [weak self] download in self?.sendEvent("onDownload", download) }
      NNCoreHost.eventHandler = { [weak self] name, payload in
        switch name {
        case "permission": self?.sendEvent("onPermission", payload)
        case "permissionDismissed": self?.sendEvent("onPermissionDismissed", payload)
        case "download": self?.sendEvent("onDownload", payload)
        case "contentBlocker": self?.sendEvent("onContentBlocker", payload)
        default: break
        }
      }
      SystemState.shared.onChange = { [weak self] state in self?.sendEvent("onSystemState", state) }
      SystemState.shared.start()
    }

    AsyncFunction("engineInfo") { NNCoreHost.engineInfo }.runOnQueue(.main)
    AsyncFunction("chromeWindows") { NNCoreHost.chromeWindows }.runOnQueue(.main)
    AsyncFunction("devEvents") { (browserId: Int) in NNCoreWebView.devEvents(browserId: Int32(browserId)) }.runOnQueue(.main)
    AsyncFunction("devWindowNumber") { (browserId: Int) in NNCoreWebView.devWindowNumber(browserId: Int32(browserId)) }.runOnQueue(.main)
    AsyncFunction("devWindow") { (windowNumber: Int, action: String) -> String in
      guard let window = NSApp.window(withWindowNumber: windowNumber) else { return "" }
      return NNChromeWindowHost.devAction(action, window: window) ?? ""
    }.runOnQueue(.main)
    // Apply tab transfers synchronously before either view mounts or unmounts.
    Function("prepareTransfer") { (key: String) in NNCoreWebView.prepareTransfer(key) }
    AsyncFunction("tabStripCommand") { (id: Int, command: [String: Any]) in NNCoreTabStrip.command(id, command: command) }
      .runOnQueue(.main)
    AsyncFunction("tabStrips") { NNCoreTabStrip.allStrips }.runOnQueue(.main)
    AsyncFunction("components") { (promise: Promise) in NNCoreServices.components { promise.resolve($0) } }.runOnQueue(.main)

    AsyncFunction("beginTracing") { (promise: Promise) in NNCoreHost.beginTracing { promise.resolve($0) } }.runOnQueue(.main)
    AsyncFunction("endTracing") { (keep: Bool, promise: Promise) in NNCoreHost.endTracing(keep: keep) { promise.resolve($0) } }
      .runOnQueue(.main)
    AsyncFunction("isTracing") { NNCoreHost.isTracing }.runOnQueue(.main)
    AsyncFunction("setSearchEngineName") { (name: String) in NNCoreWebView.setSearchEngineName(name) }.runOnQueue(.main)
    // NNCore keeps no navigations for later (CEF's "open:<id>"): nothing to forget.
    AsyncFunction("forgetOpenedURL") { (id: Int) in }.runOnQueue(.main)
    AsyncFunction("setDisplayMediaPicker") { (enabled: Bool) in NNCoreWebView.setDisplayMediaPicker(enabled) }.runOnQueue(.main)
    AsyncFunction("displayMediaSources") { NNCoreHost.displayMediaSources }.runOnQueue(.main)
    AsyncFunction("listTasks") { (promise: Promise) in NNCoreServices.tasks { promise.resolve($0) } }.runOnQueue(.main)
    AsyncFunction("killTask") { (id: Int64, promise: Promise) in NNCoreServices.killTask(id) { promise.resolve($0) } }.runOnQueue(.main)
    AsyncFunction("systemState") { SystemState.shared.snapshot }.runOnQueue(.main)

    AsyncFunction("cancelDownload") { (id: String) in NNCoreServices.downloadCommand("cancel", id: id) }.runOnQueue(.main)
    AsyncFunction("pauseDownload") { (id: String) in NNCoreServices.downloadCommand("pause", id: id) }.runOnQueue(.main)
    AsyncFunction("resumeDownload") { (id: String) in NNCoreServices.downloadCommand("resume", id: id) }.runOnQueue(.main)

    AsyncFunction("resolvePermission") { (id: String, result: String, remember: Bool?) in
      NNCoreHost.resolvePermission(id, result: result, remember: remember ?? false)
    }.runOnQueue(.main)
    AsyncFunction("resolveExternalApp") { (id: String, open: Bool, remember: Bool?) in
      NNCoreHost.resolveExternalApp(id, open: open, remember: remember ?? false)
    }.runOnQueue(.main)
    AsyncFunction("getExternalAppAllowances") { (profile: String, promise: Promise) in
      NNCoreServices.externalAppAllowances(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("removeExternalAppAllowance") { (profile: String, origin: String, scheme: String) in
      NNCoreServices.removeExternalAppAllowance(profile: profile, origin: origin, scheme: scheme)
    }.runOnQueue(.main)

    AsyncFunction("clearBrowsingData") { (profile: String, types: [String], since: Double?, promise: Promise) in
      NNCoreServices.clearBrowsingData(profile: profile, types: types, since: since ?? 0) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("releaseProfile") { (profile: String) in NNCoreHost.releaseProfile(profile) }.runOnQueue(.main)
    AsyncFunction("deleteProfileData") { (profile: String, promise: Promise) in
      NNCoreHost.deleteProfileData(profile) { promise.resolve(["remaining": $0]) }
    }.runOnQueue(.main)

    AsyncFunction("fetchFavicon") { (url: String, profile: String, promise: Promise) in
      NNCoreFavicons.fetch(url, profile: profile, name: nil) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("removeLegacyFavicons") { (profile: String) in }.runOnQueue(.main)
    AsyncFunction("engineCall") { (name: String, profile: String, args: String?, promise: Promise) in
      NNCoreEngineBridge.call(name, profile: profile, args: args) { promise.resolve($0) }
    }.runOnQueue(.main)

    AsyncFunction("getContentBlocker") { (promise: Promise) in
      NNCoreContentBlocker.state { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setContentBlockerEnabled") { (enabled: Bool, promise: Promise) in
      NNCoreContentBlocker.setEnabled(enabled) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("setFilterListEnabled") { (id: String, enabled: Bool, promise: Promise) in
      NNCoreContentBlocker.setList(id, enabled: enabled) { promise.resolve(nil) }
    }.runOnQueue(.main)
    AsyncFunction("isContentBlockerAllowed") { (host: String, promise: Promise) in
      NNCoreContentBlocker.isAllowed(host: host) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("setContentBlockerAllowed") { (host: String, allowed: Bool, promise: Promise) in
      NNCoreContentBlocker.setAllowed(allowed, host: host) { promise.resolve(nil) }
    }.runOnQueue(.main)

    AsyncFunction("setSiteSetting") { (profile: String, origin: String, type: String, value: String) in
      NNCoreServices.setSiteSetting(value, profile: profile, origin: origin, type: type)
    }.runOnQueue(.main)
    AsyncFunction("getSiteSettings") { (profile: String, origin: String, promise: Promise) in
      NNCoreServices.siteSettings(profile: profile, origin: origin) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getSiteSettingsOrigins") { (profile: String, promise: Promise) in
      NNCoreServices.siteSettingsOrigins(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("resetSiteSettings") { (profile: String, origin: String) in
      NNCoreServices.resetSiteSettings(profile: profile, origin: origin)
    }.runOnQueue(.main)
    AsyncFunction("clearSiteData") { (profile: String, origin: String, promise: Promise) in
      NNCoreServices.clearSiteData(profile: profile, origin: origin) { promise.resolve($0) }
    }.runOnQueue(.main)

    AsyncFunction("setZoom") { (profile: String, host: String, zoom: Double) in
      NNCoreServices.setZoom(zoom, profile: profile, host: host)
    }.runOnQueue(.main)
    AsyncFunction("getZoomLevels") { (profile: String, promise: Promise) in
      NNCoreServices.zoomLevels(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("devScrollZoom") { (steps: [[String: Any]]) in NNCoreWebView.devScrollZoom(steps) }.runOnQueue(.main)

    AsyncFunction("listPasswords") { (profile: String, promise: Promise) in
      NNCoreServices.listPasswords(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("unlockPasswords") { (profile: String, promise: Promise) in
      NNCoreServices.unlockPasswords(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getPassword") { (profile: String, origin: String, username: String, promise: Promise) in
      NNCoreServices.password(profile: profile, origin: origin, username: username) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("savePassword") { (profile: String, origin: String, username: String, password: String, promise: Promise) in
      NNCoreServices.savePassword(profile: profile, origin: origin, username: username, password: password) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("updatePassword") {
      (profile: String, origin: String, username: String, newUsername: String?, newPassword: String?, promise: Promise) in
      NNCoreServices.updatePassword(profile: profile, origin: origin, username: username, newUsername: newUsername,
                                    newPassword: newPassword) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("deletePassword") { (profile: String, origin: String, username: String, promise: Promise) in
      NNCoreServices.deletePassword(profile: profile, origin: origin, username: username) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getNeverSavePasswordOrigins") { (profile: String, promise: Promise) in
      NNCoreServices.neverSaveOrigins(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("allowSavingPasswords") { (profile: String, origin: String, promise: Promise) in
      NNCoreServices.allowSaving(profile: profile, origin: origin) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("exportPasswords") { (profile: String, promise: Promise) in
      NNCoreServices.exportPasswords(profile: profile, path: nil) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("getPasswordAutofill") { (profile: String) in
      NNCoreServices.boolPreference("credentials_enable_service", profile: profile)
    }.runOnQueue(.main)
    AsyncFunction("setPasswordAutofill") { (profile: String, enabled: Bool) in
      NNCoreServices.setBoolPreference("credentials_enable_service", value: enabled, profile: profile)
    }.runOnQueue(.main)

    AsyncFunction("getAutofillSettings") { (profile: String) in
      [
        "addresses": NNCoreServices.boolPreference("autofill.profile_enabled", profile: profile),
        "cards": NNCoreServices.boolPreference("autofill.credit_card_enabled", profile: profile),
      ]
    }.runOnQueue(.main)
    AsyncFunction("setAutofillSettings") { (profile: String, addresses: Bool?, cards: Bool?) in
      if let addresses { NNCoreServices.setBoolPreference("autofill.profile_enabled", value: addresses, profile: profile) }
      if let cards { NNCoreServices.setBoolPreference("autofill.credit_card_enabled", value: cards, profile: profile) }
    }.runOnQueue(.main)
    AsyncFunction("listAddresses") { (profile: String, promise: Promise) in
      NNCoreServices.addresses(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("saveAddress") { (profile: String, address: [String: Any], promise: Promise) in
      NNCoreServices.saveAddress(address, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("listCards") { (profile: String, promise: Promise) in
      NNCoreServices.cards(profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("saveCard") { (profile: String, card: [String: Any], number: String?, promise: Promise) in
      NNCoreServices.saveCard(card, number: number, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("deleteAutofillEntry") { (profile: String, id: String, promise: Promise) in
      NNCoreServices.deleteAutofillEntry(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("revealCardNumber") { (profile: String, id: String, promise: Promise) in
      NNCoreServices.revealCardNumber(id, profile: profile) { promise.resolve($0) }
    }.runOnQueue(.main)

    View(CefWebView.self) {
      Events(CefWebView.events)

      Prop("url") { (view: CefWebView, url: String?) in view.browser.initialURL = url }
      Prop("profile") { (view: CefWebView, profile: String?) in view.browser.profile = profile ?? "" }
      Prop("adoptId") { (view: CefWebView, id: String?) in view.browser.adoptId = id }
      Prop("transferKey") { (view: CefWebView, key: String?) in view.browser.transferKey = key }
      Prop("standalone") { (view: CefWebView, standalone: Bool?) in view.browser.standalone = standalone ?? false }
      Prop("visible") { (view: CefWebView, visible: Bool?) in view.browser.visible = visible ?? true }
      Prop("warm") { (view: CefWebView, warm: Bool?) in view.browser.warm = warm ?? false }
      Prop("pageBackgroundColor") { (view: CefWebView, color: NSColor?) in view.browser.pageBackgroundColor = color }
      Prop("autoPictureInPicture") { (view: CefWebView, enabled: Bool?) in
        view.browser.autoPictureInPicture = enabled ?? false
      }

      AsyncFunction("loadUrl") { (view: CefWebView, url: String, userInitiated: Bool?) in
        view.browser.loadURL(url, userInitiated: userInitiated ?? false)
      }.runOnQueue(.main)
      AsyncFunction("loadOpenedUrl") { (view: CefWebView, openedId: Int, url: String) in
        view.browser.loadOpenedURL(openedId, url: url)
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
      AsyncFunction("runPageCommand") { (view: CefWebView, name: String) in view.browser.runPageCommand(name) }.runOnQueue(.main)
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
      AsyncFunction("downloadFavicon") { (view: CefWebView, url: String, promise: Promise) in
        view.browser.downloadFavicon(url, name: nil) { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("downloadImage") { (view: CefWebView, url: String, maxPixels: Int, promise: Promise) in
        view.browser.downloadImage(url, maxPixels: maxPixels) { promise.resolve($0) }
      }.runOnQueue(.main)

      AsyncFunction("mediaCommand") { (view: CefWebView, action: String, seconds: Double?) in
        view.browser.mediaCommand(action, seconds: seconds ?? 0)
      }.runOnQueue(.main)
      AsyncFunction("requestPictureInPicture") { (view: CefWebView, promise: Promise) in
        view.browser.requestPictureInPicture { promise.resolve($0) }
      }.runOnQueue(.main)
      AsyncFunction("exitPictureInPicture") { (view: CefWebView) in view.browser.exitPictureInPicture() }.runOnQueue(.main)

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

final class CefWebView: ExpoView, NNCoreWebViewDelegate {
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
    "onExternalApp",
  ]

  let browser = NNCoreWebView(frame: .zero)

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
  let onExternalApp = EventDispatcher()

  private var propsReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    browser.delegate = self
    wantsLayer = true
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    browser.frame = bounds
  }

  func propsDidUpdate() {
    guard !propsReady else { return }
    propsReady = true
    browser.frame = bounds
    addSubview(browser)
  }

  deinit {
    browser.closeBrowser()
  }

  func webView(_ view: NNCoreWebView, event name: String, payload: [String: Any]) {
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
    case "externalApp": onExternalApp(payload)
    default: break
    }
  }
}

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
