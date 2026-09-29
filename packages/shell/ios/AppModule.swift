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
