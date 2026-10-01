import AppKit
import MachO
import ExpoModulesCore

public class AppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetnyahooApp")
    // The JS/native contract: NATIVE_API_VERSION in apps/browser/src/nativeApi.tsx, which a JS bundle checks before it
    // loads the app. Bump both together whenever JS starts needing native code that older builds lack.
    Constant("apiVersion") { () -> Int in 4 }
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
    AsyncFunction("postNotification") { (options: [String: Any], promise: Promise) in
      NotificationHub.shared.post(options) { promise.resolve($0) }
    }.runOnQueue(.main)
    AsyncFunction("removeNotifications") { (ids: [String]) in NotificationHub.shared.remove(ids) }.runOnQueue(.main)
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
        "feedbackURL": Self.infoString("NNFeedbackURL") as Any,
        "feedbackEmail": Self.infoString("NNFeedbackEmail") as Any,
        "videoTourURL": Self.infoString("NNVideoTourURL") as Any,
        "releaseNotesURL": Self.infoString("NNReleaseNotesURL") as Any,
        "isolatedInstance": env["NETNYAHOO_BACKGROUND"] == "1" || env["NETNYAHOO_DATA_DIR"] != nil,
        "forceReleaseNotes": env["NETNYAHOO_RELEASE_NOTES"] == "1",
        "processStart": Self.processStart as Any,
        "inApplicationsFolder": Self.inApplicationsFolder,
      ]
    }

    // MARK: Telemetry (apps/browser/src/telemetry; only asked while the user shares diagnostics)

    /// Telemetry includes only the exception, the NSException's name and throw site, and the crashing thread;
    /// never paths, reasons or unrelated threads.
    AsyncFunction("crashReports") { (since: Double) -> [[String: Any]] in CrashReports.since(since) }

    AsyncFunction("devCrash") { (kind: String?) in
      #if DEBUG
      DispatchQueue.main.async { CrashReports.crashForTesting(kind) }
      #endif
    }

    AsyncFunction("openExternalURL") { (url: String) -> Bool in
      guard let target = URL(string: url), target.scheme != nil else { return false }
      return NSWorkspace.shared.open(target)
    }.runOnQueue(.main)

    // MARK: Onboarding intro music (IntroMusic.swift)

    AsyncFunction("playIntroMusic") { (cues: [String: Double], muted: Bool) in IntroMusic.shared.play(cues: cues, muted: muted) }.runOnQueue(.main)
    AsyncFunction("setIntroMusicMuted") { (muted: Bool) in IntroMusic.shared.setMuted(muted) }.runOnQueue(.main)
    AsyncFunction("stopIntroMusic") { (fade: Double) in IntroMusic.shared.stop(fade: fade) }.runOnQueue(.main)
    AsyncFunction("devRenderIntroMusic") { (cues: [String: Double], path: String) -> Double? in
      #if DEBUG
      return IntroMusic.render(cues: cues, to: path)
      #else
      return nil
      #endif
    }

    Function("launchEnvironment") { (name: String) -> String? in
      #if DEBUG
      return ProcessInfo.processInfo.environment[name]
      #else
      return nil
      #endif
    }

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

    AsyncFunction("devTypeKeys") { (windowId: String, text: String, interval: Double, promise: Promise) in
      #if DEBUG
      guard let window = WindowManager.shared.windows[windowId], !text.isEmpty else { return promise.resolve([]) }
      let keys = text.map(String.init)
      let now = { Date().timeIntervalSince1970 * 1000 }
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

    AsyncFunction("devKeyEquivalent") { (windowId: String, press: [String: Any], promise: Promise) in
      #if DEBUG
      KeyEquivalents.press(windowId: windowId, press) { promise.resolve($0) }
      #else
      promise.resolve(["error": "DEV builds only"])
      #endif
    }.runOnQueue(.main)

    AsyncFunction("devRunAppleScript") { (source: String, promise: Promise) in
      #if DEBUG
      // Serialize AppleScript access; its component is not thread-safe.
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

  private static func infoString(_ key: String) -> String? {
    let value = (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return value?.isEmpty == false ? value : nil
  }

  private static let scriptQueue = DispatchQueue(label: "netnyahoo.dev-applescript")

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

  // 1Password's browser helper is sandboxed to read apps in /Applications and ~/Applications; from Downloads,
  // the disk image or Documents it can't check our signature and refuses us. Its Add Browser wants Applications too.
  private static var inApplicationsFolder: Bool {
    let path = Bundle.main.bundleURL.resolvingSymlinksInPath().path
    let home = FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path
    return path.hasPrefix("/Applications/") || path.hasPrefix(home + "/Applications/")
  }
}

extension AppModule {
  fileprivate static let processStart: Double? = {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
    let start = info.kp_proc.p_starttime
    return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
  }()
}

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
    return Array(reports.sorted { ($0["time"] as? Double ?? 0) < ($1["time"] as? Double ?? 0) }.suffix(5))
  }

  private static func isThisExecutable(procPath: String, sliceUUID: String?, executable: String) -> Bool {
    if let sliceUUID, let ours = executableUUID, sliceUUID.lowercased() != ours { return false }
    if procPath == executable { return true }
    let pattern = procPath.replacingOccurrences(of: "?", with: "\\?").replacingOccurrences(of: "/Users/USER/", with: "/Users/*/")
    return NSPredicate(format: "SELF LIKE %@", pattern).evaluate(with: executable)
  }

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
    guard let data = try? Data(contentsOf: url), let newline = data.firstIndex(of: 0x0A),
      let header = (try? JSONSerialization.jsonObject(with: data[..<newline])) as? [String: Any],
      let body = (try? JSONSerialization.jsonObject(with: data[data.index(after: newline)...])) as? [String: Any],
      let procPath = body["procPath"] as? String,
      isThisExecutable(procPath: procPath, sliceUUID: header["slice_uuid"] as? String, executable: executable)
    else { return nil }
    let exception = body["exception"] as? [String: Any] ?? [:]
    let images = (body["usedImages"] as? [[String: Any]] ?? []).map { image -> String in
      if let name = image["name"] as? String, !name.isEmpty { return name }
      return (image["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } ?? "???"
    }
    let threads = body["threads"] as? [[String: Any]] ?? []
    let faulting = body["faultingThread"] as? Int ?? threads.firstIndex { $0["triggered"] as? Bool == true } ?? 0
    let frames = threads.indices.contains(faulting) ? threads[faulting]["frames"] as? [[String: Any]] ?? [] : []
    func simplified(_ frames: [[String: Any]]) -> [[String: Any]] {
      frames.prefix(64).map { frame -> [String: Any] in
        let index = frame["imageIndex"] as? Int ?? -1
        var out: [String: Any] = ["image": images.indices.contains(index) ? images[index] : "???"]
        if let symbol = frame["symbol"] as? String { out["symbol"] = symbol }
        if let offset = frame["imageOffset"] as? Int { out["offset"] = offset }
        return out
      }
    }
    var report: [String: Any] = ["time": time.timeIntervalSince1970 * 1000, "frames": simplified(frames)]
    // An uncaught NSException crashes in AppKit's handler; the throw site is only in lastExceptionBacktrace.
    if let thrown = body["lastExceptionBacktrace"] as? [[String: Any]], !thrown.isEmpty {
      report["exceptionFrames"] = simplified(thrown)
    }
    if let name = exceptionName(body) { report["exceptionName"] = name }
    for (key, value) in [
      ("incidentId", header["incident_id"]), ("appVersion", header["app_version"]), ("build", header["build_version"]),
      ("exceptionType", exception["type"]), ("signal", exception["signal"]),
    ] {
      if let value = value as? String { report[key] = value }
    }
    return report
  }

  /// The NSException's class-like name (NSRangeException, CALayerInvalidGeometry), never its reason.
  private static func exceptionName(_ body: [String: Any]) -> String? {
    let valid = try! NSRegularExpression(pattern: "^[A-Z][A-Za-z0-9_]{2,63}$")
    func checked(_ full: String) -> String? {
      // RCTFatal names its exception "RCTFatalException: <message>"; keep the constant only.
      let name = String(full.prefix { $0 != ":" })
      return valid.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) == nil ? nil : name
    }
    if let reason = body["exceptionReason"] as? [String: Any], let name = reason["name"] as? String {
      return checked(name)
    }
    // Older reports only carry "*** Terminating app due to uncaught exception 'Name', reason: …" in asi.
    let uncaught = try! NSRegularExpression(pattern: "uncaught exception '([^']{1,64})'")
    for case let lines as [String] in (body["asi"] as? [String: Any] ?? [:]).values {
      for line in lines {
        guard let match = uncaught.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
          let range = Range(match.range(at: 1), in: line) else { continue }
        return checked(String(line[range]))
      }
    }
    return nil
  }

  #if DEBUG
  @inline(never) static func crashForTesting(_ kind: String?) {
    if kind == "exception" {
      // Raised inside -[NSApplication run], like the 0.2.15 crash: AppKit reports it and crashes.
      _ = NSArray().object(at: 3)
    }
    let pointer = UnsafeMutablePointer<Int>(bitPattern: 0x10)!
    pointer.pointee = 1
  }
  #endif
}

