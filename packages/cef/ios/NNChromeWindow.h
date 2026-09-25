// Chrome-hosted window spike (docs/research/chrome-hosted-window.md), behind
// NETNYAHOO_CHROME_WINDOW=1: the app window is Chrome's own Browser window, with
// the React root laid over Chrome's views, instead of an app NSWindow with a
// hidden "ghost" Browser window behind it. The shell finds this class by name
// (NSClassFromString), so it needs no import of this pod.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeWindowHost : NSObject

/// NETNYAHOO_CHROME_WINDOW=1 and the patched engine is running.
@property(class, readonly) BOOL enabled;

/// A new, not yet shown, Chrome Browser window for `profile` ("" = default), or nil.
+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile;

/// Lays `root` (the window's React root view) over Chrome's views, filling the window.
+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window;

/// The root view embedded in `window`, if it's a Chrome-hosted window.
+ (nullable NSView *)rootViewOfWindow:(NSWindow *)window;

/// Unmounts `window`'s root view (it's closing).
+ (void)removeRootViewOfWindow:(NSWindow *)window;

@end

@interface NNChromeWindowHost (Dev)

/// DEV: input for test instances (they get no OS events and are never active), in window points
/// from the top left: "hit:x,y" (the view AppKit's hit test picks), "click:x,y[,right]" (to that
/// view), "type:<text>" (to the first responder), "keys:<modifier flags>:<character>" (NSApp's key
/// equivalent path: menus, Chrome's command dispatcher), "responder". nil if not one of these.
+ (nullable NSString *)devAction:(NSString *)action window:(NSWindow *)window;

@end

NS_ASSUME_NONNULL_END
