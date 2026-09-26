import AppKit
import Expo
import React
import NetnyahooShell
import ReactAppDependencyProvider

final class AppDelegate: ExpoAppDelegate {
  private var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  private var reactNativeFactory: RCTReactNativeFactory?

  override func applicationDidFinishLaunching(_ notification: Notification) {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()
    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

    // Every window hosts its own React root on the one shared bridge, in Chrome's own
    // window of its profile (BrowserWindow only with stock CEF); JS opens them
    // (restoring the last session) once the bundle has run.
    WindowHost.makeWindow = { BrowserWindow() }
    WindowHost.makeContentView = { [weak factory] windowId in
      // Straight to RCTRootViewFactory: Expo's override routes through recreateRootView, which
      // asserts that no bridge exists yet — but every window after the first shares it.
      (factory?.rootViewFactory as? ExpoReactRootViewFactory)?.superView(
        withModuleName: "main", initialProperties: ["windowId": windowId], launchOptions: nil) ?? NSView()
    }
    factory.rootViewFactory.initializeReactHost(launchOptions: nil)

    super.applicationDidFinishLaunching(notification)
  }

  override func application(_ application: NSApplication, open urls: [URL]) {
    OpenURLInbox.receive(urls)
  }

  // Like Dia (and Chrome), closing the last window leaves the app running.
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    ShellApp.shouldTerminate()
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    ShellApp.reopen(hasVisibleWindows: flag)
  }

  func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
    ShellApp.dockMenu()
  }

  // MARK: Handoff

  override func application(_ application: NSApplication, willContinueUserActivityWithType userActivityType: String) -> Bool {
    userActivityType == NSUserActivityTypeBrowsingWeb || super.application(application, willContinueUserActivityWithType: userActivityType)
  }

  override func application(
    _ application: NSApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([any NSUserActivityRestoring]) -> Void
  ) -> Bool {
    Handoff.continue(userActivity) || super.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }

  // MARK: AppleScript (Netnyahoo.sdef): the application's windows and profiles come from the shell.

  func application(_ sender: NSApplication, delegateHandlesKey key: String) -> Bool {
    ShellScripting.handles(key)
  }

  @objc var appleScriptWindows: [NSObject] { ShellScripting.windows }
  @objc var appleScriptProfiles: [NSObject] { ShellScripting.profiles }
  @objc var version: String { ShellScripting.version }
}

final class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
