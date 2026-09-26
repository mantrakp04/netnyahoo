#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

/// The NSApplication subclass CEF requires (CefAppProtocol). main.swift must
/// create it (`NNApplication.shared`) before anything touches NSApp.
@interface NNApplication : NSApplication
@end

typedef void (^NNEventHandler)(NSString *name, NSDictionary<NSString *, id> *payload);

/// Process-wide CEF lifecycle, profiles, downloads and permission prompts.
@interface NNCef : NSObject

/// Loads the framework and initializes CEF. Returns NO if the process should
/// exit (another instance owns the profile directory, or CEF failed to start).
+ (BOOL)startWithArgc:(int)argc argv:(char *_Nullable *_Nonnull)argv;
/// Closes every browser and shuts CEF down. Safe to call more than once.
+ (void)shutdown;
@property (class, nonatomic, readonly) BOOL isStarted;

/// Global events: "download", "permission", "permissionDismissed",
/// "contentBlocker" (its settings changed). Set by the Expo module.
@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;

/// getDisplayMedia() asks the app for a source ("displayMediaRequest" event)
/// instead of sharing the whole main screen. Off until the app has a picker.
@property (class, nonatomic) BOOL displayMediaPicker;
/// [{id, kind: "screen"|"window", name, app?, pid?, width, height}].
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *displayMediaSources;

/// {pid, dataDirectory, cefVersion, chromiumVersion, liveBrowsers, popupWindows, chromeWindows,
/// chromeTabs (tabs are Chrome's own, NNWindowHost.h), tabCapture (the engine can share a single
/// tab: `mediaCaptureSourceId`)}.
@property (class, nonatomic, readonly) NSDictionary<NSString *, id> *engineInfo;
/// DEV: each Chrome-hosted window's state (NNWindowHost.h).
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *chromeWindows;
/// DEV: input and window actions on an app window: "click:x,y", "frame:x,y,w,h", "active:1|0"… (NNWindowHost.h).
+ (NSString *)devWindow:(NSInteger)windowNumber action:(NSString *)action NS_SWIFT_NAME(devWindow(_:action:));

+ (void)cancelDownload:(NSString *)downloadId;
+ (void)pauseDownload:(NSString *)downloadId;
+ (void)resumeDownload:(NSString *)downloadId;

/// Answers a "permission" event. `result`: "accept" | "deny" | "dismiss".
/// `remember` stores the decision for the origin (no prompt next time);
/// otherwise it lasts until the tab leaves the origin.
+ (void)resolvePermission:(NSString *)requestId result:(NSString *)result remember:(BOOL)remember
    NS_SWIFT_NAME(resolvePermission(_:result:remember:));

/// Deletes a profile's browsing data ("" = default profile) since `sinceMs` (ms since 1970; 0 =
/// all time). `types`: "history" (the engine's own history), "siteData" (cookies and every kind
/// of site storage), "cache", "downloads" (the engine's download history).
+ (void)clearBrowsingDataForProfile:(NSString *)profile
                              types:(NSArray<NSString *> *)types
                              since:(double)sinceMs
                         completion:(void (^)(void))completion
    NS_SWIFT_NAME(clearBrowsingData(profile:types:since:completion:));
/// Drops an ephemeral (incognito) profile's in-memory context.
+ (void)releaseProfile:(NSString *)profile;
/// The on-disk root for all profiles (Application Support/<bundle id>/Chromium).
@property (class, nonatomic, readonly) NSString *rootCachePath;

@end

@interface NNCef (ContextMenu)
/// The default search engine's name, for the page menu's "Search <name> for “…”".
@property (class, nonatomic, copy) NSString *searchEngineName;
@end

@interface NNCef (Components)
/// Chromium components (e.g. Widevine CDM "oimompecagnajdejgnnjijobebaeigek"):
/// [{id, name, version, state}].
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *components;
@end

@interface NNCef (Diagnostics)
/// Starts a Chromium trace of every process (like chrome://tracing). NO if one is running.
+ (void)beginTracing:(void (^)(BOOL started))completion NS_SWIFT_NAME(beginTracing(_:));
/// Stops the trace; `keep` writes "Netnyahoo Trace <date>.json" to Downloads and
/// passes its path, otherwise it's discarded (nil).
+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *_Nullable path))completion
    NS_SWIFT_NAME(endTracing(keep:completion:));
