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

// A block observer's registration, removed when its owner (the object it's associated with) goes.
@interface NNObserverRegistration : NSObject
- (instancetype)initWithToken:(id)token;
@end

@implementation NNObserverRegistration {
  id _token;
}
- (instancetype)initWithToken:(id)token {
  if ((self = [super init])) _token = token;
  return self;
}
- (void)dealloc {
  if (_token) [NSNotificationCenter.defaultCenter removeObserver:_token];
}
@end

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
constexpr CGFloat kTrafficLightTop = 20;
const void *kFollowedKey = &kFollowedKey;
const void *kLightsCenterKey = &kLightsCenterKey;

void LayoutTrafficLights(NSWindow *window) {
  if (!window || (window.styleMask & NSWindowStyleMaskFullScreen)) return;
  NSButton *close = [window standardWindowButton:NSWindowCloseButton];
  NSButton *mini = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoom = [window standardWindowButton:NSWindowZoomButton];
  if (!close || !mini || !zoom) return;
  // AppKit moves the buttons, or the title bar views holding them (a layout pass, with no window update in a window
  // that isn't key): follow the frames of all of them.
  for (NSView *view = close; view && view != window.contentView.superview; view = view.superview) {
    if (objc_getAssociatedObject(view, kFollowedKey)) continue;
    view.postsFrameChangedNotifications = YES;
    __weak NSWindow *weakWindow = window;
    id token = [NSNotificationCenter.defaultCenter addObserverForName:NSViewFrameDidChangeNotification
                                                               object:view
                                                                queue:nil
                                                           usingBlock:^(NSNotification *) { LayoutTrafficLights(weakWindow); }];
    // The registration goes with the view (a window's title bar views go with the window).
    objc_setAssociatedObject(view, kFollowedKey, [[NNObserverRegistration alloc] initWithToken:token],
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  }
  const CGFloat spacing = NSMinX(mini.frame) - NSMinX(close.frame);
  NSValue *center = objc_getAssociatedObject(window, kLightsCenterKey);
  CGFloat x, y;
  if (center) {
    const NSPoint c = [close.superview convertPoint:NSMakePoint(center.pointValue.x, NSHeight(window.frame) - center.pointValue.y)
                                           fromView:nil];
    x = c.x - NSWidth(close.frame) / 2;
    y = c.y - NSHeight(close.frame) / 2;
  } else {
    // The app's default, as the CEF build's window has it (Chrome's browser frame makes AppKit's title bar as tall
    // as its tab strip, which centres the buttons there): the close button's top-left at (18, 20) from the window's
    // top-left, its centre at (25, 27); Dia's is at (25, 26).
    const NSPoint topLeft = [close.superview convertPoint:NSMakePoint(kTrafficLightInsetX, NSHeight(window.frame) - kTrafficLightTop)
                                                 fromView:nil];
    x = topLeft.x;
    y = topLeft.y - NSHeight(close.frame);
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
  // AppKit can lay the title bar out again later without moving the buttons through setFrame (a window that is never
  // key gets no updates): a few more passes as the window settles, and on each occlusion change.
  id occlusion = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidChangeOcclusionStateNotification
                                                                object:window
                                                                 queue:nil
                                                            usingBlock:^(NSNotification *) { LayoutTrafficLights(weakWindow); }];
  static const void *kOcclusionFollowKey = &kOcclusionFollowKey;
  objc_setAssociatedObject(window, kOcclusionFollowKey, [[NNObserverRegistration alloc] initWithToken:occlusion],
                           OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for (double delay : {0.05, 0.25, 1.0, 2.5, 5.0})
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      LayoutTrafficLights(weakWindow);
    });
}

