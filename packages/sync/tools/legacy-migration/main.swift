// Runs the launch migration outside the app, for scripts/legacy-migration-e2e.mjs:
//   legacy-migration names   the old → new tables (JSON)
//   legacy-migration run     LegacyMigration.runAtLaunch() as a test instance runs it (ARCADIA_DATA_DIR and
//                            ARCADIA_LEGACY_SOURCE set); exits 0 to go on launching, 3 when the app would quit.
import ArcadiaSyncCore
import Foundation

switch CommandLine.arguments.dropFirst().first {
case "names":
  FileHandle.standardOutput.write(LegacyMigration.namesJSON())
case "run":
  guard ProcessInfo.processInfo.environment["ARCADIA_DATA_DIR"] != nil else {
    FileHandle.standardError.write(Data("set ARCADIA_DATA_DIR and ARCADIA_LEGACY_SOURCE\n".utf8))
    exit(2)
  }
  exit(LegacyMigration.runAtLaunch(bundleId: "com.arcadia.browser") ? 0 : 3)
default:
  FileHandle.standardError.write(Data("usage: legacy-migration names|run\n".utf8))
  exit(2)
}
