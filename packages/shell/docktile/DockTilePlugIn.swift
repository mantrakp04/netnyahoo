import AppKit

@objc(NNDockTilePlugIn)
final class NNDockTilePlugIn: NSObject, NSDockTilePlugIn {
  private var dockTile: NSDockTile?
  private var observer: NSObjectProtocol?

  private lazy var app: Bundle? = {
    let url = Bundle(for: NNDockTilePlugIn.self).bundleURL
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    return Bundle(url: url)
  }()

  private var cacheKey: String { "\(app?.bundleIdentifier ?? "app").\(AppIcons.defaultsKey)" }

  func setDockTile(_ dockTile: NSDockTile?) {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
    observer = nil
    self.dockTile = dockTile
    guard dockTile != nil, let app, let bundleId = app.bundleIdentifier else { return }

    if let artwork = app.image(forResource: "AppIcon") { AppIcons.base = artwork }
    observer = DistributedNotificationCenter.default().addObserver(
      forName: AppIcons.changedNotification(bundleId: bundleId), object: nil, queue: .main
    ) { [weak self] note in
      guard let self, let id = note.userInfo?["icon"] as? String else { return }
      UserDefaults.standard.set(id, forKey: self.cacheKey)
      self.show(id)
    }
    let saved = CFPreferencesCopyAppValue(AppIcons.defaultsKey as CFString, bundleId as CFString) as? String
    show(saved ?? UserDefaults.standard.string(forKey: cacheKey) ?? "default")
  }

  private func show(_ id: String) {
    guard let dockTile else { return }
    if id == "default" || !AppIcons.variants.contains(where: { $0.id == id }) {
      dockTile.contentView = nil
    } else if let image = AppIcons.image(id, size: 512) {
      let view = NSImageView(frame: NSRect(origin: .zero, size: dockTile.size))
      view.image = image
      view.imageScaling = .scaleProportionallyUpOrDown
      dockTile.contentView = view
    }
    dockTile.display()
  }

  deinit {
    if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
  }
}
