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

@class NNCoreEngine;
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
// Stage 2. Chrome's permission prompt for one of the host's tabs (camera, microphone,
// location, notifications…; Chrome answers remembered decisions itself). `request` is JS
// PermissionRequest without browserId: {id, origin, permissions:[PermissionKind…]}. Answer
// with -[NNCoreEngine resolvePermission:result:remember:].
- (void)engine:(NNCoreEngine*)engine
    permissionRequest:(NSDictionary<NSString*, id>*)request
                  tab:(NNCoreTab*)tab;
// The request went unanswered: the page navigated or closed, or Chrome replaced it.
- (void)engine:(NNCoreEngine*)engine permissionRequestDismissed:(NSString*)requestId;
// An extension opened or closed its side panel (chrome.sidePanel.open, its action set to
// open it) in one of the host's tabs: {extensionId, open}. The host shows it
// (-[NNCoreTab sidePanelURLForExtension:]).
- (void)engine:(NNCoreEngine*)engine
    extensionSidePanel:(NSDictionary<NSString*, id>*)panel
                   tab:(NNCoreTab*)tab;
// Chrome's extension install prompt ("Add <extension>?": the Web Store, an extension asking
// for more permissions, re-enabling one): JS ExtensionInstallPrompt without browserId,
// {requestId, profile, id, name, version, type, icon (PNG data: URL or ""), permissions}.
// `tab` is the asking page's, if any. Answer with
// +[NNCoreEngine resolveExtensionInstallPrompt:accepted:]. Without this, Chrome's dialog.
- (void)engine:(NNCoreEngine*)engine
    extensionInstallPrompt:(NSDictionary<NSString*, id>*)prompt
                       tab:(nullable NNCoreTab*)tab;
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
// Answers engine:permissionRequest:tab:. `result` is "accept" | "deny" | "dismiss".
// remember NO: an accept is one-time where Chrome supports it (camera, microphone,
// location), and a deny isn't kept (the site stays "ask").
- (void)resolvePermission:(NSString*)requestId
                   result:(NSString*)result
                 remember:(BOOL)remember;
+ (void)resolveExtensionInstallPrompt:(NSString*)requestId accepted:(BOOL)accepted;
// Chrome's tracing (chrome://tracing's default categories). end: keep writes
// "Netnyahoo Trace <date>.json" to Downloads and answers its path; else nil (discarded).
+ (void)beginTracing:(void (^)(BOOL started))completion;
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString* _Nullable path))completion;
@property(class, readonly) BOOL isTracing;
// Deletes a profile as Chrome's profile settings do (its Browsers close, its directory goes).
// NO for the default profile or an incognito one.
- (void)deleteProfile:(NNCoreProfile*)profile
           completion:(nullable void (^)(BOOL deleted))completion;
// An incognito profile is destroyed once nothing shows it (its data with it); no-op otherwise.
- (void)releaseProfile:(NNCoreProfile*)profile;
// Answers tab:externalAppRequest:. open: launch the app (through Chrome); remember: Chrome's
// "always allow" for that origin and scheme.
+ (void)resolveExternalApp:(NSString*)requestId open:(BOOL)open remember:(BOOL)remember;
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
// A component extension (Chrome's built-in kind; the manifest has a `key`, which fixes the
// id): runs hidden from chrome://extensions and the profile's list (CEF's
// LoadComponentExtension). Loading one already running from `path` is a no-op returning its
// id. nil on failure.
- (nullable NSString*)loadComponentExtension:(NSString*)path;
- (void)unloadComponentExtension:(NSString*)extensionId;
// chrome.management-style install of an unpacked extension (MV3 fine).
- (void)loadUnpackedExtension:(NSString*)path
                   completion:(void (^)(NSString* _Nullable extensionId,
                                        NSString* _Nullable error))completion;
