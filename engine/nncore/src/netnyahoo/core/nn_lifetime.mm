#include "netnyahoo/core/nn_lifetime.h"

#import <AppKit/AppKit.h>
#include <CoreServices/CoreServices.h>
#import <objc/runtime.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#import "chrome/browser/app_controller_mac.h"
#import "chrome/browser/chrome_browser_application_mac.h"
#include "chrome/browser/devtools/chrome_devtools_manager_delegate.h"
#include "chrome/browser/download/download_core_service.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/lifetime/application_lifetime_desktop.h"
#include "chrome/browser/lifetime/browser_shutdown.h"
#include "netnyahoo/core/nn_browser.h"
#include "netnyahoo/core/nn_main_delegate.h"

namespace nncore {

namespace {

// A quit NNCore started and that can still be cancelled (beforeunload, the downloads prompt).
bool g_quitting = false;
// -applicationShouldTerminate: answered NSTerminateLater; waiting for the reply.
bool g_terminate_pending = false;

LifetimeCallbacks& Callbacks() {
  static base::NoDestructor<LifetimeCallbacks> callbacks;
  return *callbacks;
}

base::CallbackListSubscription& ClosingAllBrowsersSubscription() {
  static base::NoDestructor<base::CallbackListSubscription> subscription;
  return *subscription;
}

void QuitCancelled() {
  if (!g_quitting) {
    return;
  }
  g_quitting = false;
  // Not from inside Chrome's cancel path: the host may close or quit again right away.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([] {
        NotifyWindowsQuitCancelled();
        if (Callbacks().quit_cancelled) {
          Callbacks().quit_cancelled.Run();
        }
      }));
}

void StartQuit() {
  // As -[AppController tryToTerminateApplication]: everything closes, beforeunload first; the
  // keep-alive goes only when the last Browser has (NSApplicationWillTerminateNotification).
  chrome::OnClosingAllBrowsers(true);
  chrome::CloseAllBrowsersAndQuit();
}

void Terminate() {
  if (g_quitting || g_terminate_pending) {
    return;
  }
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(applicationShouldTerminate:)]) {
    QuitEngine();
    return;
  }
  switch ([delegate applicationShouldTerminate:NSApp]) {
    case NSTerminateNow:
      QuitEngine();
      break;
    case NSTerminateLater:
      g_terminate_pending = true;
      break;
    case NSTerminateCancel:
      break;
  }
}

}  // namespace

bool IsQuitting() {
  return g_quitting;
}

void SetLifetimeCallbacks(LifetimeCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void QuitEngine() {
  if (g_quitting || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  g_quitting = true;
  // Chrome's Mac close manager leaves the in-progress downloads prompt to AppController.
  const int downloads = DownloadCoreService::BlockingShutdownCountAllProfiles();
  if (downloads == 0) {
    StartQuit();
    return;
  }
  ConfirmQuitWithDownloads(downloads, base::BindOnce([](bool quit_anyway) {
                             if (!g_quitting) {
                               return;
                             }
                             if (quit_anyway) {
                               StartQuit();
                             } else {
                               QuitCancelled();
                             }
                           }));
}

void StartLifetimeObservers() {
  // A page's beforeunload "stay" (and a declined downloads prompt in a Browser) ends with
  // UnloadController::CancelWindowClose, which reports closing=false here; the close manager
  // has already reset browser_shutdown's "trying to quit".
  ClosingAllBrowsersSubscription() =
      chrome::AddClosingAllBrowsersCallback(base::BindRepeating([](bool closing) {
        if (!closing && g_quitting && !browser_shutdown::IsTryingToQuit()) {
          QuitCancelled();
        }
      }));
  // The quit's point of no return (chrome::OnAppExiting, after the last Browser closed). As
  // -[AppController applicationWillTerminate:]: drop the keep-alive so the loop ends. NSApp's
  // own delegate gets -applicationWillTerminate: from the same notification.
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationWillTerminateNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                g_quitting = false;
                ReleaseAppKeepAlive();
                // With a remote-debugging port and no startup window Chrome also stays up
                // for the automation client until it says Browser.close.
                ChromeDevToolsManagerDelegate::AllowBrowserToClose();
              }];
}

}  // namespace nncore

