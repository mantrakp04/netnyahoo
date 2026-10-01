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
// A quit was cancelled (a page's beforeunload, the downloads prompt): the app keeps running.
- (void)engineQuitCancelled;
// Chrome is creating a Browser the host didn't ask for (chrome.windows.create, an incognito
// window from a Chrome command, undocked DevTools, document Picture in Picture). `type` is
// "normal", "popup", "devtools", "picture_in_picture" or "app". Return a window to hold it
// (its tabs then arrive through window:didInsertTab:…), or nil for Chrome's own Views window.
// Called while Chrome builds the Browser: make or pick the window and return, nothing more. A
// window that is closing, or already holds a Browser of `profile`, can't take it (Chrome's
// own window then).
- (nullable NNCoreWindow*)engineWindowForNewBrowserOfProfile:(NNCoreProfile*)profile
                                                        type:(NSString*)type;
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
// Cancellable: a page that cancels its beforeunload keeps the app (and its keep-alive) running,
// and the delegate gets engineQuitCancelled.
//
// -[NSApp terminate:] (the Quit menu item, the Dock, logout, AppleScript) follows Cocoa's
// contract: NNCore asks NSApp.delegate's applicationShouldTerminate: (NSTerminateLater waits
// for -replyToApplicationShouldTerminate:) and quits through -quit on YES. Chrome's
// AppController is never created, so it can't take over NSApp.delegate.
- (void)quit;
// The page script every frame's main world runs at document start (before the page's own
// scripts). It is evaluated as an expression that returns `function(post)`: the engine calls
// it with `post(kind, json)` and keeps what it returns, `receive(kind, json)`, for
// -[NNCoreTab callPage:json:]. Set it before the first tab opens; renderers launched later
// get the current value.
@property(nonatomic, copy, nullable) NSString* pageScript;
// The off-the-record profile of `profile` (created on first use): incognito windows.
- (NNCoreProfile*)offTheRecordProfileFor:(NNCoreProfile*)profile;
@property(readonly) NSString* chromiumVersion;
// What keeps the app alive (Chrome's KeepAliveRegistry), for diagnostics.
@property(readonly) NSString* keepAliveState;
@end

// --- Profiles ---------------------------------------------------------------------------

NNCORE_EXPORT
@interface NNCoreProfile : NSObject
@property(readonly) NSString* name;  // the directory name
@property(readonly) NSString* path;
@property(readonly) BOOL offTheRecord;
// The Profile went (shutdown, profile deletion): every call is then a no-op.
@property(readonly) BOOL destroyed;
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
// The user asked the NSWindow itself to close (the title bar's close button, -performClose:),
// not -[NNCoreWindow close]. NO keeps the window (the host may ask its UI first, then call
// -close itself); YES (or no delegate) runs -close. Views never closes the window under
// the Browsers on that path.
- (BOOL)windowShouldClose:(NNCoreWindow*)window;
// -close (or the quit) was cancelled: a page's beforeunload said stay, or the host declined
// the downloads prompt. The window and its Browsers stay as they were.
- (void)windowDidCancelClose:(NNCoreWindow*)window;
// Closing would cancel `count` downloads in flight. Answer YES to close anyway. Without this,
// the window closes.
- (void)window:(NNCoreWindow*)window
    confirmCloseWithDownloads:(int)count
                   completion:(void (^)(BOOL closeAnyway))completion;
// Keys. Before the page sees a key down: YES if the host handled it (a reserved shortcut its
// menu owns, e.g. ⌘T, ⌘W, ⌘N, ⌘Q, ⌃Tab), and the page never gets it.
- (BOOL)window:(NNCoreWindow*)window preHandleKeyEvent:(NSEvent*)event;
// A key the page didn't handle (no preventDefault): YES if the host did (its main menu's key
// equivalents, say). Without this, unhandled keys go to NSApp.mainMenu.
- (BOOL)window:(NNCoreWindow*)window handleKeyEvent:(NSEvent*)event;
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
// Closes every Browser (beforeunload first). Cancellable: see windowDidCancelClose:.
- (void)close;

