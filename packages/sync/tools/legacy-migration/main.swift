// Runs the launch migration outside the app, for scripts/legacy-migration-e2e.mjs:
//   legacy-migration names   the old → new tables (JSON)
//   legacy-migration run     LegacyMigration.runAtLaunch() as a test instance runs it (ARCADIA_DATA_DIR and
//                            ARCADIA_LEGACY_SOURCE set); exits 0 to go on launching, 3 when the app would quit.
//   legacy-migration move [--wait <file>]
//                            Copied into a bundle as its executable: LegacyMigration.moveToNewName() as the app runs it
//                            (after <file> appears, with --wait: a launch held up while another one moves the bundle).
//                            Prints "at <the path this process was started from>|$MOVE_MARK|<arguments>" once it stays
//                            (after an exec, the new bundle's).
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
case "move":
  let args = CommandLine.arguments
  if args.count == 4, args[2] == "--wait" {
    while !FileManager.default.fileExists(atPath: args[3]) { usleep(20_000) }
  }
  LegacyMigration.moveToNewName()
  let launched = LegacyMigration.launchedExecutable() ?? "?"
  print("at \(launched)|\(ProcessInfo.processInfo.environment["MOVE_MARK"] ?? "")|\(args.dropFirst().joined(separator: " "))")
default:
  FileHandle.standardError.write(Data("usage: legacy-migration names|run|move [--wait <file>]\n".utf8))
  exit(2)
}
