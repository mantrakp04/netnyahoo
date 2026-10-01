// usage: sparkle-host <installed Netnyahoo.app> <feed URL> <expected CFBundleShortVersionString>
// Updates an installed copy in place the way Sparkle's automatic updates do: reads the feed, picks the newest item,
// downloads it, checks its EdDSA signature against the copy's SUPublicEDKey, extracts it, and runs Sparkle's
// installer, which swaps the bundle. Silently (no installer progress window) and without relaunching it.
// update-test.sh runs it on a scratch copy with a test bundle id, so Sparkle's settings land in that id's defaults.
import Foundation
import Sparkle

let args = CommandLine.arguments
guard args.count == 4, let host = Bundle(path: args[1]) else {
  FileHandle.standardError.write("usage: sparkle-host <app> <feed URL> <expected version>\n".data(using: .utf8)!)
  exit(2)
}
let appPath = args[1], feed = args[2], expected = args[3]
func log(_ s: String) { print("sparkle: \(s)"); fflush(stdout) }
func fail(_ s: String) -> Never { log("FAIL \(s)"); exit(1) }

final class Driver: NSObject, SPUUserDriver {
  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
    reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
  }
  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {}
  func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
    log("update found through the UI path (\(appcastItem.displayVersionString)); installing")
    reply(.install)
  }
  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
  func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) { fail("no update found: \(error.localizedDescription)") }
  func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) { fail("updater error: \(error)") }
  func showDownloadInitiated(cancellation: @escaping () -> Void) {}
  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}
  func showDownloadDidReceiveData(ofLength length: UInt64) {}
  func showDownloadDidStartExtractingUpdate() {}
  func showExtractionReceivedProgress(_ progress: Double) {}
  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) { reply(.install) }
  func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
    log("installing (app terminated: \(applicationTerminated))")
  }
  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    log("installed (relaunched: \(relaunched))")
    acknowledgement()
  }
  func dismissUpdateInstallation() {}
}

final class Delegate: NSObject, SPUUpdaterDelegate {
  func feedURLString(for updater: SPUUpdater) -> String? { feed }
  func updaterShouldRelaunchApplication(_ updater: SPUUpdater) -> Bool { false }
  func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
    log("found \(item.displayVersionString) (build \(item.versionString)) at \(item.fileURL?.absoluteString ?? "?")")
  }
  func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) { fail("no update found: \((error as NSError).localizedDescription)") }
  func updater(_ updater: SPUUpdater, didDownloadUpdate item: SUAppcastItem) { log("downloaded") }
  func updater(_ updater: SPUUpdater, failedToDownloadUpdate item: SUAppcastItem, error: Error) { fail("download: \(error)") }
  func updater(_ updater: SPUUpdater, didExtractUpdate item: SUAppcastItem) { log("extracted and validated (EdDSA)") }
  func updater(_ updater: SPUUpdater, willInstallUpdate item: SUAppcastItem) { log("installer starting") }
  func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem, immediateInstallationBlock: @escaping () -> Void) -> Bool {
    log("ready to install on quit; installing now")
    immediateInstallationBlock()
    return true
  }
  func updater(_ updater: SPUUpdater, didAbortWithError error: Error) { fail("aborted: \(error)") }
}

let driver = Driver(), delegate = Delegate()
let updater = SPUUpdater(hostBundle: host, applicationBundle: host, userDriver: driver, delegate: delegate)
// Sparkle's silent path (an automatic download, installed on quit) runs its installer without a progress window.
updater.automaticallyDownloadsUpdates = true
do { try updater.start() } catch { fail("start: \(error)") }
updater.checkForUpdatesInBackground()

let version = { () -> String? in
  (NSDictionary(contentsOfFile: appPath + "/Contents/Info.plist")?["CFBundleShortVersionString"]) as? String
}
let deadline = Date().addingTimeInterval(240)
while Date() < deadline {
  RunLoop.main.run(until: Date().addingTimeInterval(0.5))
  if version() == expected {
    log("the copy is now \(expected)")
    exit(0)
  }
}
fail("still \(version() ?? "unreadable") after 240 s")
