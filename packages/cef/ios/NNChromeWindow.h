// Chrome-hosted windows (docs/research/chrome-hosted-window.md), behind
// NETNYAHOO_CHROME_WINDOW=1 and needing CEF_NN_CLIENT_WINDOW: the app window is
// Chrome's own Browser window, with the React root laid over Chrome's views,
// instead of an app NSWindow with a hidden "ghost" Browser window behind it.
// The shell finds this class by name (NSClassFromString), so it needs no
// import of this pod.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeWindowHost : NSObject

/// NETNYAHOO_CHROME_WINDOW=1 and an engine with CEF_NN_CLIENT_WINDOW is running.
@property(class, readonly) BOOL enabled;

/// A new, not yet shown, Chrome Browser window for `profile` ("" = default), or nil.
+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile;

/// Lays `root` (the window's React root view) over Chrome's views, filling the window.
+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window;

/// The root view embedded in `window`, if it's a Chrome-hosted window.
+ (nullable NSView *)rootViewOfWindow:(NSWindow *)window;

/// Unmounts `window`'s root view (it's closing).
+ (void)removeRootViewOfWindow:(NSWindow *)window;

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
