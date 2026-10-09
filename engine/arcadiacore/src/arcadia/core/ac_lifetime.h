// The app's lifetime under ArcadiaCore: the quit, and -[NSApp terminate:] following Cocoa's contract.
//
// Chrome's Mac lifetime runs through its AppController (NSApp.delegate): -[BrowserCrApplication
// terminate:] asks it to quit, and it holds the keep-alive that outlives the last window. ArcadiaCore
// apps have their own NSApp.delegate, so AppController is never created (+sharedController
// answers nil; every caller in this tree is nil-safe), terminate: asks NSApp.delegate's
// -applicationShouldTerminate:, and ArcadiaCore holds the keep-alive itself until the quit can no
// longer be cancelled.

#ifndef ARCADIA_CORE_AC_LIFETIME_H_
#define ARCADIA_CORE_AC_LIFETIME_H_

#include "base/functional/callback.h"

namespace arcadiacore {

// In the browser process, before anything touches NSApp's delegate or AppController.
void InstallAppOverrides();

// Once the browser process is up (Chrome's lifetime callbacks exist).
void StartLifetimeObservers();

// Chrome's quit: the downloads prompt, then beforeunload in every Browser, then every Browser
// closes and the loop ends. Cancellable; `cancelled` runs if a page or the host says stay.
void QuitEngine();
bool IsQuitting();

struct LifetimeCallbacks {
  base::RepeatingClosure quit_cancelled;
};
void SetLifetimeCallbacks(LifetimeCallbacks callbacks);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_LIFETIME_H_