#if DEBUG
enum KeyEquivalents {
  private static let modifierNames: [String: NSEvent.ModifierFlags] = [
    "command": .command, "shift": .shift, "option": .option, "control": .control, "function": .function,
  ]
  private static var fired: [[String: Any]] = []
  private static var matched: [[String: Any]] = []
  private static var watching = false
  private static var pressing = 0, dryPressing = 0
  private static var handler: ((String, String?, String?) -> Void)?
  private static var menuKeyIMP: IMP?

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
      let selector = NSSelectorFromString("keyEvent:wasKeyEquivalent:")
      typealias KeyEvent = @convention(c) (AnyObject, Selector, NSEvent, ObjCBool) -> Void
      unsafeBitCast(page.method(for: selector), to: KeyEvent.self)(page, selector, current, true)
      result["handledBy"] = "page"
    } else if window.performKeyEquivalent(with: current) {
      result["handledBy"] = "window"
    } else if dry, let (item, _) = menuItem(for: current), !(item is CommandItem) {
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

  private static func menuItem(for event: NSEvent, in menu: NSMenu? = NSApp.mainMenu) -> (NSMenuItem, NSMenu)? {
    guard let menu else { return nil }
    let relevant: NSEvent.ModifierFlags = [.command, .shift, .option, .control, .function]
    var key = event.charactersIgnoringModifiers ?? ""
    if key == "\u{7f}" { key = "\u{8}" }
    if key == "\u{19}" { key = "\t" }
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

  private static func pageViews(in window: NSWindow) -> [NSView] {
    var views: [NSView] = []
    func walk(_ view: NSView) {
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