void ConfigureWindow(NSWindow *window) {
  // AppKit keeps the content rect through a style change: going full-size content, the window would lose its title
  // bar's height (32 pt, so app windows opened 32 pt shorter than CEF's). It keeps the frame Chrome made instead.
  const NSRect frame = window.frame;
  window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  if (!NSEqualRects(window.frame, frame)) [window setFrame:frame display:NO];
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

+ (instancetype)strayWindowForProfile:(NNCoreProfile *)profile {
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  NNCoreWindowController *controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_stray = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  return controller;
}

NSMapTable<NNCoreProfile *, NNCoreWindowController *> *StandaloneWindows() {
  static NSMapTable *windows = [NSMapTable weakToStrongObjectsMapTable];
  return windows;
}

+ (instancetype)standaloneWindowForProfile:(NNCoreProfile *)profile {
  NSMapTable<NNCoreProfile *, NNCoreWindowController *> *windows = StandaloneWindows();
  NNCoreWindowController *controller = [windows objectForKey:profile];
  if (controller && controller.coreWindow.window) return controller;
  NNCoreWindow *coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)];
  if (!coreWindow.window) return nil;
  // Extension popups and side panels aren't pages the user visited (CEF's standalone browsers kept no history).
  if ([coreWindow respondsToSelector:@selector(setRecordsHistory:)]) coreWindow.recordsHistory = NO;
  controller = [[NNCoreWindowController alloc] initWithCoreWindow:coreWindow];
  controller->_standalone = YES;
  [Controllers() setObject:controller forKey:coreWindow.window];
  [windows setObject:controller forKey:profile];
  return controller;
}

// The app's window to hand a stray tab to: one showing the tab's profile, else any (nil profile: any). A private
// tab only ever goes to a window showing its own profile.
+ (NNCoreWebView *)hostingViewForProfile:(NNCoreProfile *)profile {
  NNCoreWebView *any = nil;
  for (NNCoreWindowController *c in Controllers().objectEnumerator) {
    if (c.stray || c.standalone) continue;
    if (NNCoreWebView *view = profile ? [c anyShownViewForProfile:profile] : nil) return view;
    any = any ?: [c anyView];
  }
  return profile.offTheRecord ? nil : any;
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
  if (_stray) {
    // A window Chrome made (chrome.windows.create, Open Link in Incognito Window): the tab goes to the app's windows,
    // as a tab Chrome made. A private tab goes to a private window showing its profile, else to a private window the
    // app opens for it ("incognito"), never into a normal window.
    NNCoreProfile *profile = tab.profile;
    // A profile on its way out (the last private window just closed) has no profile to show it under.
    if (!profile) return (void)dispatch_async(dispatch_get_main_queue(), ^{ [tab closeNow]; });
    NNCoreWebView *view = [NNCoreWindowController hostingViewForProfile:profile];
    if (view || !profile.offTheRecord) {
      if (view) [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab prefix:@"tab"] disposition:@"foreground"];
      return;
    }
    if (!(view = [NNCoreWindowController hostingViewForProfile:nil])) return;
    // The app's private windows are Personal's off-the-record profile: another profile's (an extension of Work's)
    // opens afresh in one, and Chrome's tab goes.
    const BOOL personals = [profile.name isEqualToString:@"Default"];
    [view openedTab:tab adoptId:personals ? [NNCoreTabs offerTab:tab prefix:@"tab"] : @"" disposition:@"incognito"];
    if (!personals) dispatch_async(dispatch_get_main_queue(), ^{ [tab closeNow]; });
    return;
  }
  NNCoreWebView *openerView = [self viewFor:opener];
  if ([disposition isEqualToString:@"popup"] && [tab respondsToSelector:@selector(popupFeatures)]) {
    // A sized window.open (OAuth, payments): a window of its own, not a tab.
    return nncore_host::OpenPopupWindow(tab, openerView);
  }
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
  if (_stray || _standalone) {
    // Its last tab went to the app's windows (or its last standalone view closed): the hidden window goes too, so
    // its empty Browsers don't keep a private profile alive. (The removed tab's profile counts too: one the app never
    // loaded, another profile's private one, may still have tabs here.)
    __weak NNCoreWindowController *weakSelf = self;
    NNCoreProfile *removedProfile = tab.profile;
    dispatch_async(dispatch_get_main_queue(), ^{
      NNCoreWindowController *c = weakSelf;
      if (!c) return;
      NSMutableArray<NNCoreProfile *> *profiles = [nncore_host::LoadedProfiles() mutableCopy];
      if (removedProfile) [profiles addObject:removedProfile];
      for (NNCoreProfile *p in profiles)
        if ([c.coreWindow tabsForProfile:p].count) return;
      if (c.standalone) {
        NSMapTable<NNCoreProfile *, NNCoreWindowController *> *windows = StandaloneWindows();
        for (NNCoreProfile *p in windows.keyEnumerator.allObjects)
          if ([windows objectForKey:p] == c) [windows removeObjectForKey:p];
      }
      [c.coreWindow close];
    });
  }
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

