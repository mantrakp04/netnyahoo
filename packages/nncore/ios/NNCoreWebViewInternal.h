// What NNCoreWindowController tells a WebView about its tab (NNCoreChromeWindow.mm).
#import "NNCoreInternal.h"
#import "NNCoreWebView.h"

NS_ASSUME_NONNULL_BEGIN

@interface NNCoreWebView ()
// Chrome opened `tab` from this view's page (a popup, target=_blank, ⌘-click…): the app adopts it by `adoptId`.
- (void)openedTab:(NNCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition;
// The tab left the window's tab strip. Unless the app closed or moved it, Chrome closed it (window.close()).
- (void)tabRemovedFromWindow:(NNCoreWindow *)window;
// Chrome made the tab its active one; `chromes` when the app didn't ask (an extension, a close picking it).
- (void)tabActivatedByChrome:(BOOL)chromes;
- (void)devToolsChanged:(nullable NSView *)devToolsView;
- (void)emit:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
// Leaves video Picture in Picture in one frame (a frame id from the page script), else the main frame's.
- (void)exitPictureInPictureInFrame:(nullable NSString *)frameId;
@end

NS_ASSUME_NONNULL_END