@property (class, nonatomic, readonly) BOOL isTracing;
/// Chromium's task manager: [{id, type, title, killable, cpu, processors, memory, gpuMemory, browserIds}].
@property (class, nonatomic, readonly) NSArray<NSDictionary<NSString *, id> *> *tasks;
+ (BOOL)killTask:(int64_t)taskId NS_SWIFT_NAME(killTask(_:));
@end

typedef void (^NNResultCompletion)(NSDictionary<NSString *, id> *result);

/// Built-in ad, tracker and cookie-banner blocking: uBlock Origin Lite, bundled
/// and loaded as a built-in extension (NNContentBlocker.h). On by default.
@interface NNContentBlocker : NSObject
/// {enabled, lists: [{id, title, category, enabled, bundled, rules, lastModified}], allowedHosts, stats};
/// categories: "ads", "trackers", "cookies", "regional", "annoyances", "security".
+ (void)state:(NNResultCompletion)completion;
+ (void)setEnabled:(BOOL)enabled completion:(void (^)(void))completion NS_SWIFT_NAME(setEnabled(_:completion:));
/// Turns a ruleset on/off.
+ (void)setList:(NSString *)listId enabled:(BOOL)enabled completion:(void (^)(void))completion
    NS_SWIFT_NAME(setList(_:enabled:completion:));
/// Per-site allow toggle ("disable on this site"); covers subdomains of `host`.
+ (void)isAllowedOnHost:(NSString *)host completion:(void (^)(BOOL allowed))completion
    NS_SWIFT_NAME(isAllowed(host:completion:));
+ (void)setAllowed:(BOOL)allowed onHost:(NSString *)host completion:(void (^)(void))completion
    NS_SWIFT_NAME(setAllowed(_:host:completion:));
@end

/// Per-origin content settings for a profile ("" = default).
@interface NNSiteSettings : NSObject
/// Setting names understood by the methods below.
@property (class, nonatomic, readonly) NSArray<NSString *> *types;
/// "allow" | "block" | "ask" | "default" ("default" = no site-specific value).
+ (NSString *)settingForProfile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setting(profile:origin:type:));
+ (void)setSetting:(NSString *)value profile:(NSString *)profile origin:(NSString *)origin type:(NSString *)type
    NS_SWIFT_NAME(setSetting(_:profile:origin:type:));
/// Every type's effective value for an origin: {type: {value, isDefault}}.
+ (NSDictionary<NSString *, id> *)settingsForProfile:(NSString *)profile origin:(NSString *)origin
    NS_SWIFT_NAME(settings(profile:origin:));
/// Origins with any site-specific value set through this API.
+ (NSArray<NSString *> *)originsForProfile:(NSString *)profile NS_SWIFT_NAME(origins(profile:));
/// Removes every site-specific value for an origin.
+ (void)resetOrigin:(NSString *)origin profile:(NSString *)profile NS_SWIFT_NAME(reset(origin:profile:));
/// Deletes cookies and all storage (local/session storage, IndexedDB, cache,
/// service workers…) for an origin. Completion gets {cookies, storage}.
+ (void)clearSiteDataForProfile:(NSString *)profile
                         origin:(NSString *)origin
                     completion:(void (^)(NSDictionary<NSString *, id> *result))completion
    NS_SWIFT_NAME(clearSiteData(profile:origin:completion:));
@end

/// Chrome's per-host zoom (all tabs of a host share it; Chrome saves it per profile).
@interface NNZoom : NSObject
+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host NS_SWIFT_NAME(setZoom(_:profile:host:));
/// {host: zoom} for hosts with a non-default level.
+ (NSDictionary<NSString *, NSNumber *> *)zoomLevelsForProfile:(NSString *)profile NS_SWIFT_NAME(zoomLevels(profile:));
@end

/// Chrome's password manager (its store, through chrome://password-manager's
/// passwordsPrivate API). Chrome itself saves, fills and generates in pages.
@interface NNPasswords : NSObject
/// Chrome offers to save passwords and fills them ("credentials_enable_service").
+ (BOOL)autofillEnabledForProfile:(NSString *)profile NS_SWIFT_NAME(autofillEnabled(profile:));
+ (void)setAutofillEnabled:(BOOL)enabled profile:(NSString *)profile NS_SWIFT_NAME(setAutofillEnabled(_:profile:));
/// {passwords: [{origin, username, created, modified}]} (no passwords) or {error}.
+ (void)listForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(list(profile:completion:));
/// Asks for Touch ID / the login password through Chrome's own check (the one revealing a
/// password needs), so the Passwords pane asks once: reveals then pass for Chrome's 5 minutes.
/// {unlocked} or {error}; no saved passwords means nothing to unlock ({unlocked: true}).
+ (void)unlockForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(unlock(profile:completion:));
/// {password} or {error}.
+ (void)passwordForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
                completion:(NNResultCompletion)completion NS_SWIFT_NAME(password(profile:origin:username:completion:));
