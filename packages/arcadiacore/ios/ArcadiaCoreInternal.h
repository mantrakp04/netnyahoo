// What the ArcadiaCore module's files share. ArcadiaCore.h is the engine's API (engine/arcadiacore/src/arcadia/core/public);
// it stays out of the pod's public headers, so Swift sees only ArcadiaCoreHost.h and ArcadiaCoreWebView.h.
#import <AppKit/AppKit.h>

#import "ArcadiaCore.h"
#import "ArcadiaCoreHost.h"
#import "ArcadiaCoreTabStrip.h"

@class ArcadiaCoreWebView;

NS_ASSUME_NONNULL_BEGIN

// MARK: Profiles
// The app names profiles as packages/cef does: "" is Chrome's default profile ("Default"), "<id>" is
// "Profile <id>", and "incognito:<window>@<name>" is the off-the-record profile of the regular profile <name> (one per
// private window's name, the same profile for every private window of <name>; "incognito…" with no "@": Personal's).
namespace arcadiacore_host {

ArcadiaCoreProfile *_Nullable LoadedProfile(NSString *name);
// Being deleted (+deleteProfileData:), or deleted: loaded perhaps, but going.
bool IsDeletedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(ArcadiaCoreProfile *_Nullable profile));
NSString *ProfileName(ArcadiaCoreProfile *_Nullable profile);
ArcadiaCoreProfile *_Nullable PersonalIfLoaded(ArcadiaCoreEngine *engine);
bool IsIncognito(NSString *name);
// The regular profile a name is, or is off the record of: a private name's original ("" for Personal).
NSString *OriginalProfileName(NSString *_Nullable name);
NSString *OriginalProfileNameOf(ArcadiaCoreProfile *_Nullable profile);
// Whether `profile` is the off-the-record profile the private name `name` stands for (its original's).
bool IsOffTheRecordOf(ArcadiaCoreProfile *_Nullable profile, NSString *_Nullable name);
// The names the app has a live profile for (several private names may share one).
NSArray<NSString *> *LoadedProfileNames();

// A stable id per tab for the app's lifetime (the WebView's browserId).
int BrowserId(ArcadiaCoreTab *tab);
ArcadiaCoreTab *_Nullable TabWithBrowserId(int browserId);

// What the engine's dispositions mean to the app (OpenWindowRequest.disposition).
NSString *AppDisposition(NSString *chromeDisposition);

// Background test instances (ARCADIA_BACKGROUND=1): no activation, menus or panels (ArcadiaCoreActivation.mm).
void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();
// A line in $ARCADIA_DATA_DIR/activation.log, as the guards write theirs (what a test instance didn't show).
void LogActivation(NSString *what);
// Test instances: whether the app reads as active (it does unless a check says otherwise); AppKit's key window follows.
void SetAppActive(bool active);
// Test instances: -toggleFullScreen: (the menu's Enter Full Screen, the green button) acted out, never a real Space.
void ActToggleFullScreen(NSWindow *window);
// A hidden test instance (dataDir non-nil) that crashes leaves its record in <dataDir>/crashes and exits, never
// reaching macOS's crash reporter, whose "quit unexpectedly" dialog would show on the owner's screen.
void InstallTestCrashGuard(NSString *_Nullable dataDir);

// A page's sized popup (window.open with a size or position: disposition "popup") in a window of its own, as
// packages/cef's ACPopupWindow: the live tab (opener kept), sized and placed as asked; what it opens goes to the
// opener's tab (ArcadiaCoreChromeWindow.mm).
void OpenPopupWindow(ArcadiaCoreTab *tab, ArcadiaCoreWebView *_Nullable opener);
NSUInteger PopupWindowCount();

}  // namespace arcadiacore_host

