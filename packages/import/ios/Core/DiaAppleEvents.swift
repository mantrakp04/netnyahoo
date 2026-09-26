import AppKit
import CoreServices

/// Asks Dia for its windows, profiles and tabs with raw Apple Events (`core/getd`), the same
/// events AppleScript sends for `get URL of every tab of every profile of every window`.
///
/// Raw events rather than NSAppleScript: they're safe off the main thread, every event carries
/// its own timeout, and failures come back as plain OSStatus codes (not running, not allowed,
/// timed out). Ten events read everything: three window properties, two profile properties and
/// five tab properties, each for every element at once. They're separate snapshots, so a tab
/// opened or closed between two of them shows up as lists of different shapes; the read is then
/// retried.
public final class DiaAppleEvents: DiaScriptingSource {
  public let target: NSAppleEventDescriptor
  /// Seconds each event may take before it fails with a timeout.
  public let timeout: TimeInterval

  public init(bundleIdentifier: String = DiaAutomation.bundleIdentifier, timeout: TimeInterval = 10) {
    target = NSAppleEventDescriptor(bundleIdentifier: bundleIdentifier)
    self.timeout = timeout
  }

  /// Tests: a scriptable process by pid (an app scripting itself needs no Automation consent).
  public init(processIdentifier: pid_t, timeout: TimeInterval = 10) {
    target = NSAppleEventDescriptor(processIdentifier: processIdentifier)
    self.timeout = timeout
  }

  public func windows() throws -> [DiaScript.Window] {
    var attempt = 0
    while true {
      attempt += 1
      if let windows = try readOnce() { return windows }
      guard attempt < 3 else { throw ImportError.unreadable("Dia's tabs kept changing while they were read. Try again.") }
    }
  }

  // MARK: Reading

  /// nil when the answers don't line up (Dia's tabs changed between events).
  func readOnce() throws -> [DiaScript.Window]? {
    let windows = Spec.every(Code.window, of: .null())
    let ids = try get(Code.id, of: windows).map(Value.string)
    let names = try get(Code.name, of: windows).map(Value.string)
    let indexes = try get(Code.index, of: windows).map(Value.int)

    let profiles = Spec.every(Code.profile, of: windows)
    let profileNames = try get(Code.name, of: profiles).map(Value.list)
    let profileIndexes = try get(Code.index, of: profiles).map(Value.list)

    let tabs = Spec.every(Code.tab, of: profiles)
    let tabIds = try get(Code.id, of: tabs).map { Value.list($0).map(Value.list) }
    let titles = try get(Code.name, of: tabs).map { Value.list($0).map(Value.list) }
    let urls = try get(Code.url, of: tabs).map { Value.list($0).map(Value.list) }
    let pinned = try get(Code.isPinned, of: tabs).map { Value.list($0).map(Value.list) }
    let focused = try get(Code.isFocused, of: tabs).map { Value.list($0).map(Value.list) }

    let count = ids.count
    guard [names.count, indexes.count, profileNames.count, profileIndexes.count, tabIds.count, titles.count,
           urls.count, pinned.count, focused.count].allSatisfy({ $0 == count }) else { return nil }

    var out: [DiaScript.Window] = []
    for w in 0..<count {
      let profileCount = profileNames[w].count
      guard [profileIndexes[w].count, tabIds[w].count, titles[w].count, urls[w].count, pinned[w].count,
             focused[w].count].allSatisfy({ $0 == profileCount }) else { return nil }
      var windowProfiles: [DiaScript.Profile] = []
      for p in 0..<profileCount {
        let tabCount = tabIds[w][p].count
        guard [titles[w][p].count, urls[w][p].count, pinned[w][p].count, focused[w][p].count]
          .allSatisfy({ $0 == tabCount }) else { return nil }
        let windowTabs = (0..<tabCount).map { t in
          DiaScript.Tab(id: Value.string(tabIds[w][p][t]) ?? "", title: Value.string(titles[w][p][t]) ?? "",
                        url: Value.string(urls[w][p][t]), isPinned: Value.bool(pinned[w][p][t]),
                        isFocused: Value.bool(focused[w][p][t]))
        }
        windowProfiles.append(DiaScript.Profile(name: Value.string(profileNames[w][p]) ?? "",
                                                index: Value.int(profileIndexes[w][p]) ?? p + 1, tabs: windowTabs))
      }
      out.append(DiaScript.Window(id: ids[w] ?? "", name: names[w] ?? "", index: indexes[w] ?? w + 1, profiles: windowProfiles))
    }
    return out
  }

