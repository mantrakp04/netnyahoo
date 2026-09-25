import AppKit
import EventKit
import ExpoModulesCore

/// macOS Calendar (EventKit) for Live Calendar: the calendar preview on pinned calendar tabs,
/// the time-to-next-meeting badge, meeting alerts and meeting tab groups. Reading the
/// authorization status never prompts; only `requestAccess` does, and JS calls it solely
/// from an explicit user action (Settings › Calendar, or the pin-a-calendar dialog).
public class CalendarModule: Module {
  private var store = EKEventStore()
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("NetnyahooCalendar")
    Events("onCalendarChanged")

    OnStartObserving("onCalendarChanged") {
      self.observe()
    }

    OnStopObserving("onCalendarChanged") {
      if let observer = self.observer { NotificationCenter.default.removeObserver(observer) }
      self.observer = nil
    }

    /// "fullAccess" | "writeOnly" | "denied" | "restricted" | "notDetermined".
    Function("authorizationStatus") { () -> String in
      Self.status()
    }

    /// Shows macOS's permission prompt the first time; resolves with whether events can be read.
    AsyncFunction("requestAccess") { (promise: Promise) in
      self.store.requestFullAccessToEvents { granted, _ in
        DispatchQueue.main.async {
          // A store created before access was granted doesn't see any calendars.
          if granted { self.store = EKEventStore(); self.observe() }
          promise.resolve(granted)
        }
      }
    }.runOnQueue(.main)

    /// [{ id, title, color, account, accountType, owned }]
    AsyncFunction("calendars") { () -> [[String: Any]] in
      guard Self.status() == "fullAccess" else { return [] }
      return self.store.calendars(for: .event).map { cal in
        [
          "id": cal.calendarIdentifier,
          "title": cal.title,
          "color": Self.hex(cal.color),
          "account": cal.source?.title ?? "",
          "accountType": Self.sourceType(cal.source?.sourceType),
          // Subscribed and birthday calendars are "not owned by the user" (Dia's second header).
          "owned": cal.allowsContentModifications && cal.type != .subscription && cal.type != .birthday,
        ]
      }
    }.runOnQueue(.main)

    /// Events overlapping [start, end] (ms since the epoch), in the given calendars (all when empty).
    AsyncFunction("events") { (start: Double, end: Double, calendarIds: [String]) -> [[String: Any]] in
      guard Self.status() == "fullAccess" else { return [] }
      let all = self.store.calendars(for: .event)
      let calendars = calendarIds.isEmpty ? all : all.filter { calendarIds.contains($0.calendarIdentifier) }
      guard !calendars.isEmpty else { return [] }
      let predicate = self.store.predicateForEvents(
        withStart: Date(timeIntervalSince1970: start / 1000),
        end: Date(timeIntervalSince1970: end / 1000),
        calendars: calendars
      )
      return self.store.events(matching: predicate).map(Self.serialize)
    }.runOnQueue(.main)
  }

  private func observe() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
      self?.sendEvent("onCalendarChanged", [:])
    }
  }

  private static func status() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess: return "fullAccess"
    case .writeOnly: return "writeOnly"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
  }

  private static func serialize(_ event: EKEvent) -> [String: Any] {
    let me = event.attendees?.first(where: { $0.isCurrentUser })
    return [
      "id": event.calendarItemIdentifier,
      // Recurring events share an identifier; the start makes each occurrence unique.
      "occurrence": "\(event.calendarItemIdentifier)@\(Int(event.startDate.timeIntervalSince1970))",
      "calendarId": event.calendar?.calendarIdentifier ?? "",
      "color": hex(event.calendar?.color),
      "title": event.title ?? "",
      "start": event.startDate.timeIntervalSince1970 * 1000,
      "end": event.endDate.timeIntervalSince1970 * 1000,
      "allDay": event.isAllDay,
      "location": event.location ?? "",
      "notes": event.notes ?? "",
      "url": event.url?.absoluteString ?? "",
      "cancelled": event.status == .canceled,
      "declined": me?.participantStatus == .declined,
      "organizer": event.organizer.map(participant) as Any,
      "attendees": (event.attendees ?? []).filter { $0.participantType != .room && $0.participantType != .resource }.map(participant),
    ]
  }

  private static func participant(_ p: EKParticipant) -> [String: Any] {
    let email = p.url.absoluteString.hasPrefix("mailto:") ? String(p.url.absoluteString.dropFirst(7)) : ""
    let status: String
    switch p.participantStatus {
    case .accepted: status = "accepted"
    case .declined: status = "declined"
    case .tentative: status = "tentative"
    default: status = "pending"
    }
    return ["name": p.name ?? "", "email": email, "status": status, "me": p.isCurrentUser]
  }

  private static func sourceType(_ type: EKSourceType?) -> String {
    switch type {
    case .local: return "local"
    case .exchange: return "exchange"
    case .calDAV: return "calDAV"
    case .subscribed: return "subscribed"
    case .birthdays: return "birthdays"
    default: return "other"
    }
  }

  private static func hex(_ color: NSColor?) -> String {
    guard let c = color?.usingColorSpace(.sRGB) else { return "#8E8E93" }
    return String(format: "#%02X%02X%02X", Int(round(c.redComponent * 255)), Int(round(c.greenComponent * 255)), Int(round(c.blueComponent * 255)))
  }
}
