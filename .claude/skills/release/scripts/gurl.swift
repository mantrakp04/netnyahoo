// gurl <pid> <url> [url…]: a link from another app, as Launch Services delivers it — one kAEGetURL ('GURL') Apple
// Event (the URLs as a list when several) — sent to that process only, never to the default browser.
import Foundation

let args = CommandLine.arguments
guard args.count >= 3, let pid = pid_t(args[1]) else {
  print("usage: gurl <pid> <url> [url…]")
  exit(1)
}
let gurl: UInt32 = 0x4755_524C  // 'GURL': kInternetEventClass and kAEGetURL
let event = NSAppleEventDescriptor.appleEvent(
  withEventClass: gurl, eventID: gurl, targetDescriptor: NSAppleEventDescriptor(processIdentifier: pid),
  returnID: AEReturnID(kAutoGenerateReturnID), transactionID: AETransactionID(kAnyTransactionID))
let urls = Array(args[2...])
if urls.count == 1 {
  event.setParam(NSAppleEventDescriptor(string: urls[0]), forKeyword: keyDirectObject)
} else {
  let list = NSAppleEventDescriptor.list()
  for (i, url) in urls.enumerated() { list.insert(NSAppleEventDescriptor(string: url), at: i + 1) }
  event.setParam(list, forKeyword: keyDirectObject)
}
do {
  // kAENeverInteract | kAEWaitReply
  _ = try event.sendEvent(options: NSAppleEventDescriptor.SendOptions(rawValue: 0x10 | 0x3), timeout: 10)
} catch {
  print("error: \(error)")
  exit(1)
}