  /// `get <property> of <specifier>`: the reply's direct object as a list.
  func get(_ property: FourCharCode, of container: NSAppleEventDescriptor) throws -> [NSAppleEventDescriptor] {
    let event = NSAppleEventDescriptor.appleEvent(
      withEventClass: Code.coreSuite, eventID: Code.getData, targetDescriptor: target,
      returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
    event.setParam(Spec.property(property, of: container), forKeyword: Code.directObject)
    let reply: NSAppleEventDescriptor
    do {
      reply = try event.sendEvent(options: [.waitForReply, .neverInteract], timeout: timeout)
    } catch let error as NSError {
      throw DiaAutomation.error(OSStatus(truncatingIfNeeded: error.code), timeout: timeout)
    }
    if let code = reply.paramDescriptor(forKeyword: Code.errorNumber)?.int32Value, code != 0 {
      throw DiaAutomation.error(code, timeout: timeout)
    }
    return Value.list(reply.paramDescriptor(forKeyword: Code.directObject))
  }

  // MARK: Descriptors

  enum Code {
    static let coreSuite = fourCC("core")
    static let getData = fourCC("getd")
    static let directObject = fourCC("----")
    static let errorNumber = fourCC("errn")
    // Classes and properties from Dia's sdef.
    static let window = fourCC("cwin")
    static let profile = fourCC("DiaP")
    static let tab = fourCC("DiaT")
    static let id = fourCC("ID  ")
    static let name = fourCC("pnam")  // window name, profile name, tab title
    static let index = fourCC("pidx")
    static let url = fourCC("URL ")
    static let isPinned = fourCC("DiPi")
    static let isFocused = fourCC("DiFo")
  }

  /// Object specifiers: records of want / form / seld / from, typed 'obj '.
  enum Spec {
    static func every(_ cls: FourCharCode, of container: NSAppleEventDescriptor) -> NSAppleEventDescriptor {
      var all = fourCC("all ")
      let seld = NSAppleEventDescriptor(descriptorType: fourCC("abso"), bytes: &all, length: 4)!
      return make(want: cls, form: fourCC("indx"), seld: seld, from: container)
    }

    static func property(_ code: FourCharCode, of container: NSAppleEventDescriptor) -> NSAppleEventDescriptor {
      make(want: fourCC("prop"), form: fourCC("prop"), seld: NSAppleEventDescriptor(typeCode: code), from: container)
    }

    static func make(want: FourCharCode, form: FourCharCode, seld: NSAppleEventDescriptor,
                     from: NSAppleEventDescriptor) -> NSAppleEventDescriptor {
      let record = NSAppleEventDescriptor.record()
      record.setDescriptor(NSAppleEventDescriptor(typeCode: want), forKeyword: fourCC("want"))
      record.setDescriptor(NSAppleEventDescriptor(enumCode: form), forKeyword: fourCC("form"))
      record.setDescriptor(seld, forKeyword: fourCC("seld"))
      record.setDescriptor(from, forKeyword: fourCC("from"))
      return record.coerce(toDescriptorType: fourCC("obj ")) ?? record
    }
  }

  enum Value {
    static func list(_ d: NSAppleEventDescriptor?) -> [NSAppleEventDescriptor] {
      guard let d, d.descriptorType == fourCC("list") else { return d.map { isMissing($0) ? [] : [$0] } ?? [] }
      return d.numberOfItems == 0 ? [] : (1...d.numberOfItems).compactMap { d.atIndex($0) }
    }

    static func isMissing(_ d: NSAppleEventDescriptor) -> Bool {
      d.descriptorType == fourCC("null") || (d.descriptorType == fourCC("type") && d.typeCodeValue == fourCC("msng"))
    }

    static func string(_ d: NSAppleEventDescriptor) -> String? { isMissing(d) ? nil : d.stringValue }
    static func int(_ d: NSAppleEventDescriptor) -> Int? { isMissing(d) ? nil : Int(d.int32Value) }
    static func bool(_ d: NSAppleEventDescriptor) -> Bool { isMissing(d) ? false : d.booleanValue }
  }
}

/// Dia's side of macOS Automation consent (TCC's "Netnyahoo wants to control Dia").
public enum DiaAutomation {
  public static let bundleIdentifier = "company.thebrowser.dia"

  public enum Status: String, Codable, Sendable {
    case granted, denied, notDetermined, notRunning, notInstalled
  }

  public static func isInstalled(_ bundleIdentifier: String = bundleIdentifier) -> Bool {
    NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil
  }

  public static func isRunning(_ bundleIdentifier: String = bundleIdentifier) -> Bool {
    !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
  }

  /// Whether Netnyahoo may send Dia Apple Events. `ask` shows macOS's consent prompt when the
  /// user hasn't decided yet, and blocks until they answer: call it off the main thread, and only
  /// after the UI has said what's coming. Without `ask` it never prompts.
  public static func status(_ bundleIdentifier: String = bundleIdentifier, ask: Bool) -> Status {
    // A running app counts as installed wherever it lives (LaunchServices doesn't index every folder).
    guard isRunning(bundleIdentifier) else { return isInstalled(bundleIdentifier) ? .notRunning : .notInstalled }
    let target = NSAppleEventDescriptor(bundleIdentifier: bundleIdentifier)
    guard let desc = target.aeDesc else { return .denied }
    return status(AEDeterminePermissionToAutomateTarget(desc, DiaAppleEvents.Code.coreSuite, DiaAppleEvents.Code.getData, ask))
  }

  static func status(_ code: OSStatus) -> Status {
    switch code {
    case noErr: .granted
    case OSStatus(errAEEventWouldRequireUserConsent): .notDetermined
    case OSStatus(procNotFound): .notRunning
    default: .denied  // errAEEventNotPermitted, and anything else that stops us
    }
  }

  static func error(_ code: OSStatus, timeout: TimeInterval) -> ImportError {
    switch code {
    case OSStatus(procNotFound), OSStatus(connectionInvalid):
      .notRunning("Dia isn't running")
    case OSStatus(errAEEventNotPermitted), OSStatus(errAEEventWouldRequireUserConsent):
      .locked("macOS didn't allow Netnyahoo to read Dia's tabs")
    case OSStatus(errAETimeout):
      .unreadable("Dia didn't answer within \(Int(timeout)) seconds")
    default:
      .unreadable("Dia couldn't list its tabs (error \(code))")
    }
  }
}

func fourCC(_ s: StaticString) -> FourCharCode {
  s.withUTF8Buffer { $0.reduce(0) { $0 << 8 | FourCharCode($1) } }
}