// {id, name, version, enabled, actionPopupURL}
@property(readonly) NSArray<NSDictionary<NSString*, id>*>* extensions;
// Stage 2. Profile prefs the host owns: credentials_enable_service, autofill.profile_enabled,
// autofill.credit_card_enabled, download_bubble.partial_view_enabled (nil: not one of those).
// NNCore sets session.restore_on_startup = 5 (new tab) and turns the download bubble's
// partial view off on every profile it loads, as CEF did.
- (nullable NSNumber*)boolPreference:(NSString*)name;
- (void)setBoolPreference:(NSString*)name value:(BOOL)value;
// Chrome's BrowsingDataRemover: types "history" | "siteData" | "cache" | "downloads", from
// `since` (nil: all time) to now.
- (void)clearBrowsingData:(NSArray<NSString*>*)types
                    since:(nullable NSDate*)since
               completion:(nullable void (^)(void))completion;
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
// Stage 2.
- (void)tabDidChangeSecurity:(NNCoreTab*)tab;  // securityInfo changed
- (void)tabDidChangeZoom:(NNCoreTab*)tab;      // zoomFactor or pinchScale changed
// Chrome's popup blocker kept a popup this page asked for: JS BlockedPopup {id, url, origin}.
// -openBlockedPopup:always: opens it.
- (void)tab:(NNCoreTab*)tab didBlockPopup:(NSDictionary<NSString*, NSString*>*)popup;
// A link to another app (mailto:, zoommtg:…) where Chrome would ask "Open <app>?": JS
// ExternalAppRequest {id, url, scheme, origin, app, appPath, icon, title, message, remember}
// (app null: nothing on this Mac opens it; nothing to resolve then). Answer with
// +[NNCoreEngine resolveExternalApp:open:remember:].
- (void)tab:(NNCoreTab*)tab externalAppRequest:(NSDictionary<NSString*, id>*)request;
// Chrome asks to bring this tab forward: "pictureInPicture" (the PiP window's back-to-tab),
// "page" (window.focus()). Without this, Chrome activates it in its strip.
- (void)tab:(NNCoreTab*)tab requestsActivation:(NSString*)reason;
// The page's context menu is Chrome's own; the host adds items for a selection
// ([{id, title}], placed after Copy; not on editable fields) and runs them.
- (NSArray<NSDictionary<NSString*, NSString*>*>*)tab:(NNCoreTab*)tab
                         contextMenuItemsForSelection:(NSString*)text;
// modifiers: {metaKey, shiftKey, altKey} held when the item was picked.
- (void)tab:(NNCoreTab*)tab
    contextMenuCommand:(NSString*)itemId
                  text:(NSString*)selection
             modifiers:(NSDictionary<NSString*, NSNumber*>*)modifiers;
// Background mode (NETNYAHOO_BACKGROUND set): the menu is reported here instead of shown:
// [{id, label, enabled, separator}].
- (void)tab:(NNCoreTab*)tab didShowContextMenu:(NSArray<NSDictionary*>*)items;
// A main-frame navigation became a download (the page stays; Chrome downloads it).
- (void)tab:(NNCoreTab*)tab navigationBecameDownload:(NSString*)url;
// Lifecycle.
- (void)tabDidChangeDiscarded:(NNCoreTab*)tab;
- (void)tabBecameUnresponsive:(NNCoreTab*)tab;  // answer with -resolveUnresponsive:
- (void)tabBecameResponsive:(NNCoreTab*)tab;
// What the page captures now: JS MediaAccess {camera, microphone, screen}.
- (void)tab:(NNCoreTab*)tab didChangeMediaAccess:(NSDictionary<NSString*, NSNumber*>*)access;
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
- (void)close;  // beforeunload first (the page may keep the tab)
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
// Closes the tab at once, without beforeunload (CEF's CloseBrowser(true)): didRemoveTab:,
// never tabWillClose:.
- (void)closeNow;
// [{url, title, current}] of the back/forward list.
@property(readonly) NSArray<NSDictionary<NSString*, id>*>* navigationEntries;
// Runs `code` in the main frame's main world. Fire and forget.
- (void)executeJavaScript:(NSString*)code;
// The same, as if the user had just interacted with the page (a transient activation:
// requestPictureInPicture, fullscreen, window.open… need one), as CEF's EvaluateWithGesture.
- (void)executeJavaScript:(NSString*)code userGesture:(BOOL)userGesture;
// The same in one frame (a frameId from tab:didReceivePageMessage:json:frame:main:), e.g. a
// blocked popup's window.open replayed from the frame that asked.
- (void)executeJavaScript:(NSString*)code frame:(NSString*)frameId;
// Runs `code` as the body of `function(post){'use strict'; …}` in the main frame's main world;
// the first post("result", json) answers. nil json: no answer (no frame, an exception).
- (void)evaluate:(NSString*)code completion:(void (^)(NSString* _Nullable json))completion;
- (void)evaluate:(NSString*)code
     userGesture:(BOOL)userGesture
      completion:(void (^)(NSString* _Nullable json))completion;
