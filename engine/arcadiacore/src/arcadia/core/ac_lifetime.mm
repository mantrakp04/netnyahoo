#include "arcadia/core/ac_lifetime.h"

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
#include "chrome/browser/profiles/profile_manager.h"
#include "ui/color/color_provider_manager.h"
#include "ui/native_theme/native_theme.h"
#include <vector>
#include "arcadia/core/ac_browser.h"
#include "arcadia/core/ac_main_delegate.h"

namespace arcadiacore {

namespace {

// The one record of a quit, from -terminate: to the end: asking the host (its
// applicationShouldTerminate:, NSTerminateLater until it replies), Chrome's downloads prompt,
// then Chrome closing every Browser (beforeunload). Any of them can cancel it, and the host hears
// every cancel (engineQuitCancelled) before another quit can start. Past the point of no return
// (NSApplicationWillTerminateNotification) nothing starts again. Each attempt has its own
// generation, so an old prompt's late answer can't steer a newer quit.
enum class QuitPhase { kNone, kAskingHost, kAskingDownloads, kClosing, kCancelling, kExiting };
QuitPhase g_phase = QuitPhase::kNone;
int g_quit_generation = 0;

LifetimeCallbacks& Callbacks() {
  static base::NoDestructor<LifetimeCallbacks> callbacks;
  return *callbacks;
}

base::CallbackListSubscription& ClosingAllBrowsersSubscription() {
  static base::NoDestructor<base::CallbackListSubscription> subscription;
  return *subscription;
}

void QuitCancelled() {
  if (g_phase == QuitPhase::kNone || g_phase == QuitPhase::kCancelling ||
      g_phase == QuitPhase::kExiting) {
    return;
  }
  // Not from inside Chrome's cancel path: the host may close or quit again right away. No new
  // quit starts until the host has heard this one ended (its willQuit, then this, in order).
  g_phase = QuitPhase::kCancelling;
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce([] {
        g_phase = QuitPhase::kNone;
        NotifyWindowsQuitCancelled();
        if (Callbacks().quit_cancelled) {
          Callbacks().quit_cancelled.Run();
        }
      }));
}

void StartQuit() {
  g_phase = QuitPhase::kClosing;
  // As -[AppController tryToTerminateApplication]: everything closes, beforeunload first; the
  // keep-alive goes only when the last Browser has (NSApplicationWillTerminateNotification).
  chrome::OnClosingAllBrowsers(true);
  chrome::CloseAllBrowsersAndQuit();
}

void Terminate() {
  if (g_phase != QuitPhase::kNone) {
    return;
  }
  id<NSApplicationDelegate> delegate = NSApp.delegate;
  if (![delegate respondsToSelector:@selector(applicationShouldTerminate:)]) {
    QuitEngine();
    return;
  }
  // Before asking: the host's prompts run nested loops, where another quit (the Dock, logout)
  // must find this one under way. If this one ended in such a loop (and another may have
  // started), the answer is about nothing any more.
  const int attempt = ++g_quit_generation;
  g_phase = QuitPhase::kAskingHost;
  const NSApplicationTerminateReply reply = [delegate applicationShouldTerminate:NSApp];
  if (attempt != g_quit_generation || g_phase != QuitPhase::kAskingHost) {
    return;
  }
  switch (reply) {
    case NSTerminateNow:
      g_phase = QuitPhase::kNone;
      QuitEngine();
      break;
    case NSTerminateLater:
      break;  // -replyToApplicationShouldTerminate: goes on.
    case NSTerminateCancel:
      QuitCancelled();
      break;
  }
}

}  // namespace

bool IsQuitting() {
  return g_phase != QuitPhase::kNone;
}

void SetLifetimeCallbacks(LifetimeCallbacks callbacks) {
  Callbacks() = std::move(callbacks);
}

void QuitEngine() {
  if (g_phase != QuitPhase::kNone || browser_shutdown::IsTryingToQuit()) {
    return;
  }
  const int generation = ++g_quit_generation;
  // Chrome's Mac close manager leaves the in-progress downloads prompt to AppController.
  const int downloads = DownloadCoreService::BlockingShutdownCountAllProfiles();
  if (downloads == 0) {
    StartQuit();
    return;
  }
  g_phase = QuitPhase::kAskingDownloads;
  ConfirmQuitWithDownloads(
      downloads, base::BindOnce(
                     [](int generation, bool quit_anyway) {
                       if (generation != g_quit_generation ||
                           g_phase != QuitPhase::kAskingDownloads) {
                         return;
                       }
                       if (quit_anyway) {
                         StartQuit();
                       } else {
                         QuitCancelled();
                       }
                     },
                     generation));
}