// --- AppKit overrides --------------------------------------------------------------------

namespace {

id NilSharedController(id self, SEL _cmd) {
  return nil;
}

void NNTerminate(id self, SEL _cmd, id sender) {
  nncore::Terminate();
}

void NNCancelTerminate(id self, SEL _cmd, id sender) {
  // A beforeunload dialog's "Stay" during a quit (Chrome's app-modal dialog calls this).
  if (browser_shutdown::IsTryingToQuit()) {
    browser_shutdown::SetTryingToQuit(false);
  }
}

IMP g_appkit_reply_to_should_terminate = nullptr;

void NNReplyToApplicationShouldTerminate(id self, SEL _cmd, BOOL should_terminate) {
  if (!nncore::g_terminate_pending) {
    // Not ours to answer (an AppKit path asked the delegate itself).
    if (g_appkit_reply_to_should_terminate) {
      reinterpret_cast<void (*)(id, SEL, BOOL)>(g_appkit_reply_to_should_terminate)(
          self, _cmd, should_terminate);
    }
    return;
  }
  nncore::g_terminate_pending = false;
  if (should_terminate) {
    nncore::QuitEngine();
  }
}

}  // namespace

// The Dock's Quit, logout, restart and `osascript … to quit` send kAEQuitApplication. AppKit's
// own handler asks NSApp.delegate itself (waiting in a nested loop on NSTerminateLater) and
// then sends -terminate:, which would ask again; this one goes straight to -terminate:, so the
// delegate is asked once, as for the Quit menu item. (Chrome's AppController never answers
// applicationShouldTerminate:, so Chrome's AppKit path asks nobody either.)
@interface NNQuitAppleEventHandler : NSObject
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply;
@end

@implementation NNQuitAppleEventHandler
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply {
  [NSApp terminate:nil];
}
@end

namespace nncore {

namespace {
void InstallQuitAppleEventHandler() {
  static NNQuitAppleEventHandler* handler = [[NNQuitAppleEventHandler alloc] init];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:handler
          andSelector:@selector(handleQuitEvent:withReply:)
        forEventClass:kCoreEventClass
           andEventID:kAEQuitApplication];
}
}  // namespace

void InstallAppOverrides() {
  // +[AppController sharedController] would create Chrome's AppController and make it
  // NSApp.delegate. Every caller in this tree messages its result (nil-safe), and
  // -confirmQuitIfNeeded on nil is ConfirmQuitResultNotPrompted.
  Class app_controller = [AppController class];
  class_replaceMethod(object_getClass(app_controller), @selector(sharedController),
                      reinterpret_cast<IMP>(NilSharedController), "@@:");
  // Cocoa's contract for terminate:, instead of Chrome's AppController.
  Class app = [BrowserCrApplication class];
  class_replaceMethod(app, @selector(terminate:), reinterpret_cast<IMP>(NNTerminate),
                      "v@:@");
  class_replaceMethod(app, @selector(cancelTerminate:),
                      reinterpret_cast<IMP>(NNCancelTerminate), "v@:@");
  g_appkit_reply_to_should_terminate = class_getMethodImplementation(
      app, @selector(replyToApplicationShouldTerminate:));
  class_replaceMethod(app, @selector(replyToApplicationShouldTerminate:),
                      reinterpret_cast<IMP>(NNReplyToApplicationShouldTerminate), "v@:c");
  // AppKit installs its Apple event handlers in -finishLaunching (inside -[NSApp run]);
  // ours replaces its quit handler right after.
  [NSNotificationCenter.defaultCenter
      addObserverForName:NSApplicationDidFinishLaunchingNotification
                  object:nil
                   queue:nil
              usingBlock:^(NSNotification*) {
                InstallQuitAppleEventHandler();
              }];
}

}  // namespace nncore
