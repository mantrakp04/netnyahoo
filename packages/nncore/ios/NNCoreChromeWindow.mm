// NNChromeWindowHost on NNCore: the class packages/shell's ChromeWindows looks up by name. Each app window is
// one NNCoreWindow (a Views-backed NSWindow, so Chrome's bubbles and dialogs attach to it) holding a Chrome
// Browser per profile shown in it. Paging between profiles is a change of the active profile, never a window
// swap, so swappedHandler never fires here.
#import "NNChromeWindow.h"
#import "NNCoreInternal.h"
#import "NNCoreWebView.h"
#import "NNCoreWebViewInternal.h"
#import "NNCoreServices.h"

#import <objc/runtime.h>

#include <initializer_list>

namespace {

BOOL (^gShouldClose)(NSWindow *);
void (^gSwapped)(NSWindow *, NSWindow *);

NSMapTable<NSWindow *, NNCoreWindowController *> *Controllers() {
  static NSMapTable *controllers = [NSMapTable weakToStrongObjectsMapTable];
  return controllers;
}

NSColor *WindowColor() {
  return [NSColor colorWithName:nil
                dynamicProvider:^NSColor *(NSAppearance *appearance) {
                  const bool dark = [[appearance bestMatchFromAppearancesWithNames:@[ NSAppearanceNameDarkAqua, NSAppearanceNameAqua ]]
                      isEqualToString:NSAppearanceNameDarkAqua];
                  return dark ? [NSColor colorWithSRGBRed:0.17 green:0.12 blue:0.14 alpha:1]
                              : [NSColor colorWithSRGBRed:0.93 green:0.91 blue:0.90 alpha:1];
                }];
}

// MARK: Traffic lights (as packages/cef/ios/NNChromeWindow.mm)

constexpr CGFloat kTrafficLightInsetX = 18;
const void *kFollowedKey = &kFollowedKey;
const void *kLightsCenterKey = &kLightsCenterKey;
const void *kLightsBaseYKey = &kLightsBaseYKey;

void LayoutTrafficLights(NSWindow *window) {
  if (!window || (window.styleMask & NSWindowStyleMaskFullScreen)) return;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *mini = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !mini || !zoom) return;
  if (!objc_getAssociatedObject(close, kFollowedKey)) {
    objc_setAssociatedObject(close, kFollowedKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    close.postsFrameChangedNotifications = YES;
    __weak NSWindow *weakWindow = window;
    [NSNotificationCenter.defaultCenter addObserverForName:NSViewFrameDidChangeNotification
                                                    object:close
                                                     queue:nil
                                                usingBlock:^(NSNotification *) { LayoutTrafficLights(weakWindow); }];
  }
  const CGFloat spacing = NSMinX(mini.frame) - NSMinX(close.frame);
  NSValue *center = objc_getAssociatedObject(window, kLightsCenterKey);
  NSNumber *baseY = objc_getAssociatedObject(window, kLightsBaseYKey);
  CGFloat x, y;
  if (center) {
    const NSPoint c = [close.superview convertPoint:NSMakePoint(center.pointValue.x, NSHeight(window.frame) - center.pointValue.y)
                                           fromView:nil];
    x = c.x - NSWidth(close.frame) / 2;
    y = c.y - NSHeight(close.frame) / 2;
    if (!baseY) objc_setAssociatedObject(window, kLightsBaseYKey, @(NSMinY(close.frame)), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  } else {
    x = kTrafficLightInsetX - [close.superview convertPoint:NSZeroPoint toView:nil].x;
    y = baseY ? baseY.doubleValue : NSMinY(close.frame);
    objc_setAssociatedObject(window, kLightsBaseYKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  if (fabs(NSMinX(close.frame) - x) < 0.5 && fabs(NSMinY(close.frame) - y) < 0.5) return;
  NSArray<NSButton *> *buttons = @[ close, mini, zoom ];
  for (NSUInteger i = 0; i < buttons.count; i++) [buttons[i] setFrameOrigin:NSMakePoint(x + i * spacing, y)];
}

void KeepTrafficLightsInset(NSWindow *window) {
  __weak NSWindow *weakWindow = window;
  for (NSNotificationName name in @[
         NSWindowDidResizeNotification, NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification,
         NSWindowDidExitFullScreenNotification, NSWindowDidBecomeMainNotification
       ])
    [NSNotificationCenter.defaultCenter addObserverForName:name
                                                    object:window
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  LayoutTrafficLights(weakWindow);
                                                  dispatch_async(dispatch_get_main_queue(), ^{ LayoutTrafficLights(weakWindow); });
                                                }];
  dispatch_async(dispatch_get_main_queue(), ^{ LayoutTrafficLights(weakWindow); });
  // AppKit lays the title bar out again when the window first shows and when a Browser of another profile becomes
  // current, without moving the close button through setFrame (no frame notification): check after every update.
  [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidUpdateNotification
                                                  object:window
                                                   queue:nil
                                              usingBlock:^(NSNotification *) { LayoutTrafficLights(weakWindow); }];
  for (double delay : {0.05, 0.25, 1.0})
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      LayoutTrafficLights(weakWindow);
    });
}

void ConfigureWindow(NSWindow *window) {
  window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
  window.title = @"Netnyahoo";
  window.minSize = NSMakeSize(720, 460);
  window.backgroundColor = WindowColor();
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  KeepTrafficLightsInset(window);
}

// Shortcuts the app's menus own before the page sees them, as Chrome reserves them (they can't be
// overridden by a page): new/close tab and window, quit, reopen closed tab, tab cycling.
bool IsReservedKey(NSEvent *event) {
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  if ((mods & NSEventModifierFlagControl) && event.keyCode == 48) return true;  // ⌃Tab, ⌃⇧Tab
  if (!(mods & NSEventModifierFlagCommand) || (mods & (NSEventModifierFlagControl | NSEventModifierFlagOption))) return false;
  return [@[ @"t", @"w", @"n", @"q" ] containsObject:key];
}

}  // namespace

