import Foundation

/// Deleting the original profile's data, as packages/cef's ProfileData.deleteDefault. The original profile is Chrome's
/// Default profile, which stays loaded (it backs private windows and the content blocker), so its folder can't go:
/// its data goes through Chrome's own stores instead, each checked afterwards. Extensions are turned off, not removed:
/// Chrome asks the user to confirm every removal that doesn't come from a click in its own UI.
enum NNCoreProfileData {
  typealias Done = ([String]) -> Void
  private typealias Step = (label: String, run: (@escaping (Bool) -> Void) -> Void)

  static func deleteDefault(_ done: @escaping Done) {
    let steps: [Step] = [
      ("history, cookies and cache", { ok in
        NNCoreServices.clearBrowsingData(profile: "", types: ["history", "siteData", "cache", "downloads"], since: 0) { ok(true) }
      }),
      // As Chrome's Delete Browsing Data dialog deletes them: form data is autofill plus autocomplete entries.
      ("autocomplete entries", { ok in
        NNCoreServices.call("nn_browsing_data_clear", profile: "", args: ["types": ["formData", "siteSettings"]]) { ok($0["ok"] as? Bool == true) }
      }),
      ("passwords", deletePasswords),
      ("addresses", { ok in clearEach(list: { NNCoreServices.addresses(profile: "", completion: $0) }, key: "addresses", done: ok) {
        item, next in NNCoreServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _ in next() }
      } }),
      ("cards", { ok in clearEach(list: { NNCoreServices.cards(profile: "", completion: $0) }, key: "cards", done: ok) {
        item, next in NNCoreServices.deleteAutofillEntry(item["id"] as? String ?? "", profile: "") { _ in next() }
      } }),
      ("extensions", { ok in clearEach(list: runningExtensions, key: "extensions", done: ok) {
        item, next in NNCoreServices.setExtension(item["id"] as? String ?? "", enabled: false, profile: "") { _ in next() }
      } }),
      ("site settings", resetSiteSettings),
      ("zoom levels", resetZoom),
    ]
    var remaining: [String] = []
    func run(_ i: Int) {
      guard i < steps.count else { return done(remaining) }
      steps[i].run { ok in
        if !ok { remaining.append(steps[i].label) }
        run(i + 1)
      }
    }
    run(0)
  }

  private static func deletePasswords(_ ok: @escaping (Bool) -> Void) {
    clearEach(list: { NNCoreServices.listPasswords(profile: "", completion: $0) }, key: "passwords", done: { deleted in
      NNCoreServices.neverSaveOrigins(profile: "") { result in
        let origins = result["origins"] as? [String] ?? []
        forEach(origins, { origin, next in NNCoreServices.allowSaving(profile: "", origin: origin) { _ in next() } }) {
          NNCoreServices.neverSaveOrigins(profile: "") { again in ok(deleted && (again["origins"] as? [String])?.isEmpty == true) }
        }
      }
    }) { item, next in
      NNCoreServices.deletePassword(profile: "", origin: item["origin"] as? String ?? "", username: item["username"] as? String ?? "") { _ in next() }
    }
  }

  private static func runningExtensions(_ completion: @escaping ([String: Any]) -> Void) {
    NNCoreServices.listExtensions(profile: "") { result in
      guard let all = result["extensions"] as? [[String: Any]] else { return completion(result) }
      completion(["extensions": all.filter { $0["mayModify"] as? Bool != false && $0["enabled"] as? Bool == true }])
    }
  }

  private static func resetSiteSettings(_ ok: @escaping (Bool) -> Void) {
    NNCoreServices.siteSettingsOrigins(profile: "") { origins in
      forEach(origins, { origin, next in
        NNCoreServices.call("nn_site_settings_reset", profile: "", args: ["origin": origin]) { _ in next() }
      }) {
        NNCoreServices.siteSettingsOrigins(profile: "") { left in ok(left.isEmpty) }
      }
    }
  }

  private static func resetZoom(_ ok: @escaping (Bool) -> Void) {
    NNCoreServices.zoomLevels(profile: "") { levels in
      for host in levels.keys { NNCoreServices.setZoom(1, profile: "", host: host) }
      func check(_ attempt: Int) {
        NNCoreServices.zoomLevels(profile: "") { left in
          if left.isEmpty || attempt >= 20 { return ok(left.isEmpty) }
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { check(attempt + 1) }
        }
      }
      check(0)
    }
  }

  /// Lists the items under `key`, clears each, and lists again: done(true) when none are left.
  private static func clearEach(
    list: @escaping (@escaping ([String: Any]) -> Void) -> Void, key: String, done: @escaping (Bool) -> Void,
    clear: @escaping ([String: Any], @escaping () -> Void) -> Void
  ) {
    list { result in
      guard let items = result[key] as? [[String: Any]] else { return done(false) }
      forEach(items, clear) {
        list { again in done((again[key] as? [Any])?.isEmpty == true) }
      }
    }
  }

  private static func forEach<T>(_ items: [T], _ body: @escaping (T, @escaping () -> Void) -> Void, then: @escaping () -> Void) {
    guard let first = items.first else { return then() }
    body(first) { forEach(Array(items.dropFirst()), body, then: then) }
  }
}
