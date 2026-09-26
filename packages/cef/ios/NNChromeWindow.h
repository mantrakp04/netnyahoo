// Chrome-hosted windows (docs/research/chrome-hosted-window.md; the engine's
// CEF_NN_CLIENT_WINDOW): every app window is Chrome's own Browser window, with the
// React root laid over Chrome's views. The shell finds this class by name
// (NSClassFromString), so it needs no import of this pod.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeWindowHost : NSObject

/// A new, not yet shown, Chrome Browser window for `profile` ("" = default), or nil when the engine
/// can't make one (not running, or stock CEF without CEF_NN_CLIENT_WINDOW).
+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile;

/// A new, not yet shown, Chrome Browser window for a sized popup (window.open with features) of
/// `profile`: a plain titled window of its own, its root `root` (NNPopupWindow.mm). nil like
/// makeWindowForProfile:.
+ (nullable NSWindow *)makePopupWindowForProfile:(NSString *)profile root:(NSView *)root;

/// Lays `root` (the window's React root view) over Chrome's views, filling the window.
+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window;

/// The root view embedded in `window`, if it's a Chrome-hosted window.
+ (nullable NSView *)rootViewOfWindow:(NSWindow *)window;

/// Unmounts `window`'s root view (it's closing).
+ (void)removeRootViewOfWindow:(NSWindow *)window;

/// The app closes a Chrome-hosted window: it hides now and closes once no tab is moving out of it.
+ (void)closeWindow:(NSWindow *)window;

/// The app window shown in `window` now shows `profile`: its Chrome window of that profile takes
/// our views over (docs/research/chrome-hosted-window.md › Profiles), with the swap strategy
/// host::SwapStrategy picks. In full screen the swap waits for the window to leave it.
/// `swappedHandler` hears of every swap (the shell's window registry follows it).
+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window;
/// Makes the app window's Chrome windows for `profiles` ahead of a swap (off screen).
+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window;
@property(class, nonatomic, copy, nullable) void (^swappedHandler)(NSWindow *from, NSWindow *to);

/// Asked when the user closes a Chrome-hosted window (close button, performClose:): the app's
/// windowShouldClose (it may ask first and close the window itself). Set by the shell.
@property(class, nonatomic, copy, nullable) BOOL (^shouldCloseHandler)(NSWindow *window);
+ (BOOL)windowShouldClose:(NSWindow *)window;

@end

/// The view our React root fills a window with: the embedded root of a Chrome-hosted window (its
/// content view is Chrome's), else the content view. Add views over the whole window to this one:
/// in a Chrome-hosted window the root takes every click on the content view first.
NSView *_Nullable NNWindowRootView(NSWindow *_Nullable window);

@interface NNChromeWindowHost (Dev)

/// DEV: input for test instances (they get no OS events and are never active), in window points
/// from the top left: "hit:x,y" (the view AppKit's hit test picks), "click:x,y[,right]" (to that
/// view), "type:<text>" (to the first responder), "keys:<modifier flags>:<character>" (NSApp's key
/// equivalent path: menus, Chrome's command dispatcher), "responder", "ax" (the window's
/// accessibility tree). nil if not one of these.
+ (nullable NSString *)devAction:(NSString *)action window:(NSWindow *)window;

@end

NS_ASSUME_NONNULL_END