// The page script's receive(kind, json) in the main frame.
- (void)callPage:(NSString*)kind json:(NSString*)json;

// Stage 2.
// JS SecurityInfo (packages/cef/src/WebView.tsx): {level, url, origin, protocol?, certificate?,
// certificateErrors?, mixedContent?, isEV?}.
@property(readonly) NSDictionary<NSString*, id>* securityInfo;
// Chrome's per-site zoom (HostZoomMap, as Chrome's menu), 1 = 100 %.
@property(nonatomic) double zoomFactor;
// Chrome's preset zoom levels: > 0 in, < 0 out, 0 reset.
- (void)zoomStep:(int)direction;
@property(readonly) double pinchScale;  // the page's pinch-zoom scale (1 = none)
// One of Chrome's commands (chrome/app/chrome_command_ids.h) on this tab, as its menu item
// would run it: IDC_PRINT, IDC_BASIC_PRINT, IDC_SAVE_PAGE, IDC_CARET_BROWSING_TOGGLE… A
// background tab is made active for the moment, unreported. NO if it is disabled.
- (BOOL)executeChromeCommand:(int)command;
// Opens a popup tab:didBlockPopup: reported, as Chrome kept it (POST body, opener): it
// arrives through window:didInsertTab:… with this tab as its opener. always: allow popups for
// the page's site from now on (Chrome's content setting).
- (void)openBlockedPopup:(NSString*)popupId always:(BOOL)always;
// Chrome's tab discard: the page's memory goes, the tab (this object, its history) stays and
// reloads when used again. NO if Chrome won't (already discarded…).
- (BOOL)discard;
@property(readonly) BOOL discarded;
// Freezes the page (timers, loading) while YES (WebContents::SetPageFrozen).
@property(nonatomic) BOOL frozen;
// Answers tabBecameUnresponsive:: YES ends the page's renderer (sad tab, rendererGone), NO
// waits (asked again if it stays hung).
- (void)resolveUnresponsive:(BOOL)terminate;
// The page's base background (before it paints its own), e.g. the app's theme; nil: Chrome's.
@property(nonatomic, nullable) NSColor* pageBackgroundColor;
// Extensions. Runs the extension's action as a click on its toolbar button would (grants
// activeTab): "none", "popup" (show it: -openActionPopupForExtension:anchor:) or "sidePanel".
- (NSString*)executeExtensionAction:(NSString*)extensionId;
// {extensionId: JS ActionState {title, badgeText, badgeColor, badgeTextColor, popup, enabled,
// icon (a PNG data: URL)}} for this tab.
- (NSDictionary<NSString*, NSDictionary*>*)actionStatesForExtensions:(NSArray<NSString*>*)extensionIds;
- (nullable NSString*)sidePanelURLForExtension:(NSString*)extensionId;
// The id a capture of this tab uses (getDisplayMedia's tab source), as CEF's
// CefGetMediaCaptureSourceId. nil without a live page.
@property(readonly, nullable) NSString* mediaCaptureSourceId;
// Chrome's "Stop sharing" for what this page is sharing (a tab, window or screen). NO if it
// shares nothing.
- (BOOL)stopCapture;
// Chrome's autofill dropdown at the page's focused field, now (CEF's
// CefShowAutofillSuggestions): passwords: the saved-passwords list. NO without a field.
- (BOOL)showAutofillSuggestions:(BOOL)passwords;
// Whether the page's focused element takes text now (Esc in a text field is the page's).
@property(readonly) BOOL focusedEditable;
// The same in one frame (a frameId from tab:didReceivePageMessage:json:frame:main:).
- (void)callFrame:(NSString*)frameId kind:(NSString*)kind json:(NSString*)json;
@end

NS_ASSUME_NONNULL_END