// Stage 1 additions.
// The NNCoreWindow whose NSWindow this is (nil for other windows).
+ (nullable NNCoreWindow*)windowForNSWindow:(NSWindow*)window;
// Creates the profile's Browser in this window now (paging between profiles stays a view swap).
- (void)prepareProfile:(NNCoreProfile*)profile;
// Moves a live tab (with its WebContents, history and opener) into this window's Browser for
// its profile, at the end. No-op if it is already here.
- (void)adoptTab:(NNCoreTab*)tab;
// Chrome's tab-strip index and pin state for a tab of this window (the host's order).
- (void)placeTab:(NNCoreTab*)tab index:(int)index pinned:(BOOL)pinned;
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
// Stage 1 additions.
// The main frame's post(kind, json).
- (void)tab:(NNCoreTab*)tab didReceivePageMessage:(NSString*)kind json:(NSString*)json;
// Every frame's post(kind, json) (implement this one instead of the above to hear subframes:
// it replaces it). `frameId` names the frame for -callFrame:kind:json:.
- (void)tab:(NNCoreTab*)tab
    didReceivePageMessage:(NSString*)kind
                     json:(NSString*)json
                    frame:(NSString*)frameId
                     main:(BOOL)main;
// window.close(), or Chrome closing the tab itself (not -close from the host).
- (void)tabWillClose:(NNCoreTab*)tab;
// The renderer went away: status is "crashed", "killed", "oom", "abnormal", "launchFailed"…
- (void)tab:(NNCoreTab*)tab rendererGone:(NSString*)status code:(int)code;
- (void)tab:(NNCoreTab*)tab didFailLoad:(NSString*)url code:(int)code description:(NSString*)text;
- (void)tab:(NNCoreTab*)tab didChangeStatusText:(NSString*)text;  // hovered link
// A page of Chrome's (chrome:, devtools:) navigated its main frame to, or opened, an app URL
// (netnyahoo:…). NNCore cancelled it; the host routes it (as `openWindow` with disposition
// "current" in the app). Web pages' netnyahoo: navigations are dropped silently.
- (void)tab:(NNCoreTab*)tab didRequestAppURL:(NSString*)url userGesture:(BOOL)userGesture;
- (void)tabDidChangeThemeColor:(NNCoreTab*)tab;
- (void)tabDidGainFocus:(NNCoreTab*)tab;
- (void)tabDidChangeAudio:(NNCoreTab*)tab;
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

// Stage 1 additions.
@property(readonly, nullable) NSString* faviconURL;  // the favicon's own URL
@property(readonly, nullable) NSString* themeColor;  // #rrggbb from <meta name=theme-color>
@property(readonly) BOOL audible;
@property(nonatomic) BOOL muted;
@property(readonly) int browserId;  // stable per tab for the app's lifetime (never reused)
- (void)loadURL:(NSString*)url userInitiated:(BOOL)userInitiated;
- (void)goToOffset:(int)offset;
- (void)reloadIgnoringCache;
// [{url, title, current}] of the back/forward list.
@property(readonly) NSArray<NSDictionary<NSString*, id>*>* navigationEntries;
// Runs `code` in the main frame's main world. Fire and forget.
- (void)executeJavaScript:(NSString*)code;
// The same in one frame (a frameId from tab:didReceivePageMessage:json:frame:main:), e.g. a
// blocked popup's window.open replayed from the frame that asked.
- (void)executeJavaScript:(NSString*)code frame:(NSString*)frameId;
// Runs `code` as the body of `function(post){'use strict'; …}` in the main frame's main world;
// the first post("result", json) answers. nil json: no answer (no frame, an exception).
- (void)evaluate:(NSString*)code completion:(void (^)(NSString* _Nullable json))completion;
// The page script's receive(kind, json) in the main frame.
- (void)callPage:(NSString*)kind json:(NSString*)json;
// The same in one frame (a frameId from tab:didReceivePageMessage:json:frame:main:).
- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json;
@end

NS_ASSUME_NONNULL_END