/// {ok} or {error}.
+ (void)saveForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
            completion:(NNResultCompletion)completion NS_SWIFT_NAME(save(profile:origin:username:password:completion:));
+ (void)updateForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
             newUsername:(nullable NSString *)newUsername
             newPassword:(nullable NSString *)newPassword
              completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(update(profile:origin:username:newUsername:newPassword:completion:));
+ (void)deleteForProfile:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
              completion:(NNResultCompletion)completion NS_SWIFT_NAME(delete(profile:origin:username:completion:));
/// Sites Chrome never offers to save for (added from its save prompt): {origins} or {error}.
+ (void)neverSaveOriginsForProfile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(neverSaveOrigins(profile:completion:));
/// Removes a site from the never-save list (adding one only happens in Chrome's prompt).
+ (void)allowSavingForProfile:(NSString *)profile origin:(NSString *)origin completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(allowSaving(profile:origin:completion:));
/// Strong password like Safari's: "abcdef-GHIjk2-lmnopq".
@end

/// Favicons for the app's UI, cached per profile (NNFavicons.fetch, in NNBrowsingData.mm). Results are
/// {uri, width, height}: a file: URI in the profile's directory when `name` is
/// given, else a data: URI; incognito profiles never write.
@interface NNFavicons : NSObject
/// Fetches an icon URL through the profile's request context (no cookies), for
/// pages without a live tab. Persistent profiles and http(s) only.
+ (void)fetch:(NSString *)url profile:(NSString *)profile name:(nullable NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(fetch(_:profile:name:completion:));
/// Deletes the profile's cached icons except `names`.
+ (void)pruneProfile:(NSString *)profile keeping:(NSArray<NSString *> *)names NS_SWIFT_NAME(prune(profile:keeping:));
@end

/// Clear Browsing Data for a time range, where the engine has no ranged API.
@interface NNBrowsingData : NSObject
/// Deletes the cookies created since `sinceMs` (ms since 1970); reports how many.
+ (void)deleteCookiesForProfile:(NSString *)profile since:(double)sinceMs completion:(void (^)(NSInteger deleted))completion
    NS_SWIFT_NAME(deleteCookies(profile:since:completion:));
/// Empties the profile's HTTP cache (no ranges: the engine clears it whole).
+ (void)clearCacheForProfile:(NSString *)profile completion:(void (^)(void))completion NS_SWIFT_NAME(clearCache(profile:completion:));
@end

/// Chrome autofill's saved addresses and cards (chrome://settings's autofillPrivate API).
/// Chrome itself offers, fills and saves them in pages.
@interface NNAutofill : NSObject
/// {addresses, cards}: Chrome offers and saves them ("autofill.profile_enabled", "autofill.credit_card_enabled").
+ (NSDictionary<NSString *, NSNumber *> *)settingsForProfile:(NSString *)profile NS_SWIFT_NAME(settings(profile:));
+ (void)setSettings:(NSDictionary<NSString *, NSNumber *> *)settings profile:(NSString *)profile NS_SWIFT_NAME(setSettings(_:profile:));
/// {addresses: [{id, name, organization, street, city, state, postalCode, country, phone, email, created, modified}]} or {error}.
+ (void)addressesForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(addresses(profile:completion:));
/// Adds (no "id") or replaces an address: {id} or {error}.
+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(saveAddress(_:profile:completion:));
/// {cards: [{id, name, network, last4, expMonth, expYear, created, modified}]} or {error}.
+ (void)cardsForProfile:(NSString *)profile completion:(NNResultCompletion)completion NS_SWIFT_NAME(cards(profile:completion:));
/// Adds (no "id"; needs `number`) or updates a card: {id} or {error}.
+ (void)saveCard:(NSDictionary<NSString *, id> *)card number:(nullable NSString *)number profile:(NSString *)profile
      completion:(NNResultCompletion)completion NS_SWIFT_NAME(saveCard(_:number:profile:completion:));
/// Addresses and cards alike.
+ (void)deleteEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(deleteEntry(_:profile:completion:));
/// The full number after Touch ID / the login password: {number} ({} if cancelled) or {error}.
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNResultCompletion)completion
    NS_SWIFT_NAME(revealCardNumber(_:profile:completion:));