// Chrome's password bubble, already in packages/cef's PasswordPrompt shape (save, update or saved; usernames,
// federation, the password's length).
- (void)window:(NNCoreWindow *)window passwordPrompt:(NSDictionary<NSString *, id> *)prompt forTab:(NNCoreTab *)tab {
  [[self viewFor:tab] emit:@"passwordPrompt" payload:prompt];
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
  // An Esc the page left alone (Small Yahu closes on it): onCommand "escape" on the shown tab.
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (event.type == NSEventTypeKeyDown && event.keyCode == 53 && !(mods & (NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagControl))) {
    // The page holding focus, whichever profile's Browser has it (the window's active profile can be another one
    // for a moment, e.g. while Chrome deletes a profile that had a Browser here).
    NSResponder *focused = window.window.firstResponder;
    NNCoreWebView *target = nil;
    for (NNCoreProfile *profile in nncore_host::LoadedProfiles()) {
      for (NNCoreTab *tab in [window tabsForProfile:profile]) {
        NNCoreWebView *view = [NNCoreTabs viewForTab:tab];
        if (view.visible && [focused isKindOfClass:NSView.class] && [(NSView *)focused isDescendantOf:tab.view]) target = view;
      }
      if (target) break;
    }
    [target emit:@"command" payload:@{@"command" : @"escape", @"text" : @""}];
  }
  return [NSApp.mainMenu performKeyEquivalent:event];
}

@end

// MARK: - Popup windows

// A page's sized popup in a window of its own (packages/cef's NNPopupWindow): a plain titled window (the page's title,
// its host below), the tab Chrome made for window.open moved into it live, so window.opener holds both ways. Links it
// opens go to the opener's tab, as the app places them; its window.close() closes the window.
@interface NNCorePopupWindow : NSObject <NNCoreWindowDelegate, NNCoreTabDelegate>
@end

namespace {

NSMutableSet<NNCorePopupWindow *> *PopupWindows() {
  static NSMutableSet *windows = [NSMutableSet set];
  return windows;
}

NSString *HostOf(NSString *url) {
  return [NSURL URLWithString:url ?: @""].host ?: @"";
}

}  // namespace

@implementation NNCorePopupWindow {
  NNCoreWindow *_coreWindow;
  NNCoreTab *_tab;
  __weak NNCoreWebView *_opener;
  id _closeObserver;
  BOOL _adopting;
}

- (instancetype)initWithTab:(NNCoreTab *)tab opener:(NNCoreWebView *)opener {
  if (!(self = [super init])) return nil;
  _tab = tab;
  _opener = opener;
  NSDictionary<NSString *, NSNumber *> *features = tab.popupFeatures ?: @{};
  // window.open's width and height are the page's; Chrome's own floor for a popup is 100 × 100, CEF's window 200 × 150.
  const NSSize size = NSMakeSize(MAX(features[@"width"] ? features[@"width"].doubleValue : 500, 200),
                                 MAX(features[@"height"] ? features[@"height"].doubleValue : 600, 150));
  _coreWindow = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)];
  NSWindow *window = _coreWindow.window;
  if (!window) return nil;
  _coreWindow.delegate = self;
  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable;
  window.releasedWhenClosed = NO;
  window.tabbingMode = NSWindowTabbingModeDisallowed;
  window.minSize = NSMakeSize(200, 150);
  [window setContentSize:size];
  [self placeWithFeatures:features];
  __weak NNCorePopupWindow *weakSelf = self;
  _closeObserver = [NSNotificationCenter.defaultCenter addObserverForName:NSWindowWillCloseNotification
                                                                   object:window
                                                                    queue:nil
                                                               usingBlock:^(NSNotification *) { [weakSelf windowWillClose]; }];
  return self;
}

- (void)placeWithFeatures:(NSDictionary<NSString *, NSNumber *> *)features {
  NSWindow *window = _coreWindow.window;
  NSWindow *parent = _opener.window;
  NSScreen *screen = parent.screen ?: NSScreen.mainScreen;
  NSRect frame = window.frame;
  if (features[@"x"] || features[@"y"]) {
    // The page's left and top: screen points from the primary screen's top-left (the content's, as Chrome places it).
    const NSRect primary = NSScreen.screens.firstObject.frame;
    const NSRect content = [window contentRectForFrameRect:frame];
    const CGFloat left = features[@"x"] ? features[@"x"].doubleValue : NSMidX(parent.frame) - NSWidth(frame) / 2;
    const CGFloat top = features[@"y"] ? features[@"y"].doubleValue : NSMaxY(primary) - NSMaxY(parent.frame) + 60;
    frame.origin = NSMakePoint(left, NSMaxY(primary) - top - NSHeight(content));
  } else if (parent) {
    frame.origin = NSMakePoint(NSMidX(parent.frame) - NSWidth(frame) / 2, NSMaxY(parent.frame) - NSHeight(frame) - 60);
  } else {
    [window center];
    frame = window.frame;
  }
  const NSRect visible = screen.visibleFrame;
  frame.origin.x = MAX(NSMinX(visible), MIN(NSMinX(frame), NSMaxX(visible) - NSWidth(frame)));
  frame.origin.y = MAX(NSMinY(visible), MIN(NSMinY(frame), NSMaxY(visible) - NSHeight(frame)));
  [window setFrame:frame display:NO];
}