// MARK: Windows
// One per ArcadiaCoreWindow: its delegate, and the app's root view in it.
@interface ArcadiaCoreWindowController : NSObject <ArcadiaCoreWindowDelegate>
+ (nullable ArcadiaCoreWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<ArcadiaCoreWindowController *> *)all;
@property(nonatomic, readonly) ArcadiaCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
// The host itself is changing Chrome's tab strip (opening, activating, placing a tab): reports it causes
// are the app's own (TabStripPlace.byApp).
@property(nonatomic) NSInteger hostChanges;
// A hidden window holding a Browser Chrome made itself (chrome.windows.create): its tabs are handed to the app's
// windows as tab:<id>, and it closes once empty.
+ (ArcadiaCoreWindowController *)strayWindowForProfile:(ArcadiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL stray;
// The hidden window holding a profile's standalone WebViews' tabs (extension popups and side panels): CEF made
// those as browsers outside Chrome's tab strip, so they stay out of the app windows' Browsers and strips.
+ (ArcadiaCoreWindowController *)standaloneWindowForProfile:(ArcadiaCoreProfile *)profile;
@property(nonatomic, readonly) BOOL standalone;
// Tabs the app asked to close that are still in Chrome's strip (beforeunload, the close in flight): the active tab
// Chrome picks after them is the app's change too, not a switch (TabStripPlace.byApp).
- (void)noteClosing:(ArcadiaCoreTab *)tab;
// The window whose Browser holds `tab` now (nil if none of ours).
+ (nullable ArcadiaCoreWindowController *)holding:(ArcadiaCoreTab *)tab;
// An app view to hand a tab Chrome made to: one shown for `profile`, else any (nil profile: any); a private profile's
// only to a view of its own.
+ (nullable ArcadiaCoreWebView *)hostingViewForProfile:(nullable ArcadiaCoreProfile *)profile;
// Whether the user sees `window`: not covered or left for another app; its own full-screen transitions never count
// (ACWindowFullScreen, ArcadiaCoreChromeWindow.mm). ArcadiaCoreWindowSeenDidChange (object: the window) tells of each change.
+ (BOOL)userSees:(nullable NSWindow *)window;
@end
extern NSNotificationName const ArcadiaCoreWindowSeenDidChange;

@interface ArcadiaCoreTabStrip (Engine)
// A strip changed (a tab inserted, removed, activated or placed); the cause is the command being run, the app's
// own change (hostChanges) or Chrome's.
+ (void)changedInWindow:(ArcadiaCoreWindowController *)controller profile:(ArcadiaCoreProfile *)profile;
// With an explicit cause (NSNull: Chrome's, e.g. a view binding its key to a tab Chrome made).
+ (void)changedInWindow:(ArcadiaCoreWindowController *)controller profile:(ArcadiaCoreProfile *)profile cause:(nullable id)cause;
// The window went: its strips are sent once more, closed.
+ (void)windowClosed:(ArcadiaCoreWindowController *)controller;
// Chrome made `tab` its strip's active one (didActivateTab:): what the strip reports as active.
+ (void)activated:(ArcadiaCoreTab *)tab inWindow:(ArcadiaCoreWindowController *)controller;
+ (void)setPinned:(BOOL)pinned tab:(ArcadiaCoreTab *)tab;
@end

// Asked of the engine (stage 2, A0); used with respondsToSelector:.
@interface ArcadiaCoreProfile (Pending)
- (nullable NSString *)loadComponentExtension:(NSString *)path;
@end

namespace arcadiacore_host {
NSArray<ArcadiaCoreProfile *> *LoadedProfiles();
// Loads the built-in content blocker into a profile Chrome just loaded (ArcadiaCoreContentBlocker.mm).
void LoadContentBlocker(NSString *profile);
// Starts making the blocker's writable copy (at launch, off the main thread).
void PrepareContentBlocker();
// The engine has stage 1's tab model (adoptTab:, tabWillClose:…); older engines report closes only as removals.
bool EngineHasTabModel();
}

// MARK: Tabs
// Which WebView hosts which tab, and tabs Chrome opened that wait for the app to adopt them.
@interface ArcadiaCoreTabs : NSObject
+ (void)setView:(nullable ArcadiaCoreWebView *)view forTab:(ArcadiaCoreTab *)tab;
+ (nullable ArcadiaCoreWebView *)viewForTab:(ArcadiaCoreTab *)tab;
// The app's adoptId for a tab Chrome made ("arcadiacore:<browserId>"); kept until adopted, closed if never.
+ (NSString *)offerTab:(ArcadiaCoreTab *)tab;
// A tab Chrome made with no page opener (an extension's tabs.create): offered as "tab:<browserId>".
+ (NSString *)offerTab:(ArcadiaCoreTab *)tab prefix:(NSString *)prefix;
+ (nullable ArcadiaCoreTab *)takeOffered:(NSString *)adoptId;
+ (void)forget:(ArcadiaCoreTab *)tab;
@end

@interface ArcadiaCoreFavicons (Tabs)
// A tab of `profile` showed this favicon: fetch() for its URL in that profile uses it instead of downloading it again.
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url profile:(nullable NSString *)profile;
@end

NS_ASSUME_NONNULL_END