@end

@class NNBrowserView;

@protocol NNBrowserViewDelegate <NSObject>
/// Per-browser events: navigation, progress, favicon, media, nowPlaying,
/// mediaAccess, openWindow, popupBlocked, find, fullscreen,
/// status, crashed, unresponsive, responsive, loadError,
/// security, zoom, contentBlocked, downloadNavigation, notification, notificationClose,
/// pictureInPicture, activateRequest, displayMediaRequest, windowClose, command, focus,
/// pageMessage, ready, discarded, passwordPrompt, tabStrip.
- (void)browserView:(NNBrowserView *)view event:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
@end

/// One tab: its page's NSView hosted in ours (see NNWindowHost.h for which
/// engine path makes the tab). The browser is created lazily when the view first
/// joins a window, so set `profile`, `initialURL` and `adoptId` before adding it.
@interface NNBrowserView : NSView

@property (nonatomic, weak, nullable) id<NNBrowserViewDelegate> delegate;
/// "" (default profile), a profile id, or "incognito:<window id>" (in memory).
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, copy, nullable) NSString *initialURL;
/// Adopts a browser the engine made (the `adoptId` of an `openWindow` event: a popup,
/// or a tab Chrome created) instead of creating one. "clone:<transferKey>" copies that tab
/// (Duplicate) and "restore:<transferKey>" reopens that closed tab, both with their
/// back/forward list; without one (engine, or nothing known) the view loads `initialURL`.
@property (nonatomic, copy, nullable) NSString *adoptId;
/// The tab this view shows (the app's tab id). A tab moving to another window keeps its
/// browser (page, history, the Chrome tab) when +prepareTransfer: announced the move:
/// the new view takes it from the old one, whichever of them comes first.
@property (nonatomic, copy, nullable) NSString *transferKey;
/// Not a tab: a standalone browser outside the window's Chrome Browser (extension
/// popups and side panels), so extensions' tabs APIs never see it.
@property (nonatomic) BOOL standalone;
/// Page background shown before first paint (avoids a white flash).
@property (nonatomic, strong, nullable) NSColor *pageBackgroundColor;
/// Hidden browsers keep their state but stop painting and throttle timers.
@property (nonatomic) BOOL visible;
/// Picture-in-picture the playing video when the tab is hidden (and leave it when shown).
@property (nonatomic) BOOL autoPictureInPicture;
/// YES while the tab sleeps (-discard:, or Chrome discarded it) until it loads again.
@property (nonatomic, readonly) BOOL discarded;
/// Battery Saver: a frozen page runs no script, timers or loading (Chrome's tab
/// freezing). Only a hidden view freezes; showing it thaws the page.
@property (nonatomic) BOOL frozen;
/// The browser's identifier (0 before creation).
@property (nonatomic, readonly) int browserId;
/// Chrome's id for the tab (chrome.tabs), 0 if it isn't a Chrome tab.
@property (nonatomic, readonly) int chromeTabId;

/// The tab `transferKey` is about to move to another window: its views hand the browser
/// over for a few seconds. Thread-safe (called from JS right when the app state changes).
+ (void)prepareTransfer:(NSString *)transferKey;

- (void)loadURL:(NSString *)url;
/// `userInitiated`: the user asked for this URL (typed it, picked it), so it
/// loads even if it's a URL that turned into a download before (see "downloadNavigation").
- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated NS_SWIFT_NAME(loadURL(_:userInitiated:));
- (void)goBack;
- (void)goForward;
- (void)goToHistoryOffset:(NSInteger)offset;
- (void)reload;
- (void)reloadIgnoringCache;
- (void)stopLoading;
- (void)focusPage;
- (void)setMuted:(BOOL)muted;
/// Sets this tab's host zoom (1.0 = 100%); every tab on the host follows.
- (void)setZoomFactor:(double)factor;
/// Chrome's preset steps (direction ±1) or back to 100% (0).
- (void)zoomStep:(NSInteger)direction NS_SWIFT_NAME(zoomStep(_:));
- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext;
- (void)stopFinding:(BOOL)clearSelection;
- (void)print;
- (void)showDevTools;
/// Chrome's Developer menu commands: nil = Developer Tools, "console" = JavaScript Console,
/// "inspect" = Inspect Elements (the element picker).
- (void)showDevToolsPanel:(nullable NSString *)panel NS_SWIFT_NAME(showDevTools(panel:));
- (void)executeJavaScript:(NSString *)code;
/// Runs `code` in the page with a private `post(kind, json)` in scope and resolves
/// with the JSON string passed to `post("result", …)`.
- (void)evaluate:(NSString *)code completion:(void (^)(NSString *_Nullable json))completion;
/// Back/forward list: [{url, title, current}], oldest first.
- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *entries))completion;
/// Downloads an icon through this tab's browser (its own request context, no
/// cookies) as a favicon; see NNFavicons for the result.
- (void)downloadFavicon:(NSString *)url name:(nullable NSString *)name
             completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadFavicon(_:name:completion:));