void StartLifetimeObservers() {
  // A page's beforeunload "stay" (and a declined downloads prompt in a Browser) ends with
  // UnloadController::CancelWindowClose, which reports closing=false here; the close manager
  // has already reset browser_shutdown's "trying to quit".
  ClosingAllBrowsersSubscription() =
      chrome::AddClosingAllBrowsersCallback(base::BindRepeating([](bool closing) {
        // Only while Chrome is closing for our quit: a window's own close being cancelled
        // during the downloads prompt is not the quit's.
        if (!closing && g_phase == QuitPhase::kClosing &&
            !browser_shutdown::IsTryingToQuit()) {
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
                g_phase = QuitPhase::kExiting;
                ReleaseAppKeepAlive();
                // With a remote-debugging port and no startup window Chrome also stays up
                // for the automation client until it says Browser.close.
                ChromeDevToolsManagerDelegate::AllowBrowserToClose();
              }];
}

}  // namespace arcadiacore

// --- AppKit overrides --------------------------------------------------------------------

// What +[AppController sharedController] answers under ArcadiaCore: not Chrome's AppController
// (which would make itself NSApp.delegate), but a stand-in for the few things //chrome asks
// it outside its own menus. Anything else it is sent answers zero/nil, as nil would.
@interface ACAppControllerStandIn : NSObject
@property(readonly, nonatomic) Profile* lastProfileIfLoaded;
@property(readonly, nonatomic) Profile* lastProfile;
- (const ui::ColorProvider&)lastActiveColorProvider;
- (BOOL)keyWindowIsModal;
@end

@implementation ACAppControllerStandIn
- (Profile*)lastProfileIfLoaded {
  return ProfileManager::GetLastUsedProfileIfLoaded();
}
- (Profile*)lastProfile {
  return ProfileManager::GetLastUsedProfileIfLoaded();
}
- (const ui::ColorProvider&)lastActiveColorProvider {
  // Chrome answers with its last active Browser window's; menus only need a valid one.
  return *ui::ColorProviderManager::Get().GetColorProviderFor(
      ui::NativeTheme::GetInstanceForNativeUi()->GetColorProviderKey(nullptr));
}
- (BOOL)keyWindowIsModal {
  return NSApp.keyWindow.sheet || NSApp.modalWindow != nil;
}
- (NSMethodSignature*)methodSignatureForSelector:(SEL)selector {
  return [super methodSignatureForSelector:selector]
             ?: [AppController instanceMethodSignatureForSelector:selector];
}
- (void)forwardInvocation:(NSInvocation*)invocation {
  // As a message to nil: no effect, a zero result.
  const NSUInteger length = invocation.methodSignature.methodReturnLength;
  if (length) {
    std::vector<char> zero(length, 0);
    [invocation setReturnValue:zero.data()];
  }
}
@end

namespace {

id StandInSharedController(id self, SEL _cmd) {
  static ACAppControllerStandIn* stand_in = [[ACAppControllerStandIn alloc] init];
  return stand_in;
}

void ACTerminate(id self, SEL _cmd, id sender) {
  arcadiacore::Terminate();
}

void ACCancelTerminate(id self, SEL _cmd, id sender) {
  // A beforeunload dialog's "Stay" during a quit (Chrome's app-modal dialog calls this).
  if (browser_shutdown::IsTryingToQuit()) {
    browser_shutdown::SetTryingToQuit(false);
  }
}

void ACReplyToApplicationShouldTerminate(id self, SEL _cmd, BOOL should_terminate) {
  // Only the answer to our own NSTerminateLater (nothing else asks the delegate: terminate: and
  // the quit Apple event come here); a reply nobody asked for is dropped.
  if (arcadiacore::g_phase != arcadiacore::QuitPhase::kAskingHost) {
    return;
  }
  if (should_terminate) {
    arcadiacore::g_phase = arcadiacore::QuitPhase::kNone;
    arcadiacore::QuitEngine();
  } else {
    arcadiacore::QuitCancelled();
  }
}

}  // namespace

// The Dock's Quit, logout, restart and `osascript … to quit` send kAEQuitApplication. AppKit's
// own handler asks NSApp.delegate itself (waiting in a nested loop on NSTerminateLater) and
// then sends -terminate:, which would ask again; this one goes straight to -terminate:, so the
// delegate is asked once, as for the Quit menu item. (Chrome's AppController never answers
// applicationShouldTerminate:, so Chrome's AppKit path asks nobody either.)
@interface ACQuitAppleEventHandler : NSObject
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply;
@end

@implementation ACQuitAppleEventHandler
- (void)handleQuitEvent:(NSAppleEventDescriptor*)event
              withReply:(NSAppleEventDescriptor*)reply {
  [NSApp terminate:nil];
}
@end

namespace arcadiacore {

namespace {
void InstallQuitAppleEventHandler() {
  static ACQuitAppleEventHandler* handler = [[ACQuitAppleEventHandler alloc] init];
  [NSAppleEventManager.sharedAppleEventManager
      setEventHandler:handler
          andSelector:@selector(handleQuitEvent:withReply:)
        forEventClass:kCoreEventClass
           andEventID:kAEQuitApplication];
}
}  // namespace

void InstallAppOverrides() {
  // +[AppController sharedController] would create Chrome's AppController and make it
  // NSApp.delegate. It answers a stand-in instead (-confirmQuitIfNeeded answers zero,
  // ConfirmQuitResultNotPrompted).
  Class app_controller = [AppController class];
  class_replaceMethod(object_getClass(app_controller), @selector(sharedController),
                      reinterpret_cast<IMP>(StandInSharedController), "@@:");
  // Cocoa's contract for terminate:, instead of Chrome's AppController.
  Class app = [BrowserCrApplication class];
  class_replaceMethod(app, @selector(terminate:), reinterpret_cast<IMP>(ACTerminate),
                      "v@:@");
  class_replaceMethod(app, @selector(cancelTerminate:),
                      reinterpret_cast<IMP>(ACCancelTerminate), "v@:@");
  class_replaceMethod(app, @selector(replyToApplicationShouldTerminate:),
                      reinterpret_cast<IMP>(ACReplyToApplicationShouldTerminate), "v@:c");
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

}  // namespace arcadiacore
