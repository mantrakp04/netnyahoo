// NNCore: the API a host app (the RN app's native modules, or a plain AppKit app) uses to
// drive Chromium. Plain Objective-C, no C++ in this header: the host never sees Chrome's
// types. Everything runs on the main thread, inside Chromium's own run loop.
//
// The shape follows Dia's ArcCore (ArcBrowser, ArcBrowserContext*): Chrome owns the live
// tabs (its Browser and TabStripModel), the host owns the workspace and the chrome around
// them, and every change Chrome makes on its own (a popup, an extension moving a tab, a
// close picking the next tab) is reported back with the tab it concerns.

#import <AppKit/AppKit.h>

// The framework hides everything but what it exports (nncore.exports).
#define NNCORE_EXPORT __attribute__((visibility("default")))

NS_ASSUME_NONNULL_BEGIN

@class NNCoreProfile;
@class NNCoreTab;
@class NNCoreWindow;

// --- Engine -----------------------------------------------------------------------------

@protocol NNCoreEngineDelegate <NSObject>
// The browser process is up: profiles, services, extensions. Create windows from here on.
- (void)engineDidStart;
@optional
// Chromium is about to return from its run loop (quit finished).
- (void)engineWillShutDown;
@end

NNCORE_EXPORT
@interface NNCoreEngine : NSObject
// Runs Chromium (ChromeMain) on the calling thread with `delegate`; returns its exit code when
// the app quits. Helper processes take the same path and never call the delegate. Extra
// switches the host always wants (no startup window, the data dir) are added here.
+ (int)runWithArgc:(int)argc
              argv:(const char* _Nonnull* _Nonnull)argv
          delegate:(id<NNCoreEngineDelegate>)delegate;
@property(class, readonly, nullable) NNCoreEngine* sharedEngine;

@property(readonly) NNCoreProfile* defaultProfile;
// Loads (creating if needed) the profile in `directoryName` under the data dir.
- (void)loadProfile:(NSString*)directoryName
         completion:(void (^)(NNCoreProfile* _Nullable profile))completion;
// Chrome's own quit: beforeunload, downloads, then every Browser closes and the loop ends.
- (void)quit;
@property(readonly) NSString* chromiumVersion;
// What keeps the app alive (Chrome's KeepAliveRegistry), for diagnostics.
@property(readonly) NSString* keepAliveState;
@end

// --- Profiles ---------------------------------------------------------------------------

NNCORE_EXPORT
@interface NNCoreProfile : NSObject
@property(readonly) NSString* name;  // the directory name
@property(readonly) NSString* path;
// chrome.management-style install of an unpacked extension (MV3 fine).
- (void)loadUnpackedExtension:(NSString*)path
                   completion:(void (^)(NSString* _Nullable extensionId,
                                        NSString* _Nullable error))completion;
// {id, name, version, enabled, actionPopupURL}
@property(readonly) NSArray<NSDictionary<NSString*, id>*>* extensions;
// Chrome's password store, for checks: [{origin, username}]
- (void)fetchSavedLogins:(void (^)(NSArray<NSDictionary<NSString*, NSString*>*>* logins))completion;
@end

// --- Windows ----------------------------------------------------------------------------

@protocol NNCoreWindowDelegate <NSObject>
@optional
// A tab entered this window's live set: one the host opened, or one Chrome made (a popup,
// target=_blank, ⌘-click, an extension's tabs.create). `opener` is the tab that opened it.
// `disposition` is Chrome's: "foreground_tab", "background_tab", "popup", "window"…
- (void)window:(NNCoreWindow*)window
    didInsertTab:(NNCoreTab*)tab
          opener:(nullable NNCoreTab*)opener
     disposition:(NSString*)disposition;
- (void)window:(NNCoreWindow*)window didRemoveTab:(NNCoreTab*)tab;
// Chrome committed a new active tab for a profile (a close picked the next tab, an
// extension activated one, the host asked).
- (void)window:(NNCoreWindow*)window didActivateTab:(NNCoreTab*)tab;
// Docked DevTools for `tab` appeared (view non-nil) or went (nil). Lay them out with
// -[NNCoreTab devToolsLayoutForSize:devTools:page:].
- (void)window:(NNCoreWindow*)window
    devToolsDidChangeForTab:(NNCoreTab*)tab
                       view:(nullable NSView*)devToolsView;
// The page entered or left tab fullscreen (element.requestFullscreen()). Chrome only
// tracks the state; the host shows the page full screen (or not) itself.
- (void)window:(NNCoreWindow*)window
                    tab:(NNCoreTab*)tab
    didChangeFullscreen:(BOOL)fullscreen;