/// Downloads any image through this tab's browser (no cookies) as a PNG data: URI, at most
/// `maxPixels` on its longer side. Never cached on disk (artwork, notification icons).
- (void)downloadImage:(NSString *)url
            maxPixels:(NSInteger)maxPixels
           completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadImage(_:maxPixels:completion:));

// Media
/// "play" | "pause" | "toggle" | "next" | "previous" | "seekBy" | "seekTo" | "stop".
- (void)mediaCommand:(NSString *)action seconds:(double)seconds NS_SWIFT_NAME(mediaCommand(_:seconds:));
- (void)requestPictureInPicture:(void (^)(BOOL ok))completion NS_SWIFT_NAME(requestPictureInPicture(_:));
- (void)exitPictureInPicture;

// Site controls
- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *info))completion NS_SWIFT_NAME(securityInfo(_:));
/// Opens a blocked popup ("popupBlocked" event); `always` also allows the site.
- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always NS_SWIFT_NAME(openBlockedPopup(_:always:));
/// Clears cookies and storage for the current page's origin.
- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *result))completion NS_SWIFT_NAME(clearSiteData(_:));

// Chrome UI surfaces the app draws (NNChromeUI.h)
/// Answers a "passwordPrompt" event: "save" | "update" | "never" | "nope" | "dismiss", with the
/// username / password as edited in the prompt (nil = as Chrome captured them).
- (void)resolvePasswordPrompt:(NSString *)action username:(nullable NSString *)username password:(nullable NSString *)password
    NS_SWIFT_NAME(resolvePasswordPrompt(_:username:password:));
/// Places this tab in its Chrome window's tab strip like the app's tab list (index among the
/// window's Chrome tabs of this profile, pinned first): what chrome.tabs reports. No-op without Chrome tabs.
- (void)setTabStripIndex:(NSInteger)index pinned:(BOOL)pinned NS_SWIFT_NAME(setTabStrip(index:pinned:));
/// Clicks an extension's toolbar button for this tab: "none" (it handled the click), "popup"
/// or "sidePanel" (show it), or nil when the engine can't run actions.
- (nullable NSString *)executeExtensionAction:(NSString *)extensionId NS_SWIFT_NAME(executeExtensionAction(_:));

// Screen sharing
/// Answers a "displayMediaRequest": share `sourceId` (from its `sources`), or nil to deny.
- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(nullable NSString *)sourceId
    NS_SWIFT_NAME(resolveDisplayMedia(_:sourceId:));
/// A source id that shares this tab ("web-contents-media-stream://…"), to pass to another tab's
/// `resolveDisplayMedia`. Ask right before sharing: it changes when the page moves to a new
/// renderer. nil without a live page or on engines without tab capture (engineInfo.tabCapture).
@property (nonatomic, readonly, nullable) NSString *mediaCaptureSourceId;

// Notifications
/// The app's notification for a "notification" event was clicked or closed:
/// fires the page's click/close handlers. `action`: "click" | "close".
- (void)notificationAction:(NSString *)notificationId action:(NSString *)action NS_SWIFT_NAME(notificationAction(_:action:));

// Robustness
/// After an "unresponsive" event: kill the renderer (YES) or keep waiting (NO).
- (void)resolveUnresponsive:(BOOL)terminate NS_SWIFT_NAME(resolveUnresponsive(terminate:));
/// Frees the page's memory but keeps the view. A Chrome tab is discarded as Chrome does it
/// (history kept, still a tab to extensions) and reloads when shown. `unload`, and any other
/// browser: the browser closes and is recreated with the last URL when the view becomes
/// visible or loads a URL (history is lost), so its profile can unload. Returns YES when the
/// browser closed.
- (BOOL)discard:(BOOL)unload NS_SWIFT_NAME(discard(unload:));
/// Closes the browser (the view becomes empty). Called on unmount.
- (void)closeBrowser;

@end

NS_ASSUME_NONNULL_END