// After the insert that reported the tab: Chrome's strip can't change from inside its own callback.
- (void)takeTab {
  if (_tab.closed) return [_coreWindow close];
  _adopting = YES;
  [_coreWindow adoptTab:_tab];
  _adopting = NO;
  if (NNCoreProfile *profile = _tab.profile) _coreWindow.activeProfile = profile;
  _tab.delegate = self;
  NSView *page = _tab.view;
  [page removeFromSuperview];
  page.frame = _coreWindow.hostView.bounds;
  page.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [_coreWindow.hostView addSubview:page];
  [self updateTitle];
  if (nncore_host::Background()) [_coreWindow showInactive];
  else [_coreWindow.window makeKeyAndOrderFront:nil];
  [_tab focus];
}

- (void)updateTitle {
  NSString *url = _tab.url ?: @"", *host = HostOf(url), *title = _tab.title;
  NSWindow *window = _coreWindow.window;
  window.title = title.length && ![title isEqualToString:url] ? title : host;
  window.subtitle = [window.title isEqualToString:host] ? @"" : host;
}

- (void)windowWillClose {
  if (_closeObserver) [NSNotificationCenter.defaultCenter removeObserver:_closeObserver];
  _closeObserver = nil;
  if (_tab.delegate == self) _tab.delegate = nil;
  // Removed after the close finishes (the engine is still unwinding the window).
  NNCorePopupWindow *me = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [PopupWindows() removeObject:me]; });
}

// MARK: The page

- (void)tabDidChangeTitle:(NNCoreTab *)tab {
  [self updateTitle];
}

- (void)tabDidChangeURL:(NNCoreTab *)tab {
  [self updateTitle];
}

- (void)tab:(NNCoreTab *)tab requestsActivation:(NSString *)reason {
  if (!nncore_host::Background()) [_coreWindow.window makeKeyAndOrderFront:nil];
}

- (void)tab:(NNCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  // The app's prompt, over the opener's tab (the request answers through the engine, whichever tab shows it).
  id<NNCoreTabDelegate> opener = (id<NNCoreTabDelegate>)_opener;
  if ([opener respondsToSelector:@selector(tab:externalAppRequest:)]) [opener tab:tab externalAppRequest:request];
}

// MARK: The window

- (void)window:(NNCoreWindow *)window didInsertTab:(NNCoreTab *)tab opener:(NNCoreTab *)opener disposition:(NSString *)disposition {
  if (_adopting || tab == _tab) return;
  // The popup's own popups get windows too; its other new tabs go to the app beside the opener's tab.
  if ([disposition isEqualToString:@"popup"]) return nncore_host::OpenPopupWindow(tab, _opener);
  NNCoreWebView *view = _opener ?: [NNCoreWindowController hostingViewForProfile:tab.profile];
  if (view) [view openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:nncore_host::AppDisposition(disposition)];
  else [tab closeNow];
}

- (void)window:(NNCoreWindow *)window didRemoveTab:(NNCoreTab *)tab {
  if (tab != _tab) return;
  // Its page closed (or went to the app): nothing is left to show.
  __weak NNCoreWindow *coreWindow = _coreWindow;
  dispatch_async(dispatch_get_main_queue(), ^{ [coreWindow close]; });
}

- (BOOL)window:(NNCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  // ⌘W closes the popup (the app's menu would close the opener window's tab).
  const NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (mods == NSEventModifierFlagCommand && [event.charactersIgnoringModifiers.lowercaseString isEqualToString:@"w"]) {
    [_coreWindow close];
    return YES;
  }
  return NO;
}

@end

