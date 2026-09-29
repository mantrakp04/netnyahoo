import AppKit
import MachO
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
      let env = ProcessInfo.processInfo.environment
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
        // Help › Release Notes, and the page that opens once after an update (hidden / off while empty).
        "releaseNotesURL": Self.infoString("NNReleaseNotesURL") as Any,
        // A hidden test instance (docs/agent-brief.md): no release notes tab after an "update"…
        "isolatedInstance": env["NETNYAHOO_BACKGROUND"] == "1" || env["NETNYAHOO_DATA_DIR"] != nil,
        // …unless the test asks for it (NETNYAHOO_RELEASE_NOTES=1; apps/browser/src/lib/releaseNotesPage.ts).
        "forceReleaseNotes": env["NETNYAHOO_RELEASE_NOTES"] == "1",
        // When this process started (epoch ms), for the launch-to-first-window metric (telemetry).
        "processStart": Self.processStart as Any,
      ]
    }

    // MARK: Telemetry (apps/browser/src/telemetry; only asked while the user shares diagnostics)

    /// This install's own crash reports newer than `since` (epoch ms): the exception and the
    /// crashing thread's frames (image name, symbol, offset). No paths, no other threads.
    AsyncFunction("crashReports") { (since: Double) -> [[String: Any]] in CrashReports.since(since) }

    /// DEV: crashes the app on purpose, to test crash reporting.
    AsyncFunction("devCrash") {
      #if DEBUG
      DispatchQueue.main.async { CrashReports.crashForTesting() }
      #endif
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

    /// DEV: types `text` into the window's first responder, one key every `interval` ms, as a
    /// keyboard would (a test instance is never the key window, so real keys can't reach it).
    /// Resolves with each key's times (epoch ms): when it was due, when the main thread handled it,
    /// and when the frame showing it was committed.
    AsyncFunction("devTypeKeys") { (windowId: String, text: String, interval: Double, promise: Promise) in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId], !text.isEmpty else { return promise.resolve([]) }
      let keys = text.map(String.init)
      let now = { Date().timeIntervalSince1970 * 1000 }
      // A test instance runs in the background: keep App Nap from stretching the timer.
      let activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "devTypeKeys")
      let timer = DispatchSource.makeTimerSource(flags: .strict, queue: .main)
      var times = [[String: Double]](repeating: [:], count: keys.count)
      var next = 0, drawn = 0
      var t0 = 0.0
      let press = { (i: Int) in
        let handled = now()
        for type in [NSEvent.EventType.keyDown, .keyUp] {
          guard let event = NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, characters: keys[i], charactersIgnoringModifiers: keys[i],
            isARepeat: false, keyCode: 0) else { continue }
          if type == .keyDown { window.firstResponder?.keyDown(with: event) } else { window.firstResponder?.keyUp(with: event) }
        }
        // Core Animation commits the frame when the run loop is about to wait (order 2000000).
        let observer = CFRunLoopObserverCreateWithHandler(
          nil, CFRunLoopActivity.beforeWaiting.rawValue | CFRunLoopActivity.exit.rawValue, false, 2_000_001
        ) { _, _ in
          times[i] = ["due": t0 + interval * Double(i), "handled": handled, "drawn": now()]
          drawn += 1
          if drawn == keys.count {
            ProcessInfo.processInfo.endActivity(activity)
            promise.resolve(times)
          }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
      }
      timer.setEventHandler {
        if next == 0 { t0 = now() }
        // Keys that came due while the main thread was busy wait in line, as a keyboard's do.
        repeat {
          press(next)
          next += 1
        } while next < keys.count && t0 + interval * Double(next) <= now()
        if next == keys.count { timer.cancel() }
      }
      timer.schedule(deadline: .now(), repeating: .microseconds(Int(interval * 1000)), leeway: .nanoseconds(0))
      timer.resume()
      #else
      promise.resolve([])
      #endif
    }

    /// DEV: presses a key equivalent in a window as AppKit dispatches one (`KeyEquivalents` below);
    /// a test instance is never the key window, so real keys can't reach it.
    AsyncFunction("devKeyEquivalent") { (windowId: String, press: [String: Any], promise: Promise) in
      #if DEBUG
      KeyEquivalents.press(windowId: windowId, press) { promise.resolve($0) }
      #else
      promise.resolve(["error": "DEV builds only"])
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

extension AppModule {
  /// When this process started (epoch ms), from the kernel's process table.
  fileprivate static let processStart: Double? = {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
    let start = info.kp_proc.p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }()
}

/// Reads this app's crash reports (~/Library/Logs/DiagnosticReports/<name>-*.ips) for telemetry.
/// A report is kept only when its process was this build at this path (another copy of the app,
/// like one in /Applications, reports its own), and only the facts a crash needs leave here:
/// the exception type and signal, and the crashing thread's image names, symbols and offsets.
/// Paths, other threads, the app-specific information and the registers stay in the file.
fileprivate enum CrashReports {
  static func since(_ since: Double) -> [[String: Any]] {
    guard let executable = Bundle.main.executableURL else { return [] }
    let exe = executable.resolvingSymlinksInPath().path
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/DiagnosticReports")
    let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
    var reports: [[String: Any]] = []
    for url in files where url.pathExtension == "ips" && url.lastPathComponent.hasPrefix("\(executable.lastPathComponent)-") {
      guard let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
        modified.timeIntervalSince1970 * 1000 > since,
        let report = parse(url, executable: exe, time: modified) else { continue }
      reports.append(report)
    }
    // A crash loop shouldn't turn into a flood: the latest few are enough.
    return Array(reports.sorted { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }.suffix(5))
  }

  /// Whether a report's process was this build at this path. macOS anonymizes the path in the
  /// report (`/Users/USER/…`, `*` for folders it hides), so the path is matched as a pattern, and
  /// the binary's UUID tells this build from another copy that matches it.
  private static func isThisExecutable(procPath: String, sliceUUID: String?, executable: String) -> Bool {
    if let sliceUUID, let ours = executableUUID, sliceUUID.lowercased() != ours { return false }
    if procPath == executable { return true }
    let pattern = procPath.replacingOccurrences(of: "?", with: "\\?").replacingOccurrences(of: "/Users/USER/", with: "/Users/*/")
    return NSPredicate(format: "SELF LIKE %@", pattern).evaluate(with: executable)
  }

  /// The main executable's Mach-O UUID (a report's `slice_uuid`).
  private static let executableUUID: String? = {
    guard let header = _dyld_get_image_header(0) else { return nil }
    var command = UnsafeRawPointer(header).advanced(by: MemoryLayout<mach_header_64>.size)
    for _ in 0..<header.pointee.ncmds {
      let load = command.assumingMemoryBound(to: load_command.self).pointee
      if load.cmd == UInt32(LC_UUID) {
        return UUID(uuid: command.assumingMemoryBound(to: uuid_command.self).pointee.uuid).uuidString.lowercased()
      }
      command = command.advanced(by: Int(load.cmdsize))
    }
    return nil
  }()

  private static func parse(_ url: URL, executable: String, time: Date) -> [String: Any]? {
    // An .ips file is a JSON header line, then the JSON report.
    guard let data = try? Data(contentsOf: url), let newline = data.firstIndex(of: 0x0A),
      let header = (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...])) as? [String: Any],
      let procPath = body["procPath"] as? String,
      isThisExecutable(procPath: procPath, sliceUUID: header["slice_uuid"] as? String, executable: executable)
    else { return nil }
    let exception = body["exception"] as? [String: Any] ?? [:]
    // Image names only (never their paths, which can hold the user's name).
    let images = (body["usedImages"] as? [[String: Any]] ?? []).map { image -> String in
      if let name = image["name"] as? String, !name.isEmpty { return name }
      return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
    }
    let threads = body["threads"] as? [[String: Any]] ?? []
    let faulting = body["faultingThread"] as? Int ?? threads.firstIndex { $0["triggered"] as? Bool == true } ?? 0
    let frames = threads.indices.contains(faulting) ? threads[faulting]["frames"] as? [[String: Any]] ?? [] : []
    var report: [String: Any] = [
      "time": time.timeIntervalSince1970 * 1000,
      "frames": frames.prefix(64).map { frame -> [String: Any] in
        let index = frame["imageIndex"] as? Int ?? -1
        var out: [String: Any] = ["image": images.indices.contains(index) ? images[index] : "???"]
        if let symbol = frame["symbol"] as? String { out["symbol"] = symbol }
        if let offset = frame["imageOffset"] as? Int { out["offset"] = offset }
        return out
      },
    ]
    for (key, value) in [
      ("incidentId", header["incident_id"]), ("appVersion", header["app_version"]), ("build", header["build_version"]),
      ("exceptionType", exception["type"]), ("signal", exception["signal"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    return report
  }

  #if DEBUG
  /// DEV: a real crash with our own frame on top, for testing the reporter end to end.
  @inline(never) static func crashForTesting() {
    let pointer = UnsafeMutablePointer<Int>(bitPattern: 0x10)!
    pointer.pointee = 1
  }
  #endif
}

#if DEBUG
/// DEV: a key equivalent pressed in a window the way AppKit dispatches one (`devKeyEquivalent`):
/// the window's `performKeyEquivalent:` (in a Chrome window its CommandDispatcher: Chrome's
/// reserved commands, the views — a focused page takes the key there —, then Chrome's other
/// shortcuts), then the menu bar. The event goes through the event queue first so that it is
/// `NSApp.currentEvent` while it's handled, as a real key is.
///
/// AppKit's menu bar reads a key it didn't get from the keyboard loosely (an NSEvent made from parts:
/// ⌘S fired ⇧⌘S's item, and ⇧⌘T nothing), so while a press is handled the main menu matches keys
/// as it does the keyboard's: exact modifiers, shift in the character for printable keys.
enum KeyEquivalents {
  private static let modifierNames: [String: NSEvent.ModifierFlags] = [
    "command": .command, "shift": .shift, "option": .option, "control": .control, "function": .function,
  ]
  /// Menu items that sent their action since the press began, and the ones the menu bar found for it
  /// (with whether they were enabled).
  private static var fired: [[String: Any]] = []
  private static var matched: [[String: Any]] = []
  private static var watching = false
  /// Presses under way (the menu bar's matching and the dry handler stay swapped until the last ends).
  private static var pressing = 0, dryPressing = 0
  private static var handler: ((String, String?, String?) -> Void)?
  private static var menuKeyIMP: IMP?

  /// `press`: key (charactersIgnoringModifiers, shifted for ⇧: "T", "}"), characters (default: key),
  /// keyCode, modifiers, focus ("window": no view, as when our React Native UI has it; "page": the shown
  /// page; "devtools": docked DevTools; else as it is), asKey (the window stands in as the key window:
  /// a page takes keys, Chrome hands keys back to AppKit, and the Edit and Window menus find their
  /// target only there), wait (ms to collect what the key did: a page hands keys it doesn't use back
  /// later), settle (ms between the focus and the key), dry (the app's commands are recorded, not
  /// run, and AppKit's own items, such as Quit or Full Screen, are only looked up). Resolves with how it was handled and the menu items it fired.
  static func press(windowId: String, _ press: [String: Any], _ done: @escaping ([String: Any]) -> Void) {
    guard let window = WindowManager.shared.windows[windowId] else { return done(["error": "no window \(windowId)"]) }
    watch()
    let key = press["key"] as? String ?? ""
    let mods = NSEvent.ModifierFlags((press["modifiers"] as? [String] ?? []).compactMap { modifierNames[$0] })
    switch press["focus"] as? String {
    case "window": window.makeFirstResponder(nil)
    case "page": if let page = pageViews(in: window).first { window.makeFirstResponder(page) }
    case "devtools": if let devTools = pageViews(in: window).dropFirst().first { window.makeFirstResponder(devTools) }
    default: break
    }
    // Focus first, then the key, as a click and a key are: the page that took focus reports it.
    if let settle = press["settle"] as? Int, settle > 0 {
      var next = press
      next["settle"] = 0
      next["focus"] = nil
      return DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(settle)) {
        Self.press(windowId: windowId, next, done)
      }
    }
    guard let event = NSEvent.keyEvent(
      with: .keyDown, location: .zero, modifierFlags: mods, timestamp: ProcessInfo.processInfo.systemUptime,
      windowNumber: window.windowNumber, context: nil, characters: press["characters"] as? String ?? key,
      charactersIgnoringModifiers: key, isARepeat: false, keyCode: UInt16(press["keyCode"] as? Int ?? 0))
    else { return done(["error": "no event for \(key)"]) }
    let restoreKeyWindow = press["asKey"] as? Bool == true ? standInKeyWindow(window) : nil
    let dry = press["dry"] as? Bool == true
    begin(dry: dry)
    fired = []
    matched = []
    NSApp.postEvent(event, atStart: true)
    let current = NSApp.nextEvent(matching: .keyDown, until: .distantPast, inMode: .default, dequeue: true) ?? event
    var result: [String: Any] = ["firstResponder": window.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"]
    if !window.isKeyWindow, let page = window.firstResponder, String(describing: type(of: page)) == "RenderWidgetHostViewCocoa" {
      // A page takes key equivalents only in the key window (RenderWidgetHostViewCocoa
      // performKeyEquivalent:); past that check it sends the key on to the page like this. Keys the
      // page leaves come back to the app (CEF's keyboard handler, packages/cef NNClient) later.
      let selector = NSSelectorFromString("keyEvent:wasKeyEquivalent:")
      typealias KeyEvent = @convention(c) (AnyObject, Selector, NSEvent, ObjCBool) -> Void
      unsafeBitCast(page.method(for: selector), to: KeyEvent.self)(page, selector, current, true)
      result["handledBy"] = "page"
    } else if window.performKeyEquivalent(with: current) {
      result["handledBy"] = "window"
    } else if dry, let (item, _) = menuItem(for: current), !(item is CommandItem) {
      // The menu bar would get it: AppKit's own items (Quit, Minimize, Full Screen, Copy…) aren't run.
      result["handledBy"] = "menu"
      fired = [describe(item).merging(["dry": true]) { a, _ in a }]
    } else if NSApp.mainMenu?.performKeyEquivalent(with: current) == true {
      result["handledBy"] = "menu"
    } else {
      result["handledBy"] = "none"
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(press["wait"] as? Int ?? 250)) {
      restoreKeyWindow?()
      end(dry: dry)
      result["fired"] = fired
      result["matched"] = matched
      done(result)
    }
  }

  private static func begin(dry: Bool) {
    if pressing == 0, let method = class_getInstanceMethod(NSMenu.self, #selector(NSMenu.performKeyEquivalent(with:))) {
      let original = method_getImplementation(method)
      menuKeyIMP = original
      typealias PerformKey = @convention(c) (NSMenu, Selector, NSEvent) -> Bool
      let block: @convention(block) (NSMenu, NSEvent) -> Bool = { menu, event in
        guard menu === NSApp.mainMenu else {
          return unsafeBitCast(original, to: PerformKey.self)(menu, #selector(NSMenu.performKeyEquivalent(with:)), event)
        }
        guard let (item, parent) = menuItem(for: event) else { return false }
        parent.update()
        matched.append(describe(item).merging(["enabled": item.isEnabled]) { a, _ in a })
        guard item.isEnabled else { return false }
        parent.performActionForItem(at: parent.index(of: item))
        return true
      }
      method_setImplementation(method, imp_implementationWithBlock(block))
    }
    pressing += 1
    if dry {
      if dryPressing == 0 { handler = MenuTarget.shared.handler }
      dryPressing += 1
      MenuTarget.shared.handler = { _, _, _ in }
    }
  }

  private static func end(dry: Bool) {
    if dry {
      dryPressing -= 1
      if dryPressing == 0 { MenuTarget.shared.handler = handler }
    }
    pressing -= 1
    if pressing == 0, let imp = menuKeyIMP, let method = class_getInstanceMethod(NSMenu.self, #selector(NSMenu.performKeyEquivalent(with:))) {
      method_setImplementation(method, imp)
    }
  }

  /// The menu item (and its menu) a keyboard's key fires, first in menu order: its character and
  /// exact modifiers (shift in the character for printable keys, as "}" for ⇧⌘], or in the modifiers
  /// for letters and function keys).
  private static func menuItem(for event: NSEvent, in menu: NSMenu? = NSApp.mainMenu) -> (NSMenuItem, NSMenu)? {
    guard let menu else { return nil }
    let relevant: NSEvent.ModifierFlags = [.command, .shift, .option, .control, .function]
    var key = event.charactersIgnoringModifiers ?? ""
    if key == "\u{7f}" { key = "\u{8}" }  // ⌫, a menu's NSBackspaceCharacter
    if key == "\u{19}" { key = "\t" }  // ⇧⇥
    let functionKey = key.unicodeScalars.first.map { (0xF700...0xF8FF).contains($0.value) } ?? false
    var mods = event.modifierFlags.intersection(relevant)
    if functionKey { mods.remove(.function) }
    for item in menu.items {
      if let submenu = item.submenu, submenu !== NSApp.servicesMenu, let found = menuItem(for: event, in: submenu) { return found }
      guard !item.keyEquivalent.isEmpty, !item.isHidden || item.allowsKeyEquivalentWhenHidden,
            item.keyEquivalent.lowercased() == key.lowercased() else { continue }
      let itemMods = item.keyEquivalentModifierMask.intersection(relevant)
        .union(item.keyEquivalent != item.keyEquivalent.lowercased() ? .shift : [])
      let printable = key.unicodeScalars.first.map { $0.value >= 0x20 && $0.value != 0x7f } ?? false
      let shiftedSymbol = printable && key.lowercased() == key.uppercased() && !functionKey
      if itemMods == mods || (shiftedSymbol && itemMods.union(.shift) == mods) { return (item, menu) }
    }
    return nil
  }

  private static func watch() {
    guard !watching else { return }
    watching = true
    NotificationCenter.default.addObserver(forName: NSMenu.willSendActionNotification, object: nil, queue: nil) { note in
      guard let item = note.userInfo?["MenuItem"] as? NSMenuItem else { return }
      fired.append(describe(item))
    }
  }

  private static func describe(_ item: NSMenuItem) -> [String: Any] {
    var entry: [String: Any] = ["title": item.title, "action": item.action.map(NSStringFromSelector) ?? ""]
    if let command = item as? CommandItem {
      entry["command"] = command.command
      if let arg = command.arg { entry["arg"] = arg }
    }
    return entry
  }

  /// `window` is the key window (NSApp.keyWindow, isKeyWindow) until the returned function runs: a
  /// background app has none, and a page takes keys, and Chrome passes keys back, only in the key window.
  private static func standInKeyWindow(_ window: NSWindow) -> () -> Void {
    guard let appKey = class_getInstanceMethod(NSApplication.self, #selector(getter: NSApplication.keyWindow)),
          let isKey = class_getInstanceMethod(NSWindow.self, #selector(getter: NSWindow.isKeyWindow))
    else { return {} }
    let appKeyIMP = method_getImplementation(appKey), isKeyIMP = method_getImplementation(isKey)
    typealias IsKey = @convention(c) (NSWindow, Selector) -> Bool
    let originalIsKey = unsafeBitCast(isKeyIMP, to: IsKey.self)
    let appKeyBlock: @convention(block) (NSApplication) -> NSWindow? = { _ in window }
    let isKeyBlock: @convention(block) (NSWindow) -> Bool = { $0 === window || originalIsKey($0, #selector(getter: NSWindow.isKeyWindow)) }
    method_setImplementation(appKey, imp_implementationWithBlock(appKeyBlock))
    method_setImplementation(isKey, imp_implementationWithBlock(isKeyBlock))
    return {
      method_setImplementation(appKey, appKeyIMP)
      method_setImplementation(isKey, isKeyIMP)
    }
  }

  /// The window's shown web contents, largest first (the page, then docked DevTools).
  private static func pageViews(in window: NSWindow) -> [NSView] {
    var views: [NSView] = []
    func walk(_ view: NSView) {
      // Tabs kept warm behind the shown one are transparent, not hidden.
      guard !view.isHidden, view.alphaValue > 0 else { return }
      if String(describing: type(of: view)) == "RenderWidgetHostViewCocoa", !view.visibleRect.isEmpty { views.append(view) }
      view.subviews.forEach(walk)
    }
    window.contentView.map(walk)
    let area = { (v: NSView) in v.visibleRect.width * v.visibleRect.height }
    return views.sorted { area($0) > area($1) }
  }
}
#endif