// Chrome wants to offer to save a password; the host shows its own UI and answers on the tab.
- (void)window:(NNCoreWindow*)window
    passwordSavePromptForTab:(NNCoreTab*)tab
                    username:(NSString*)username
                      origin:(NSString*)origin;
@end

// One NSWindow. It holds one Chrome Browser per profile shown in it (so chrome.windows sees
// a window per profile), all attached to this single native window: switching profiles is
// a view swap, never a window swap. The NSWindow is a Views widget, so Chrome's own
// bubbles, sheets and popups (autofill, passkeys, permission prompts) attach to it.
NNCORE_EXPORT
@interface NNCoreWindow : NSObject
- (instancetype)initWithContentRect:(NSRect)rect;
@property(readonly) NSWindow* window;
// The host's root view; it fills the window and is hit-tested before Chrome's views.
@property(readonly) NSView* hostView;
@property(weak, nullable) id<NNCoreWindowDelegate> delegate;

- (NNCoreTab*)openTab:(NSString*)url
              profile:(NNCoreProfile*)profile
           foreground:(BOOL)foreground;
// The profile whose Browser is current (focus, chrome.windows' currentWindow, keys).
@property(nonatomic, nullable) NNCoreProfile* activeProfile;
- (void)activateTab:(NNCoreTab*)tab;
- (NSArray<NNCoreTab*>*)tabsForProfile:(NNCoreProfile*)profile;
// The chrome.windows id of the profile's Browser in this window (-1: none yet).
- (int)chromeWindowIdForProfile:(NNCoreProfile*)profile;
// Runs one of Chrome's commands (chrome/app/chrome_command_ids.h, e.g. IDC_FIND) in the
// profile's Browser, as its menu item or shortcut would. NO if it is disabled.
- (BOOL)executeChromeCommand:(int)commandId profile:(NNCoreProfile*)profile;
- (void)showInactive;
- (void)close;
@end

// --- Tabs -------------------------------------------------------------------------------

@protocol NNCoreTabDelegate <NSObject>
@optional
- (void)tabDidChangeTitle:(NNCoreTab*)tab;
- (void)tabDidChangeURL:(NNCoreTab*)tab;
- (void)tabDidChangeLoading:(NNCoreTab*)tab;
- (void)tabDidChangeProgress:(NNCoreTab*)tab;
- (void)tabDidChangeFavicon:(NNCoreTab*)tab;
- (void)tabDidChangeNavigationState:(NNCoreTab*)tab;  // canGoBack / canGoForward
- (void)tab:(NNCoreTab*)tab didFindMatches:(int)count active:(int)active final:(BOOL)final;
@end

NNCORE_EXPORT
@interface NNCoreTab : NSObject
@property(readonly) NSView* view;  // the page; the host places it
@property(readonly, weak) NNCoreProfile* profile;
@property(readonly) int tabId;  // chrome.tabs id
@property(readonly) NSString* url;
@property(readonly) NSString* title;
@property(readonly) BOOL loading;
@property(readonly) double progress;
@property(readonly, nullable) NSImage* favicon;
@property(readonly) BOOL canGoBack;
@property(readonly) BOOL canGoForward;
@property(readonly) BOOL closed;
@property(weak, nullable) id<NNCoreTabDelegate> delegate;

- (void)loadURL:(NSString*)url;
// Keyboard focus to the page (its view becomes the window's first responder).
- (void)focus;
// Chrome's find in page (FindTabHelper); results come back as tabDidFind….
- (void)find:(NSString*)text forward:(BOOL)forward;
- (void)stopFinding;
- (void)goBack;
- (void)goForward;
- (void)reload;
- (void)stop;
- (void)close;
- (void)showDevTools;  // docked in the tab's window
- (void)closeDevTools;
@property(readonly, nullable) NSView* devToolsView;  // while docked
// Chrome's split for docked DevTools in an area of `size` (top-left origin rects).
- (void)devToolsLayoutForSize:(NSSize)size
                     devTools:(NSRect*)devToolsFrame
                         page:(NSRect*)pageFrame;
// Answers a passwordSavePromptForTab: callback.
- (void)savePendingPassword;
- (void)dismissPendingPassword;
// Opens the extension's action popup (Chrome's ExtensionViewHost) in a panel attached to
// the tab's window, under `anchor` (window coordinates). Returns NO if it has no popup.
- (BOOL)openActionPopupForExtension:(NSString*)extensionId anchor:(NSRect)anchor;
@end

NS_ASSUME_NONNULL_END