// MARK: - NNCoreWindowController

@implementation NNCoreWindowController {
  NSHashTable<NNCoreTab *> *_closing;
}

+ (instancetype)holding:(NNCoreTab *)tab {
  NNCoreProfile *profile = tab.profile;
  if (!profile) return nil;
  for (NNCoreWindowController *c in Controllers().objectEnumerator)
    if ([[c.coreWindow tabsForProfile:profile] containsObject:tab]) return c;
  return nil;
}

- (void)noteClosing:(NNCoreTab *)tab {
  if (!_closing) _closing = [NSHashTable weakObjectsHashTable];
  [_closing addObject:tab];
  // A close that never completes (a page's beforeunload kept it) stops counting after a while.
  __weak NNCoreWindowController *weakSelf = self;
  __weak NNCoreTab *weakTab = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    NNCoreWindowController *c = weakSelf;
    NNCoreTab *t = weakTab;
    if (c && t) [c->_closing removeObject:t];
  });
}

- (BOOL)appChanging {
  return _hostChanges > 0 || _closing.count > 0;
}

+ (instancetype)forNSWindow:(NSWindow *)window {
  return window ? [Controllers() objectForKey:window] : nil;
}

+ (NSArray<NNCoreWindowController *> *)all {
  return Controllers().objectEnumerator.allObjects;
}

- (instancetype)initWithCoreWindow:(NNCoreWindow *)coreWindow {
  if ((self = [super init])) {
    _coreWindow = coreWindow;
    coreWindow.delegate = self;
    __weak NNCoreWindowController *weakSelf = self;
    [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                    object:coreWindow.window
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  if (NNCoreWindowController *c = weakSelf) [NNCoreTabStrip windowClosed:c];
                                                }];
  }
  return self;
}

- (NNCoreWebView *)viewFor:(NNCoreTab *)tab {
  return tab ? [NNCoreTabs viewForTab:tab] : nil;
}

// A shown tab of this window: who hears about tabs Chrome opened with no opener the app hosts (an
// extension's tabs.create, say).
- (NNCoreWebView *)anyShownViewForProfile:(NNCoreProfile *)profile {
  for (NNCoreTab *tab in [_coreWindow tabsForProfile:profile]) {
    NNCoreWebView *view = [NNCoreTabs viewForTab:tab];
    if (view.visible) return view;
  }
  return nil;
}

