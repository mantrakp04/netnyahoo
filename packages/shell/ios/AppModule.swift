import AppKit
import ExpoModulesCore

/// App-level system integration: updates, Handoff, sharing, Dock, app icons, notifications,
/// AppleScript and diagnostics. (Default browser and the login item are in SystemModule.)
public class AppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooApp")
    Events("onNotificationResponse", "onScriptCommand")

    OnCreate {
      DispatchQueue.main.async {
        NotificationHub.shared.install()
        AppIcons.restore()
        AppUpdater.shared.start()
      }
    }

    OnStartObserving("onNotificationResponse") {
      DispatchQueue.main.async { [weak self] in
        NotificationHub.shared.onResponse = { id, action, info in
          self?.sendEvent("onNotificationResponse", [
            "id": id, "action": action, "tabId": info["tabId"] as Any, "windowId": info["windowId"] as Any, "data": info["data"] as Any,
          ])
        }
        NotificationHub.shared.flushPending()
      }
    }

    OnStartObserving("onScriptCommand") {
      DispatchQueue.main.async { [weak self] in
        ShellScripting.send = { body in self?.sendEvent("onScriptCommand", body) }
      }
    }

    // MARK: Updates

    AsyncFunction("updaterState") { () -> [String: Any] in AppUpdater.shared.state }.runOnQueue(.main)
    AsyncFunction("checkForUpdates") { AppUpdater.shared.checkForUpdates(nil) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateChecks") { (on: Bool) in AppUpdater.shared.setAutomaticChecks(on) }.runOnQueue(.main)
    AsyncFunction("setAutomaticUpdateDownloads") { (on: Bool) in AppUpdater.shared.setAutomaticDownloads(on) }.runOnQueue(.main)

    // MARK: Handoff and sharing

    AsyncFunction("setWindowActivity") { (windowId: String, url: String?, title: String?) in
      Handoff.setActivity(windowId: windowId, url: url, title: title)
    }.runOnQueue(.main)

    AsyncFunction("share") { (url: String, title: String?, windowId: String?) in
      SharePicker.show(url: url, title: title, windowId: windowId)
    }.runOnQueue(.main)

    // MARK: Dock and app icon

    AsyncFunction("isInDock") { () -> Bool in DockTile.isInDock }.runOnQueue(.main)
    AsyncFunction("addToDock") { () -> Bool in DockTile.add() }.runOnQueue(.main)

    /// [{ id, name, preview }] — `preview` is a PNG data URL at `size` points.
    AsyncFunction("appIcons") { (size: Double) -> [[String: Any]] in
      AppIcons.variants.map { ["id": $0.id, "name": $0.name, "preview": AppIcons.preview($0.id, size: size) as Any] }
    }.runOnQueue(.main)
    AsyncFunction("appIcon") { () -> String in AppIcons.current }.runOnQueue(.main)
    AsyncFunction("setAppIcon") { (id: String) in AppIcons.set(id) }.runOnQueue(.main)

    // MARK: Notifications

    AsyncFunction("notificationPermission") { (promise: Promise) in
      NotificationHub.shared.permission { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("requestNotificationPermission") { (promise: Promise) in
      NotificationHub.shared.requestPermission { promise.resolve($0) }
    }.runOnQueue(.main)
    /// Resolves with the notification id, or null if it couldn't be delivered.
    AsyncFunction("postNotification") { (options: [String: Any], promise: Promise) in
      NotificationHub.shared.post(options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("removeNotifications") { (ids: [String]) in NotificationHub.shared.remove(ids) }.runOnQueue(.main)
    /// System Settings › Notifications › this app (after the user turned notifications off).
    AsyncFunction("openNotificationSettings") {
      let id = Bundle.main.bundleIdentifier ?? ""
      if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") {
        NSWorkspace.shared.open(url)
      }
    }.runOnQueue(.main)

    // MARK: AppleScript

    AsyncFunction("setScriptState") { (state: [String: Any]) in ShellScripting.setState(state) }.runOnQueue(.main)
    AsyncFunction("replyToScript") { (id: String, result: [String: Any]?, error: String?) in
      ShellScripting.reply(id, result: result, error: error)
    }.runOnQueue(.main)

    // MARK: Diagnostics

    /// App, OS and hardware facts for Help › Copy Diagnostics.
    Function("systemInfo") { () -> [String: Any] in
      let info = Bundle.main.infoDictionary ?? [:]
      let os = ProcessInfo.processInfo.operatingSystemVersion
      var model = [CChar](repeating: 0, count: 256)
      var size = model.count
      sysctlbyname("hw.model", &model, &size, nil, 0)
      #if DEBUG
      let configuration = "Debug"
      #else
      let configuration = "Release"
      #endif
      return [
        "appName": info["CFBundleName"] as? String ?? "Netnyahoo",
        "appVersion": info["CFBundleShortVersionString"] as? String ?? "",
        "appBuild": info["CFBundleVersion"] as? String ?? "",
        "bundleId": Bundle.main.bundleIdentifier ?? "",
        "configuration": configuration,
        "osVersion": "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
        "osBuild": Self.osBuild,
        "arch": Self.arch,
        "model": String(cString: model),
        "memoryGB": Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824,
        "locale": Locale.current.identifier,
        "updates": AppUpdater.shared.isAvailable,
        // Help › Send Feedback… destinations (Info.plist NNFeedbackURL / NNFeedbackEmail; empty = not set up).
        "feedbackURL": Self.infoString("NNFeedbackURL") as Any,
        "feedbackEmail": Self.infoString("NNFeedbackEmail") as Any,
        // Help › Video Tour (hidden while empty).
        "videoTourURL": Self.infoString("NNVideoTourURL") as Any,
      ]
    }

    /// Opens a URL with its default app (a mailto: draft in Mail…). False if nothing opened it.
    AsyncFunction("openExternalURL") { (url: String) -> Bool in
      guard let target = URL(string: url), target.scheme != nil else { return false }
      return NSWorkspace.shared.open(target)
    }.runOnQueue(.main)

    // MARK: Onboarding intro music (IntroMusic.swift)

    AsyncFunction("playIntroMusic") { (cues: [String: Double], muted: Bool) in IntroMusic.shared.play(cues: cues, muted: muted) }.runOnQueue(.main)
    AsyncFunction("setIntroMusicMuted") { (muted: Bool) in IntroMusic.shared.setMuted(muted) }.runOnQueue(.main)
    AsyncFunction("stopIntroMusic") { (fade: Double) in IntroMusic.shared.stop(fade: fade) }.runOnQueue(.main)
    /// DEV: renders the intro music to a file instead of playing it; resolves with its duration.
    AsyncFunction("devRenderIntroMusic") { (cues: [String: Double], path: String) -> Double? in
      #if DEBUG
      return IntroMusic.render(cues: cues, to: path)
      #else
      return nil
      #endif
    }

    /// DEV builds: the variable from the launch environment (e.g. NETNYAHOO_ONBOARDING).
    Function("launchEnvironment") { (name: String) -> String? in
      #if DEBUG
      return ProcessInfo.processInfo.environment[name]
      #else
      return nil
      #endif
    }

    /// DEV builds: runs AppleScript inside the app, on a background thread, to test the
    /// dictionary. Events a script sends to this app's own bundle id are self-sends: they're
    /// handled on the main thread like any other, but need no Automation consent (osascript
    /// would ask the user to allow it to control the app).
    /// DEV: sends a menu command the way the menu bar does (native → onCommand), for testing
    /// commands without the app being frontmost.
    AsyncFunction("devMenuCommand") { (command: String, arg: String?) in
      #if DEBUG
      MenuTarget.shared.handler?(command, arg, WindowManager.shared.keyWindowId)
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devSnapshotWindow") { (windowId: String, path: String, transparent: Bool?) -> Bool in
      #if DEBUG
      return Self.snapshot(windowId: windowId, path: path, transparent: transparent ?? false)
      #else
      return false
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devRunAppleScript") { (source: String, promise: Promise) in
      #if DEBUG
      // One at a time: the AppleScript component isn't safe to run on several threads at once.
      Self.scriptQueue.async {
        var error: NSDictionary?
        let result = NSAppleScript(source: source)?.executeAndReturnError(&error)
        if let error {
          promise.resolve(["ok": false, "error": error[NSAppleScript.errorMessage] as? String ?? "\(error)", "number": error[NSAppleScript.errorNumber] as Any])
        } else {
          promise.resolve(["ok": true, "result": result.map(Self.plain) as Any])
        }
      }
      #else
      promise.resolve(["ok": false, "error": "DEV builds only"])
      #endif
    }
  }

  /// A non-empty Info.plist string, or nil.
  private static func infoString(_ key: String) -> String? {
    let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return value?.isEmpty == false ? value : nil
  }

  private static let scriptQueue = DispatchQueue(label: "netnyahoo.dev-applescript")

  /// DEV: a window's layer tree drawn into a PNG (works while the screen is locked, when
  /// `screencapture` can't; Metal and blur layers come out blank).
  static func snapshot(windowId: String, path: String, transparent: Bool = false) -> Bool {
    guard let view = WindowManager.shared.windows[windowId]?.contentView, let layer = view.layer else { return false }
    let scale = view.window?.backingScaleFactor ?? 2
    let size = view.bounds.size
    guard let rep = NSBitmapImageRep(
      bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(size.height * scale), bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: rep) else { return false }
    let cg = context.cgContext
    if !transparent {
      NSGraphicsContext.saveGraphicsState()
      NSGraphicsContext.current = context
      (view.window?.backgroundColor ?? .windowBackgroundColor).setFill()
      NSRect(origin: .zero, size: CGSize(width: size.width * scale, height: size.height * scale)).fill()
      NSGraphicsContext.restoreGraphicsState()
    }
    cg.scaleBy(x: scale, y: scale)
    if view.isFlipped || layer.isGeometryFlipped {
      cg.translateBy(x: 0, y: size.height)
      cg.scaleBy(x: 1, y: -1)
    }
    layer.render(in: cg)
    guard let png = rep.representation(using: .png, properties: [:]) else { return false }
    return (try? png.write(to: URL(fileURLWithPath: path))) != nil
  }

  /// An Apple event result as JSON-friendly values (lists → arrays, records → objects).
  private static func plain(_ d: NSAppleEventDescriptor) -> Any {
    switch d.descriptorType {
    case typeAEList:
      return d.numberOfItems == 0 ? [] : (1...d.numberOfItems).compactMap { d.atIndex($0).map(plain) }
    case typeAERecord:
      var out: [String: Any] = [:]
      if d.numberOfItems > 0 {
        for i in 1...d.numberOfItems { if let item = d.atIndex(i) { out[String(format: "%08x", d.keywordForDescriptor(at: i))] = plain(item) } }
      }
      return out
    case typeTrue: return true
    case typeFalse: return false
    case typeBoolean: return d.booleanValue
    case typeSInt32, typeSInt16: return Int(d.int32Value)
    case typeNull: return NSNull()
    case typeObjectSpecifier: return "«specifier»"
    default: return d.stringValue ?? "«\(d.descriptorType)»"
    }
  }

  private static var osBuild: String {
    var size = 0
    sysctlbyname("kern.osversion", nil, &size, nil, 0)
    var build = [CChar](repeating: 0, count: max(size, 1))
    sysctlbyname("kern.osversion", &build, &size, nil, 0)
    return String(cString: build)
  }

  private static var arch: String {
    #if arch(arm64)
    "arm64"
    #else
    "x86_64"
    #endif
  }
}