namespace nncore_host {

void OpenPopupWindow(NNCoreTab *tab, NNCoreWebView *opener) {
  NNCorePopupWindow *popup = [[NNCorePopupWindow alloc] initWithTab:tab opener:opener];
  if (!popup) {
    // No window: the tab goes to the app as any page's new tab would.
    if (opener) [opener openedTab:tab adoptId:[NNCoreTabs offerTab:tab] disposition:@"foreground"];
    return;
  }
  [PopupWindows() addObject:popup];
  __weak NNCorePopupWindow *weakPopup = popup;
  dispatch_async(dispatch_get_main_queue(), ^{ [weakPopup takeTab]; });
}

NSUInteger PopupWindowCount() {
  return PopupWindows().count;
}

}  // namespace nncore_host

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

// MARK: - DEV input (the same actions as packages/cef's NNChromeWindow.mm, for the shared test scripts)

namespace {

NSString *Describe(NSView *view) {
  if (view && ![view isKindOfClass:NSView.class]) return NSStringFromClass([(id)view class]);
  NSMutableArray *chain = [NSMutableArray array];
  for (NSView *v = view; v && chain.count < 6; v = v.superview) [chain addObject:NSStringFromClass(v.class)];
  return [chain componentsJoinedByString:@" < "];
}

NSPoint WindowPoint(NSWindow *window, NSString *spec) {
  NSArray<NSString *> *n = [spec componentsSeparatedByString:@","];
  if (n.count < 2) return NSMakePoint(-1, -1);
  CGFloat height = window.contentView.superview.bounds.size.height;
  return NSMakePoint(n[0].doubleValue, height - n[1].doubleValue);
}

NSEvent *Mouse(NSWindow *window, NSEventType type, NSPoint at) {
  return [NSEvent mouseEventWithType:type location:at modifierFlags:0 timestamp:NSProcessInfo.processInfo.systemUptime
                        windowNumber:window.windowNumber context:nil eventNumber:0 clickCount:1 pressure:1];
}

NSEvent *Key(NSWindow *window, NSEventType type, NSEventModifierFlags flags, NSString *chars, unsigned short code) {
  return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:flags timestamp:NSProcessInfo.processInfo.systemUptime
                      windowNumber:window.windowNumber context:nil characters:chars charactersIgnoringModifiers:chars
                         isARepeat:NO keyCode:code];
}

}

@implementation NNChromeWindowHost (Dev)