- (NNCoreWebView *)anyView {
  for (NNCoreProfile *profile in nncore_host::LoadedProfiles())
    for (NNCoreTab *tab in [_coreWindow tabsForProfile:profile])
      if (NNCoreWebView *view = [NNCoreTabs viewForTab:tab]) return view;
  return nil;
}

- (void)window:(NNCoreWindow *)window didInsertTab:(NNCoreTab *)tab opener:(NNCoreTab *)opener disposition:(NSString *)disposition {
  [NNCoreTabStrip changedInWindow:self profile:tab.profile];
  // The app's own (a WebView opening its tab, or adopting one): the view attaches it itself.
  if (_hostChanges > 0 || [NNCoreTabs viewForTab:tab]) return;
  NNCoreWebView *openerView = [self viewFor:opener];
  if (openerView) {
    // A page's popup, target=_blank or ⌘-click: placed by the app's opener rules.
    [openerView openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:nncore_host::AppDisposition(disposition)];
  } else {
    // A tab Chrome made on its own (an extension's tabs.create): the app takes Chrome's place for it, through a view
    // of this window; with none, through the extensions module (the app opens the URL itself).
    NNCoreWebView *view = [self anyShownViewForProfile:tab.profile] ?: [self anyView];
    if (view) {
      [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
    } else if (NNCoreServices.extensionsHandler) {
      NNCoreServices.extensionsHandler(@"tabs", @{
        @"action" : @"open", @"url" : tab.url ?: @"", @"profile" : nncore_host::ProfileName(tab.profile), @"active" : @YES,
        @"window" : NSNull.null, @"extensionId" : @""
      });
      [tab closeNow];
    }
  }
}

- (void)window:(NNCoreWindow *)window didRemoveTab:(NNCoreTab *)tab {
  if (NNCoreProfile *profile = tab.profile) [NNCoreTabStrip changedInWindow:self profile:profile];
  [[self viewFor:tab] tabRemovedFromWindow:window];
  // After Chrome picked the next active tab (it does before it reports the removal).
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_closing removeObject:tab]; });
}

- (void)window:(NNCoreWindow *)window didActivateTab:(NNCoreTab *)tab {
  [NNCoreTabStrip activated:tab inWindow:self];
  [NNCoreTabStrip changedInWindow:self profile:tab.profile];
  [[self viewFor:tab] tabActivatedByChrome:!self.appChanging];
}

- (void)window:(NNCoreWindow *)window devToolsDidChangeForTab:(NNCoreTab *)tab view:(NSView *)devToolsView {
  [[self viewFor:tab] devToolsChanged:devToolsView];
}

- (void)window:(NNCoreWindow *)window tab:(NNCoreTab *)tab didChangeFullscreen:(BOOL)fullscreen {
  [[self viewFor:tab] emit:@"fullscreen" payload:@{@"fullscreen" : @(fullscreen)}];
}

- (void)window:(NNCoreWindow *)window passwordSavePromptForTab:(NNCoreTab *)tab username:(NSString *)username origin:(NSString *)origin {
  [[self viewFor:tab] emit:@"passwordPrompt"
                   payload:@{
                     @"state" : @"save",
                     @"origin" : origin ?: @"",
                     @"username" : username ?: @"",
                     @"passwordLength" : @0,
                     @"federation" : @"",
                     @"usernames" : username.length ? @[ username ] : @[],
                   }];
}

- (BOOL)windowShouldClose:(NNCoreWindow *)window {
  return [NNChromeWindowHost windowShouldClose:window.window];
}

- (void)windowDidCancelClose:(NNCoreWindow *)window {
  NSLog(@"[nncore] window close cancelled");
}

- (void)window:(NNCoreWindow *)window confirmCloseWithDownloads:(int)count completion:(void (^)(BOOL))completion {
  // The app asks about downloads in flight before it quits (WindowManager.confirmActiveDownloads); closing one
  // window with downloads going keeps them going in Chrome's download manager until quit.
  completion(YES);
}

