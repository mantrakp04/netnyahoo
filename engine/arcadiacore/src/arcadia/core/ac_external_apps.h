// Chrome's "Open <app>?" dialog for the host's tabs, asked of the host instead
// (tab:externalAppRequest:, -[ArcadiaCoreEngine resolveExternalApp:open:remember:]).

#ifndef ARCADIA_CORE_AC_EXTERNAL_APPS_H_
#define ARCADIA_CORE_AC_EXTERNAL_APPS_H_

#import <Foundation/Foundation.h>

#include <string>

namespace arcadiacore {

void InstallExternalAppPrompts();
void ResolveExternalApp(const std::string& request_id, bool open, bool remember);
// With --arcadia-test-external-protocol-no-launch (test runs), an approved app link isn't
// launched: [{url, remembered}] in order (remembered: Chrome's per-origin "always allow"
// for its scheme, read back after the answer).
NSArray<NSDictionary*>* TestExternalLaunches();
// The same switch for other things a test run must not open (System Settings): whether it's
// set, and adding a record to that list.
bool TestNoLaunch();
void RecordTestLaunch(NSDictionary* launch);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_EXTERNAL_APPS_H_