// "lights": the close button's frame in window coordinates (x,y,w,h, bottom-left origin).
+ (NSString *)devAction:(NSString *)action window:(NSWindow *)window {
  if (!window) return nil;
  NSView *frameView = window.contentView.superview;
  if ([action hasPrefix:@"hit:"]) {
    NSPoint p = WindowPoint(window, [action substringFromIndex:4]);
    return Describe([frameView hitTest:p]);
  }
  // Window drags started since the last call, with who started them: a drag from the tab strip must not move the
  // window. The first call starts recording (AppKit's two entry points to a window drag).
  if ([action isEqualToString:@"windowDrags"]) {
    static NSMutableArray<NSString *> *drags;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      drags = [NSMutableArray array];
      for (NSString *name in @[ @"performWindowDragWithEvent:", @"performWindowDragWithEvent:completionHandler:" ]) {
        Method m = class_getInstanceMethod(NSWindow.class, NSSelectorFromString(name));
        if (!m) continue;
        IMP original = method_getImplementation(m);
        bool handler = [name hasSuffix:@"Handler:"];
        method_setImplementation(m, handler ? imp_implementationWithBlock(^(NSWindow *w, NSEvent *e, id done) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *, id))original)(w, NSSelectorFromString(name), e, done);
        }) : imp_implementationWithBlock(^(NSWindow *w, NSEvent *e) {
          [drags addObject:[[NSThread callStackSymbols] componentsJoinedByString:@"\n"]];
          ((void (*)(id, SEL, NSEvent *))original)(w, NSSelectorFromString(name), e);
        }));
      }
    });
    NSString *out = [NSString stringWithFormat:@"%lu\n%@", (unsigned long)drags.count, [drags componentsJoinedByString:@"\n---\n"]];
    [drags removeAllObjects];
    return out;
  }
  if ([action hasPrefix:@"click:"]) {
    NSString *spec = [action substringFromIndex:6];
    bool right = [spec hasSuffix:@",right"];
    NSPoint p = WindowPoint(window, spec);
    NSView *target = [frameView hitTest:p];
    NSString *hit = Describe(target);
    bool page = [target isKindOfClass:NSClassFromString(@"RenderWidgetHostViewCocoa")];
    dispatch_async(dispatch_get_main_queue(), ^{
      if (!page) {
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseDown : NSEventTypeLeftMouseDown, p)];
        [window sendEvent:Mouse(window, right ? NSEventTypeRightMouseUp : NSEventTypeLeftMouseUp, p)];
      } else if (right) {
        [target rightMouseDown:Mouse(window, NSEventTypeRightMouseDown, p)];
        [target rightMouseUp:Mouse(window, NSEventTypeRightMouseUp, p)];
      } else {
        [target mouseDown:Mouse(window, NSEventTypeLeftMouseDown, p)];
        [target mouseUp:Mouse(window, NSEventTypeLeftMouseUp, p)];
      }
    });
    return hit;
  }
  if ([action hasPrefix:@"drag:"]) {
    NSMutableArray<NSValue *> *points = [NSMutableArray array];
    for (NSString *spec in [[action substringFromIndex:5] componentsSeparatedByString:@";"])
      [points addObject:[NSValue valueWithPoint:WindowPoint(window, spec)]];
    if (points.count < 2) return @"drag needs two points";
    NSMutableArray<NSEvent *> *events = [NSMutableArray arrayWithObject:Mouse(window, NSEventTypeLeftMouseDown, points[0].pointValue)];
    for (NSUInteger i = 1; i < points.count; i++) {
      NSPoint a = points[i - 1].pointValue, b = points[i].pointValue;
      for (int k = 1; k <= 12; k++)
        [events addObject:Mouse(window, NSEventTypeLeftMouseDragged, NSMakePoint(a.x + (b.x - a.x) * k / 12, a.y + (b.y - a.y) * k / 12))];
    }
    [events addObject:Mouse(window, NSEventTypeLeftMouseUp, points.lastObject.pointValue)];
    NSString *hit = Describe([frameView hitTest:points[0].pointValue]);
    for (NSUInteger i = 0; i < events.count; i++)
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((i ? 150 + i * 16 : 0) * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
        [window sendEvent:events[i]];
      });
    return [NSString stringWithFormat:@"%@ (%lu events)", hit, (unsigned long)events.count];
  }
  if ([action hasPrefix:@"type:"]) {
    NSString *text = [action substringFromIndex:5];
    for (NSUInteger i = 0; i < text.length; i++) {
      NSString *c = [text substringWithRange:NSMakeRange(i, 1)];
      [window.firstResponder keyDown:Key(window, NSEventTypeKeyDown, 0, c, 0)];
      [window.firstResponder keyUp:Key(window, NSEventTypeKeyUp, 0, c, 0)];
    }
    return Describe((NSView *)window.firstResponder);
  }
  if ([action hasPrefix:@"keys:"]) {
    NSArray<NSString *> *parts = [action componentsSeparatedByString:@":"];
    if (parts.count < 3) return @"keys:<flags>:<characters>[:<keyCode>]";
    NSEventModifierFlags flags = (NSEventModifierFlags)parts[1].longLongValue;
    unsigned short code = parts.count > 3 ? (unsigned short)parts[3].intValue : 0;
    NSEvent *down = Key(window, NSEventTypeKeyDown, flags, parts[2], code);
    NSString *handler = @"none";
    if ([window performKeyEquivalent:down]) handler = @"window";
    else if ([NSApp.mainMenu performKeyEquivalent:down]) handler = @"mainMenu";
    else {
      [window.firstResponder keyDown:down];
      handler = @"keyDown";
    }
    return [NSString stringWithFormat:@"%@ (first responder %@)", handler, Describe((NSView *)window.firstResponder)];
  }
  if ([action isEqualToString:@"ax"]) {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    __block void (^walk)(id, NSUInteger);
    __block __weak void (^weakWalk)(id, NSUInteger);
    weakWalk = walk = ^(id element, NSUInteger depth) {
      if (lines.count > 400 || depth > 40) return;
      NSString *role = [element respondsToSelector:@selector(accessibilityRole)] ? [element accessibilityRole] : @"?";
      NSMutableArray *text = [NSMutableArray array];
      for (NSString *key in @[ @"accessibilityTitle", @"accessibilityLabel", @"accessibilityValue" ]) {
        SEL sel = NSSelectorFromString(key);
        id value = [element respondsToSelector:sel] ? [element valueForKey:key] : nil;
        if ([value isKindOfClass:NSString.class] && [value length]) [text addObject:value];
      }
      [lines addObject:[NSString stringWithFormat:@"%@%@%@", [@"" stringByPaddingToLength:depth withString:@" " startingAtIndex:0],
                                                 role ?: @"", text.count ? [@": " stringByAppendingString:[text componentsJoinedByString:@" | "]] : @""]];
      NSArray *children = [element respondsToSelector:@selector(accessibilityChildren)] ? [element accessibilityChildren] : nil;
      for (id child in children) weakWalk(child, depth + 1);
    };
    walk(window, 0);
    return [lines componentsJoinedByString:@"\n"];
  }
  if ([action isEqualToString:@"winfo"]) {
    NSMutableDictionary *info = [NSMutableDictionary dictionary];
    info[@"frame"] = NSStringFromRect(window.frame);
    info[@"contentView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.className, NSStringFromRect(window.contentView.frame)];
    info[@"frameView"] = [NSString stringWithFormat:@"%@ %@", window.contentView.superview.className, NSStringFromRect(window.contentView.superview.frame)];
    info[@"root"] = NSStringFromRect([NNChromeWindowHost rootViewOfWindow:window].frame);
    info[@"styleMask"] = @(window.styleMask);
    info[@"opaque"] = @(window.opaque);
    info[@"hasShadow"] = @(window.hasShadow);
    info[@"alpha"] = @(window.alphaValue);
    info[@"level"] = @(window.level);
    info[@"background"] = window.backgroundColor.description ?: @"";
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    info[@"closeButton"] = close ? NSStringFromRect([close convertRect:close.bounds toView:nil]) : @"";
    info[@"appearance"] = window.appearance.name ?: @"";
    NSWindow *sheet = window.attachedSheet;
    info[@"sheet"] = sheet ? [NSString stringWithFormat:@"%@ %@", sheet.className, NSStringFromRect(sheet.frame)] : @"";
    if ([sheet.windowController respondsToSelector:@selector(window)] || sheet) {
      NSMutableArray *texts = [NSMutableArray array];
      NSMutableArray *stack = [NSMutableArray arrayWithObject:sheet.contentView ?: [NSView new]];
      while (stack.count) {
        NSView *v = stack.lastObject;
        [stack removeLastObject];
        if ([v isKindOfClass:NSTextField.class] && [(NSTextField *)v stringValue].length) [texts addObject:[(NSTextField *)v stringValue]];
        if ([v isKindOfClass:NSButton.class] && [(NSButton *)v title].length) [texts addObject:[(NSButton *)v title]];
        [stack addObjectsFromArray:v.subviews];
      }
      info[@"sheetText"] = texts;
    }
    NSMutableArray *effects = [NSMutableArray array];
    NSMutableArray *walk = [NSMutableArray arrayWithObject:[NNChromeWindowHost rootViewOfWindow:window] ?: window.contentView];
    while (walk.count) {
      NSView *v = walk.lastObject;
      [walk removeLastObject];
      if ([v isKindOfClass:NSVisualEffectView.class]) {
        NSVisualEffectView *e = (NSVisualEffectView *)v;
        [effects addObject:[NSString stringWithFormat:@"material %ld blending %ld state %ld emphasized %d %@ hidden %d alpha %.2f",
                                                      (long)e.material, (long)e.blendingMode, (long)e.state, e.emphasized,
                                                      NSStringFromSize(e.frame.size), e.isHiddenOrHasHiddenAncestor, e.alphaValue]];
      }
      [walk addObjectsFromArray:v.subviews];
    }
    info[@"effects"] = effects;
    NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)window.windowNumber));
    info[@"cgBounds"] = [list.firstObject objectForKey:(id)kCGWindowBounds] ?: @{};
    NSData *json = [NSJSONSerialization dataWithJSONObject:info options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action hasPrefix:@"ns:"]) {
    if ([action hasSuffix:@"out"]) [window orderOut:nil];
    else [window orderFront:nil];
    return [NSString stringWithFormat:@"visible=%d", window.visible];
  }
  if ([action isEqualToString:@"performClose"]) {
    dispatch_async(dispatch_get_main_queue(), ^{ [window performClose:nil]; });
    return @"ok";
  }
  if ([action hasPrefix:@"style:"]) {
    window.styleMask = (NSWindowStyleMask)[action substringFromIndex:6].longLongValue;
    return @"ok";
  }
  if ([action hasPrefix:@"shadow:"]) {
    window.hasShadow = [action hasSuffix:@"1"];
    return @"ok";
  }
  if ([action hasPrefix:@"root:"]) {
    [NNChromeWindowHost rootViewOfWindow:window].hidden = [action hasSuffix:@"hide"];
    return @"ok";
  }
  if ([action hasPrefix:@"opaque:"]) {
    window.opaque = [action hasSuffix:@"1"];
    if (!window.opaque) window.backgroundColor = NSColor.clearColor;
    return [NSString stringWithFormat:@"opaque=%d", window.opaque];
  }
  if ([action hasPrefix:@"ime:"]) {
    NSArray<NSString *> *parts = [[action substringFromIndex:4] componentsSeparatedByString:@"|"];
    id<NSTextInputClient> client = (id<NSTextInputClient>)window.firstResponder;
    if (![(id)client conformsToProtocol:@protocol(NSTextInputClient)]) return @"first responder isn't a text input client";
    [client setMarkedText:parts[0] selectedRange:NSMakeRange(parts[0].length, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
    const BOOL marked = client.hasMarkedText;
    const NSRange range = client.markedRange;
    if (parts.count > 1) [client insertText:parts[1] replacementRange:NSMakeRange(NSNotFound, 0)];
    return [NSString stringWithFormat:@"%@ marked=%d range=%@ after commit marked=%d", Describe((NSView *)client), marked,
                                      NSStringFromRange(range), client.hasMarkedText];
  }
  if ([action isEqualToString:@"tabviews"]) {
    NSMutableArray *out = [NSMutableArray array];
    Class tabClass = NNCoreWebView.class;
    NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:window.contentView];
    while (queue.count) {
      NSView *v = queue.lastObject;
      [queue removeLastObject];
      if ([v isKindOfClass:tabClass]) {
        if (v.hiddenOrHasHiddenAncestor) continue;
        NSMutableArray *subs = [NSMutableArray array];
        for (NSView *sub in v.subviews)
          [subs addObject:[NSString stringWithFormat:@"%@ %@%@", NSStringFromClass(sub.class), NSStringFromRect(sub.frame),
                                                     sub.hidden ? @" hidden" : @""]];
        [out addObject:@{@"frame" : NSStringFromRect(v.frame), @"subviews" : subs}];
        continue;
      }
      [queue addObjectsFromArray:v.subviews];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
  }
  if ([action isEqualToString:@"responder"]) {
    id r = window.firstResponder;
    return [r isKindOfClass:NSView.class] ? Describe(r) : NSStringFromClass([r class]);
  }
  if ([action isEqualToString:@"lights"]) {
    NSButton *close = [window standardWindowButton:NSWindowCloseButton];
    if (!close) return nil;
    NSRect r = [close convertRect:close.bounds toView:nil];
    return [NSString stringWithFormat:@"%.1f,%.1f,%.1f,%.1f", r.origin.x, r.origin.y, r.size.width, r.size.height];
  }
  if ([action isEqualToString:@"cover"] || [action isEqualToString:@"uncover"]) {
    // Tests: one of the app's own windows right above this one, a little larger, as an owner's window covering it
    // would be (Chrome's occlusion checker then reports it occluded). Never key, never takes clicks.
    static NSMapTable<NSWindow *, NSWindow *> *covers = [NSMapTable weakToStrongObjectsMapTable];
    NSWindow *cover = [covers objectForKey:window];
    if ([action isEqualToString:@"cover"]) {
      if (!cover) {
        cover = [[NSWindow alloc] initWithContentRect:NSInsetRect(window.frame, -4, -4)
                                            styleMask:NSWindowStyleMaskBorderless
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
        cover.releasedWhenClosed = NO;
        cover.opaque = YES;
        cover.backgroundColor = NSColor.windowBackgroundColor;
        cover.ignoresMouseEvents = YES;
        [covers setObject:cover forKey:window];
      }
      [cover orderWindow:NSWindowAbove relativeTo:window.windowNumber];
      return NSStringFromRect(cover.frame);
    }
    [cover orderOut:nil];
    [covers removeObjectForKey:window];
    return @"uncovered";
  }
  if ([action isEqualToString:@"close-button"]) {
    // The title bar's close button, as a click on it (performClose: → windowShouldClose:).
    [[window standardWindowButton:NSWindowCloseButton] performClick:nil];
    return @"clicked";
  }
  return nil;
}

@end