- (BOOL)window:(NNCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  return IsReservedKey(event) && [NSApp.mainMenu performKeyEquivalent:event];
}

- (BOOL)window:(NNCoreWindow *)window handleKeyEvent:(NSEvent *)event {
  return [NSApp.mainMenu performKeyEquivalent:event];
}

@end

// MARK: - NNChromeWindowHost

NSView *NNWindowRootView(NSWindow *window) {
  return [NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView;
}

@implementation NNChromeWindowHost

+ (NSWindow *)makeWindowForProfile:(NSString *)profile {
  if (!NNCoreHost.isStarted) return nil;
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1360, 860)];
  NSWindow *window = coreWindow.window;
  if (!window) return nil;
  ConfigureWindow(window);
  NNCoreWindowController *controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  [Controllers() setObject:controller forKey:window];
  [self showProfile:profile ?: @"" inWindow:window];
  return window;
}

+ (NSWindow *)makePopupWindowForProfile:(NSString *)profile root:(NSView *)root {
  return nil;
}

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller) return;
  __weak NNCoreWindow *coreWindow = controller.coreWindow;
  __weak NSWindow *weakWindow = window;
  nncore_host::WithProfile(profile ?: @"", ^(NNCoreProfile *p) {
    if (!p || !coreWindow) return;
    coreWindow.activeProfile = p;
    // Showing another profile's Browser makes AppKit lay the title bar out again, which puts the window buttons
    // back at their standard place: put them back where the app wants them, now and once that layout ran.
    LayoutTrafficLights(weakWindow);
    dispatch_async(dispatch_get_main_queue(), ^{ LayoutTrafficLights(weakWindow); });
  });
}

+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(prepareProfile:)]) return;
  __weak NNCoreWindow *coreWindow = controller.coreWindow;
  for (NSString *profile in profiles)
    nncore_host::WithProfile(profile, ^(NNCoreProfile *p) {
      if (p && coreWindow) [coreWindow prepareProfile:p];
    });
}

+ (void)setTrafficLightsCenter:(NSValue *)center inWindow:(NSWindow *)window {
  NSValue *current = objc_getAssociatedObject(window, kLightsCenterKey);
  if (current == center || [current isEqual:center]) return;
  objc_setAssociatedObject(window, kLightsCenterKey, center, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  LayoutTrafficLights(window);
}

+ (void)setSwappedHandler:(void (^)(NSWindow *, NSWindow *))handler {
  gSwapped = [handler copy];
}

+ (void (^)(NSWindow *, NSWindow *))swappedHandler {
  return gSwapped;
}

+ (void)closeWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (controller) [controller.coreWindow close];
  else [window close];
}

+ (void)setShouldCloseHandler:(BOOL (^)(NSWindow *))handler {
  gShouldClose = [handler copy];
}

+ (BOOL (^)(NSWindow *))shouldCloseHandler {
  return gShouldClose;
}

+ (BOOL)windowShouldClose:(NSWindow *)window {
  return gShouldClose ? gShouldClose(window) : YES;
}

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  if (!controller) return;
  NSView *host = controller.coreWindow.hostView;
  root.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  root.frame = host.bounds;
  [host addSubview:root];
  controller.root = root;
}

+ (NSView *)rootViewOfWindow:(NSWindow *)window {
  return [NNCoreWindowController forNSWindow:window].root;
}

+ (void)removeRootViewOfWindow:(NSWindow *)window {
  NNCoreWindowController *controller = [NNCoreWindowController forNSWindow:window];
  [controller.root removeFromSuperview];
  controller.root = nil;
}

@end

@implementation NNChromeWindowHost (Dev)

// "lights": the close button's frame in window coordinates (x,y,w,h, bottom-left origin).
+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if ([action isEqualToString:@"lights"]) {
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    if (!close) return nil;
    NSRect r = [close convertRect:close.bounds toView:nil];
    return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
  }
  if ([action isEqualToString:@"close-button"]) {
    // The title bar's close button, as a click on it (performClose: → windowShouldClose:).
    [[window standardWindowButton:NSWindowCloseButton] performClick:nil];
    return @"clicked";
  }
  return nil;
}

@end
