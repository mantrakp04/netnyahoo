// NNCore spike host: a plain AppKit app that drives Chromium through NNCore.framework's
// ObjC API (engine/nncore/src/netnyahoo/core/public/NNCore.h). It draws its own chrome
// (toolbar, tab list, status line) around the page and owns every tab, as the RN app
// would. Chromium runs the app's run loop.
//
// For tests it takes JSON commands from $NNHOST_DIR/cmd.json (one at a time, {"id":…,
// "cmd":…}), answers in $NNHOST_DIR/result.json and logs every engine callback to
// $NNHOST_DIR/events.jsonl. It never activates: LSBackgroundOnly, windows ordered in
// without becoming key.

#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <objc/runtime.h>

#include <string>
#include <vector>

#import "NNCore.h"

static NSString* gDir;
static BOOL gFakeKey = NO;  // tests: our windows count as key (see FakeIsKeyWindow)

static void Log(NSDictionary* event) {
  NSMutableDictionary* e = [event mutableCopy];
  e[@"t"] = @([NSDate.date timeIntervalSince1970]);
  NSData* json = [NSJSONSerialization dataWithJSONObject:e options:0 error:nil];
  NSString* path = [gDir stringByAppendingPathComponent:@"events.jsonl"];
  NSFileHandle* file = [NSFileHandle fileHandleForWritingAtPath:path];
  if (!file) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
    file = [NSFileHandle fileHandleForWritingAtPath:path];
  }
  [file seekToEndOfFile];
  [file writeData:json];
  [file writeData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
  [file closeFile];
}

@interface Host : NSObject <NNCoreEngineDelegate, NNCoreWindowDelegate, NNCoreTabDelegate>
@end

@implementation Host {
  NNCoreWindow* _window;
  NSMutableDictionary<NSString*, NNCoreProfile*>* _profiles;  // "A", "B"
  NSMutableArray<NNCoreTab*>* _tabs;  // the workspace: every tab, in order
  NSMutableDictionary<NSNumber*, NSDictionary*>* _origins;  // tabId -> {opener, disposition}
  NNCoreTab* _shown;
  NSView* _toolbar;
  NSStackView* _sidebar;
  NSView* _content;
  NSTextField* _address;
  NSTextField* _status;
  NSProgressIndicator* _progress;
  NSSegmentedControl* _profileSwitch;
  NSButton* _back;
  NSButton* _forward;
  NSTimer* _poll;
  NSMutableArray<NSDictionary*>* _passwordPrompts;
  // Stage 1: more windows (chrome.windows.create, incognito, closes), keys, the quit.
  NSMutableArray<NNCoreWindow*>* _extraWindows;
  NSMutableDictionary<NSNumber*, NNCoreWindow*>* _tabWindow;  // tabId -> window
  NSMutableDictionary<NSString*, id>* _config;  // answers the tests pick
  NSMutableArray<NSDictionary*>* _menuHits;
  NSMutableArray<NSDictionary*>* _keyEvents;  // pre/handle calls from NNCore
  NSMapTable<NNCoreWindow*, NSNumber*>* _windowNumbers;  // kept after the NSWindow closes
}

- (void)engineDidStart {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  _profiles = [NSMutableDictionary dictionary];
  _tabs = [NSMutableArray array];
  _origins = [NSMutableDictionary dictionary];
  _passwordPrompts = [NSMutableArray array];
  _extraWindows = [NSMutableArray array];
  _tabWindow = [NSMutableDictionary dictionary];
  _config = [NSMutableDictionary dictionary];
  _menuHits = [NSMutableArray array];
  _keyEvents = [NSMutableArray array];
  _windowNumbers = [NSMapTable strongToStrongObjectsMapTable];
  // The app's delegate is ours (Chrome's AppController never exists): -terminate: asks us.
  NSApp.delegate = (id<NSApplicationDelegate>)self;
  [self buildMenu];
  NNCoreEngine* engine = NNCoreEngine.sharedEngine;
  // A page script like the app's (packages/cef/helper/page_script.js), for the checks.
  engine.pageScript =
      @"(function (post) {\n"
       "  const top = window === window.top;\n"
       "  window.__nnPageScript = 'main-world';\n"
       "  post('hello', JSON.stringify({ url: location.href, top, readyState: document.readyState,\n"
       "                                pageGlobal: typeof window.pageSetGlobal }));\n"
       "  return function receive(kind, json) {\n"
       "    document.documentElement.dataset.nnReceived = kind + ':' + json;\n"
       "    post('echo', JSON.stringify({ kind, json, top }));\n"
       "  };\n"
       "})";
  _profiles[@"A"] = engine.defaultProfile;
  Log(@{@"event" : @"engineDidStart", @"chromium" : engine.chromiumVersion,
        @"profileA" : engine.defaultProfile.path ?: @""});
  [engine loadProfile:@"Profile 2"
           completion:^(NNCoreProfile* profile) {
             if (profile) {
               self->_profiles[@"B"] = profile;
             }
             Log(@{@"event" : @"profileLoaded", @"name" : @"B", @"path" : profile.path ?: @""});
             [self buildWindow];
           }];
}

- (void)engineWillShutDown {
  Log(@{@"event" : @"engineWillShutDown"});
}

- (void)engineQuitCancelled {
  Log(@{@"event" : @"engineQuitCancelled", @"keepAlive" : NNCoreEngine.sharedEngine.keepAliveState});
}

- (NNCoreWindow*)engineWindowForNewBrowserOfProfile:(NNCoreProfile*)profile type:(NSString*)type {
  if (![type isEqualToString:@"normal"] && ![type isEqualToString:@"popup"]) {
    Log(@{@"event" : @"engineWindowForNewBrowser", @"type" : type, @"hosted" : @NO});
    return nil;
  }
  NNCoreWindow* window = [self newWindow];
  Log(@{@"event" : @"engineWindowForNewBrowser", @"type" : type, @"hosted" : @YES,
        @"profile" : profile.name ?: @"", @"offTheRecord" : @(profile.offTheRecord),
        @"windowNumber" : @(window.window.windowNumber)});
  return window;
}

// A plain extra window: its tabs fill it.
- (NNCoreWindow*)newWindow {
  NNCoreWindow* window = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(140, 160, 800, 600)];
  window.delegate = self;
  [_extraWindows addObject:window];
  [window showInactive];
  [_windowNumbers setObject:@(window.window.windowNumber) forKey:window];
  return window;
}

// --- NSApplicationDelegate (Cocoa's terminate contract) ----------------------------------

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender {
  NSString* reply = _config[@"terminateReply"] ?: @"now";
  Log(@{@"event" : @"applicationShouldTerminate", @"reply" : reply});
  if ([reply isEqualToString:@"cancel"]) {
    return NSTerminateCancel;
  }
  if ([reply isEqualToString:@"later"]) {
    BOOL answer = ![_config[@"laterAnswer"] isEqual:@NO];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      Log(@{@"event" : @"replyToApplicationShouldTerminate", @"answer" : @(answer)});
      [NSApp replyToApplicationShouldTerminate:answer];
    });
    return NSTerminateLater;
  }
  return NSTerminateNow;
}

- (void)applicationWillTerminate:(NSNotification*)notification {
  Log(@{@"event" : @"applicationWillTerminate"});
}

// --- The app's menu (key equivalents the tests press) ---------------------------------------

- (void)buildMenu {
  NSMenu* main = [[NSMenu alloc] init];
  NSMenuItem* fileItem = [[NSMenuItem alloc] init];
  NSMenu* file = [[NSMenu alloc] initWithTitle:@"File"];
  for (NSString* key in @[ @"t", @"k", @"j" ]) {
    NSMenuItem* item = [[NSMenuItem alloc] initWithTitle:[@"Test " stringByAppendingString:key]
                                                  action:@selector(menuHit:)
                                           keyEquivalent:key];
    item.target = self;
    [file addItem:item];
  }
  fileItem.submenu = file;
  [main addItem:fileItem];
  NSApp.mainMenu = main;
}

- (void)menuHit:(NSMenuItem*)item {
  NSDictionary* hit = @{@"key" : item.keyEquivalent,
                        @"firstResponder" : NSStringFromClass(_window.window.firstResponder.class)};
  [_menuHits addObject:hit];
  Log(@{@"event" : @"menuHit", @"key" : item.keyEquivalent});
}

// --- Our chrome ------------------------------------------------------------------------

- (NSButton*)button:(NSString*)symbol action:(SEL)action {
  NSButton* b = [NSButton buttonWithImage:[NSImage imageWithSystemSymbolName:symbol
                                                    accessibilityDescription:symbol]
                                   target:self
                                   action:action];
  b.bezelStyle = NSBezelStyleToolbar;
  return b;
}

- (void)buildWindow {
  _window = [[NNCoreWindow alloc] initWithContentRect:NSMakeRect(80, 120, 1180, 780)];
  _window.delegate = self;
  NSView* root = _window.hostView;

  _toolbar = [[NSView alloc] init];
  _back = [self button:@"chevron.left" action:@selector(goBack:)];
  _forward = [self button:@"chevron.right" action:@selector(goForward:)];
  NSButton* reload = [self button:@"arrow.clockwise" action:@selector(reload:)];
  _address = [NSTextField textFieldWithString:@""];
  _address.target = self;
  _address.action = @selector(addressEntered:);
  _address.cell.sendsActionOnEndEditing = NO;  // Return only (the key tests focus it)
  _profileSwitch = [NSSegmentedControl segmentedControlWithLabels:@[ @"A", @"B" ]
                                                     trackingMode:NSSegmentSwitchTrackingSelectOne
                                                           target:self
                                                           action:@selector(profileSwitched:)];
  _profileSwitch.selectedSegment = 0;
  NSButton* devtools = [self button:@"hammer" action:@selector(toggleDevTools:)];
  NSStackView* bar = [NSStackView stackViewWithViews:@[ _back, _forward, reload, _address,
                                                         _profileSwitch, devtools ]];
  bar.edgeInsets = NSEdgeInsetsMake(6, 8, 6, 8);
  bar.frame = NSMakeRect(0, 0, 1180, 40);
  bar.autoresizingMask = NSViewWidthSizable;
  [_toolbar addSubview:bar];
  _toolbar.wantsLayer = YES;
  _toolbar.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;

  _sidebar = [[NSStackView alloc] init];
  _sidebar.orientation = NSUserInterfaceLayoutOrientationVertical;
  _sidebar.alignment = NSLayoutAttributeLeading;
  _sidebar.edgeInsets = NSEdgeInsetsMake(8, 8, 8, 8);
  _sidebar.wantsLayer = YES;
  _sidebar.layer.backgroundColor = NSColor.underPageBackgroundColor.CGColor;

  _content = [[NSView alloc] init];
  _content.wantsLayer = YES;
  _status = [NSTextField labelWithString:@""];
  _status.font = [NSFont systemFontOfSize:11];
  _progress = [[NSProgressIndicator alloc] init];
  _progress.style = NSProgressIndicatorStyleBar;
  _progress.indeterminate = NO;
  _progress.minValue = 0;
  _progress.maxValue = 1;

  for (NSView* v in @[ _toolbar, _sidebar, _content, _status, _progress ]) {
    [root addSubview:v];
  }
  [self layout];
  [NSNotificationCenter.defaultCenter addObserver:self
                                         selector:@selector(windowResized:)
                                             name:NSWindowDidResizeNotification
                                           object:_window.window];
  [_window showInactive];
  Log(@{@"event" : @"windowReady", @"windowNumber" : @(_window.window.windowNumber),
        @"windowClass" : NSStringFromClass(_window.window.class),
        @"contentViewClass" : NSStringFromClass(_window.window.contentView.class)});

  // The start page in each profile.
  [_window openTab:@"about:blank" profile:_profiles[@"A"] foreground:YES];
  _poll = [NSTimer scheduledTimerWithTimeInterval:0.1
                                           target:self
                                         selector:@selector(pollCommand)
                                         userInfo:nil
                                          repeats:YES];
}

- (void)windowResized:(NSNotification*)n {
  [self layout];
}

- (void)layout {
  NSRect b = _window.hostView.bounds;
  const CGFloat bar = 40, side = 190, status = 20;
  _toolbar.frame = NSMakeRect(0, NSHeight(b) - bar, NSWidth(b), bar);
  _sidebar.frame = NSMakeRect(0, status, side, NSHeight(b) - bar - status);
  _status.frame = NSMakeRect(8, 2, NSWidth(b) - 220, 16);
  _progress.frame = NSMakeRect(NSWidth(b) - 200, 2, 190, 16);
  _content.frame = NSMakeRect(side, status, NSWidth(b) - side, NSHeight(b) - bar - status);
  [self layoutContent];
}

- (void)layoutContent {
  if (!_shown || _shown.closed) {
    return;
  }
  NSRect area = _content.bounds;
  NSView* devtools = _shown.devToolsView;
  NSRect devtoolsFrame = NSZeroRect, pageFrame = area;
  if (devtools) {
    [_shown devToolsLayoutForSize:area.size devTools:&devtoolsFrame page:&pageFrame];
    // Chrome's rects are top-left based; ours bottom-left.
    devtoolsFrame.origin.y = NSHeight(area) - NSMaxY(devtoolsFrame);
    pageFrame.origin.y = NSHeight(area) - NSMaxY(pageFrame);
    if (devtools.superview != _content) {
      [_content addSubview:devtools positioned:NSWindowBelow relativeTo:nil];
    }
    devtools.frame = devtoolsFrame;
  }
  _shown.view.frame = pageFrame;
}

- (void)show:(NNCoreTab*)tab {
  if (_shown == tab) {
    return;
  }
  for (NSView* v in [_content.subviews copy]) {
    [v removeFromSuperview];
  }
  _shown = tab;
  if (!tab) {
    return;
  }
  // The profile shown is the Browser Chrome treats as current; the tab is its active one.
  _window.activeProfile = tab.profile;
  [_window activateTab:tab];
  [_content addSubview:tab.view];
  [self layoutContent];
  [tab focus];
  _profileSwitch.selectedSegment = [tab.profile isEqual:_profiles[@"B"]] ? 1 : 0;
  [self refreshChrome];
  Log(@{@"event" : @"shown", @"tabId" : @(tab.tabId), @"profile" : tab.profile.name ?: @""});
}

- (void)refreshChrome {
  _back.enabled = _shown.canGoBack;
  _forward.enabled = _shown.canGoForward;
  if (_address.currentEditor == nil) {
    _address.stringValue = _shown.url ?: @"";
  }
  _status.stringValue = _shown.title ?: @"";
  _progress.doubleValue = _shown.loading ? _shown.progress : 0;
  for (NSView* v in [_sidebar.arrangedSubviews copy]) {
    [_sidebar removeView:v];
  }
  for (NNCoreTab* tab in _tabs) {
    NSString* label = [NSString stringWithFormat:@"%@ %@", [tab.profile isEqual:_profiles[@"B"]] ? @"B" : @"A",
                                                 tab.title.length ? tab.title : tab.url];
    NSButton* b = [NSButton buttonWithTitle:label target:self action:@selector(tabClicked:)];
    b.tag = tab.tabId;
    b.image = tab.favicon;
    b.imagePosition = NSImageLeft;
    b.bordered = tab == _shown;
    [_sidebar addArrangedSubview:b];
  }
}

- (NNCoreTab*)tabWithId:(NSInteger)tabId {
  for (NNCoreTab* tab in _tabs) {
    if (tab.tabId == tabId) {
      return tab;
    }
  }
  return nil;
}

- (void)tabClicked:(NSButton*)sender {
  [self show:[self tabWithId:sender.tag]];
}
- (void)goBack:(id)sender {
  [_shown goBack];
}
- (void)goForward:(id)sender {
  [_shown goForward];
}
- (void)reload:(id)sender {
  [_shown reload];
}
- (void)addressEntered:(NSTextField*)sender {
  [_shown loadURL:sender.stringValue];
}
- (void)toggleDevTools:(id)sender {
  if (_shown.devToolsView) {
    [_shown closeDevTools];
  } else {
    [_shown showDevTools];
  }
}
- (void)profileSwitched:(NSSegmentedControl*)sender {
  NNCoreProfile* profile = _profiles[sender.selectedSegment == 1 ? @"B" : @"A"];
  for (NNCoreTab* tab in _tabs) {
    if ([tab.profile isEqual:profile]) {
      [self show:tab];
      return;
    }
  }
  [self show:[_window openTab:@"about:blank" profile:profile foreground:YES]];
}

// --- NNCoreWindowDelegate --------------------------------------------------------------

- (void)window:(NNCoreWindow*)window
    didInsertTab:(NNCoreTab*)tab
          opener:(NNCoreTab*)opener
     disposition:(NSString*)disposition {
  tab.delegate = self;
  _tabWindow[@(tab.tabId)] = window;
  if (window != _window) {
    // Extra windows just show their tab.
    if (![_tabs containsObject:tab]) {
      [_tabs addObject:tab];
    }
    tab.view.frame = window.hostView.bounds;
    tab.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [window.hostView addSubview:tab.view];
    Log(@{@"event" : @"didInsertTab", @"tabId" : @(tab.tabId), @"url" : tab.url,
          @"opener" : opener ? @(opener.tabId) : NSNull.null, @"disposition" : disposition,
          @"profile" : tab.profile.name ?: @"", @"offTheRecord" : @(tab.profile.offTheRecord),
          @"windowNumber" : @(window.window.windowNumber), @"extraWindow" : @YES});
    return;
  }
  if (![_tabs containsObject:tab]) {
    // Product rule (the store's job in the app): children go right after their opener.
    NSUInteger at = opener ? [_tabs indexOfObject:opener] : NSNotFound;
    if (at == NSNotFound) {
      [_tabs addObject:tab];
    } else {
      [_tabs insertObject:tab atIndex:at + 1];
    }
  }
  _origins[@(tab.tabId)] = @{@"opener" : opener ? @(opener.tabId) : NSNull.null,
                             @"disposition" : disposition};
  Log(@{@"event" : @"didInsertTab", @"tabId" : @(tab.tabId), @"url" : tab.url,
        @"opener" : opener ? @(opener.tabId) : NSNull.null, @"disposition" : disposition,
        @"profile" : tab.profile.name ?: @""});
  if (![disposition isEqualToString:@"background_tab"]) {
    [self show:tab];
  }
  [self refreshChrome];
}

- (void)window:(NNCoreWindow*)window didRemoveTab:(NNCoreTab*)tab {
  Log(@{@"event" : @"didRemoveTab", @"tabId" : @(tab.tabId)});
  [_tabs removeObject:tab];
  if (_shown == tab) {
    _shown = nil;
  }
  [self refreshChrome];
}

- (void)window:(NNCoreWindow*)window didActivateTab:(NNCoreTab*)tab {
  Log(@{@"event" : @"didActivateTab", @"tabId" : @(tab.tabId)});
}

- (void)window:(NNCoreWindow*)window devToolsDidChangeForTab:(NNCoreTab*)tab view:(NSView*)view {
  Log(@{@"event" : @"devTools", @"tabId" : @(tab.tabId), @"docked" : @(view != nil),
        @"viewClass" : view ? NSStringFromClass(view.class) : NSNull.null});
  if (!view) {
    for (NSView* v in [_content.subviews copy]) {
      if (v != _shown.view) {
        [v removeFromSuperview];
      }
    }
  }
  if (tab == _shown) {
    // Chrome reports before it shows them; lay out on the next turn too.
    [self layoutContent];
    dispatch_async(dispatch_get_main_queue(), ^{
      [self layoutContent];
    });
  }
}

- (void)window:(NNCoreWindow*)window
    passwordSavePromptForTab:(NNCoreTab*)tab
                    username:(NSString*)username
                      origin:(NSString*)origin {
  Log(@{@"event" : @"passwordPrompt", @"tabId" : @(tab.tabId), @"username" : username,
        @"origin" : origin});
  [_passwordPrompts addObject:@{@"tabId" : @(tab.tabId), @"username" : username}];
}

- (BOOL)windowShouldClose:(NNCoreWindow*)window {
  BOOL answer = ![_config[@"shouldClose"] isEqual:@NO];
  Log(@{@"event" : @"windowShouldClose", @"windowNumber" : @(window.window.windowNumber),
        @"answer" : @(answer)});
  return answer;
}

- (void)windowDidCancelClose:(NNCoreWindow*)window {
  Log(@{@"event" : @"windowDidCancelClose", @"windowNumber" : @(window.window.windowNumber)});
}

- (void)window:(NNCoreWindow*)window
    confirmCloseWithDownloads:(int)count
                   completion:(void (^)(BOOL))completion {
  BOOL answer = ![_config[@"closeWithDownloads"] isEqual:@NO];
  Log(@{@"event" : @"confirmCloseWithDownloads", @"count" : @(count), @"answer" : @(answer)});
  completion(answer);
}

- (BOOL)window:(NNCoreWindow*)window preHandleKeyEvent:(NSEvent*)event {
  // ⌘T is reserved: the menu runs it and the page never sees it.
  BOOL reserved = (event.modifierFlags & NSEventModifierFlagCommand) &&
                  [event.charactersIgnoringModifiers isEqualToString:@"t"];
  [_keyEvents addObject:@{@"call" : @"pre", @"key" : event.charactersIgnoringModifiers ?: @"",
                          @"reserved" : @(reserved)}];
  if (reserved) {
    [NSApp.mainMenu performKeyEquivalent:event];
  }
  return reserved;
}

- (BOOL)window:(NNCoreWindow*)window handleKeyEvent:(NSEvent*)event {
  [_keyEvents addObject:@{@"call" : @"handle", @"key" : event.charactersIgnoringModifiers ?: @""}];
  return NO;  // NNCore's default: the main menu.
}

- (void)window:(NNCoreWindow*)window tab:(NNCoreTab*)tab didChangeFullscreen:(BOOL)fullscreen {
  // The app would show the page alone, full screen; the spike only records it.
  Log(@{@"event" : @"fullscreen", @"tabId" : @(tab.tabId), @"fullscreen" : @(fullscreen)});
}

// --- NNCoreTabDelegate -----------------------------------------------------------------

- (void)tab:(NNCoreTab*)tab didFindMatches:(int)count active:(int)active final:(BOOL)final {
  Log(@{@"event" : @"find", @"tabId" : @(tab.tabId), @"count" : @(count), @"active" : @(active),
        @"final" : @(final)});
}

- (void)tabChanged:(NNCoreTab*)tab what:(NSString*)what {
  if ([what isEqualToString:@"progress"]) {
    Log(@{@"event" : @"progress", @"tabId" : @(tab.tabId), @"progress" : @(tab.progress)});
  } else {
    Log(@{@"event" : what, @"tabId" : @(tab.tabId), @"url" : tab.url, @"title" : tab.title,
          @"loading" : @(tab.loading), @"favicon" : @(tab.favicon != nil),
          @"canGoBack" : @(tab.canGoBack), @"canGoForward" : @(tab.canGoForward)});
  }
  if (tab == _shown || [what isEqualToString:@"title"] || [what isEqualToString:@"favicon"]) {
    [self refreshChrome];
  }
}
- (void)tabDidChangeTitle:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"title"];
}
- (void)tabDidChangeURL:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"url"];
}
- (void)tabDidChangeLoading:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"loading"];
}
- (void)tabDidChangeProgress:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"progress"];
}
- (void)tabDidChangeFavicon:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"favicon"];
}
- (void)tabDidChangeNavigationState:(NNCoreTab*)tab {
  [self tabChanged:tab what:@"navState"];
}
- (void)tab:(NNCoreTab*)tab
    didReceivePageMessage:(NSString*)kind
                     json:(NSString*)json
                    frame:(NSString*)frameId
                     main:(BOOL)main {
  Log(@{@"event" : @"pageMessage", @"tabId" : @(tab.tabId), @"kind" : kind, @"json" : json,
        @"frame" : frameId, @"main" : @(main)});
  if (!main && [kind isEqualToString:@"hello"]) {
    // As NNClient answers a frame's hello with its config: to that frame only.
    [tab callFrame:frameId kind:@"config" json:@"{\"frame\":true}"];
  }
}
- (void)tab:(NNCoreTab*)tab didRequestAppURL:(NSString*)url userGesture:(BOOL)userGesture {
  Log(@{@"event" : @"appURL", @"tabId" : @(tab.tabId), @"url" : url, @"userGesture" : @(userGesture)});
}
// --- Stage 2 ------------------------------------------------------------------------------
- (void)tabDidChangeSecurity:(NNCoreTab*)tab {
  Log(@{@"event" : @"security", @"tabId" : @(tab.tabId), @"level" : tab.securityInfo[@"level"] ?: @""});
}
- (void)tabDidChangeZoom:(NNCoreTab*)tab {
  Log(@{@"event" : @"zoom", @"tabId" : @(tab.tabId), @"factor" : @(tab.zoomFactor),
        @"pinch" : @(tab.pinchScale)});
}
- (void)tab:(NNCoreTab*)tab didBlockPopup:(NSDictionary*)popup {
  Log(@{@"event" : @"popupBlocked", @"tabId" : @(tab.tabId), @"popup" : popup});
}
- (void)tab:(NNCoreTab*)tab externalAppRequest:(NSDictionary*)request {
  Log(@{@"event" : @"externalApp", @"tabId" : @(tab.tabId), @"request" : request});
  // Never launch anything from a test: always "cancel".
  [NNCoreEngine resolveExternalApp:request[@"id"] open:NO remember:NO];
}
- (void)tabDidChangeDiscarded:(NNCoreTab*)tab {
  Log(@{@"event" : @"discarded", @"tabId" : @(tab.tabId), @"discarded" : @(tab.discarded)});
}
- (void)tabBecameUnresponsive:(NNCoreTab*)tab {
  Log(@{@"event" : @"unresponsive", @"tabId" : @(tab.tabId)});
  if ([_config[@"terminateHung"] boolValue]) {
    [tab resolveUnresponsive:YES];
  }
}
- (void)tabBecameResponsive:(NNCoreTab*)tab {
  Log(@{@"event" : @"responsive", @"tabId" : @(tab.tabId)});
}
- (void)tab:(NNCoreTab*)tab didChangeMediaAccess:(NSDictionary*)access {
  Log(@{@"event" : @"mediaAccess", @"tabId" : @(tab.tabId), @"access" : access});
}
- (void)engine:(NNCoreEngine*)engine permissionRequest:(NSDictionary*)request tab:(NNCoreTab*)tab {
  Log(@{@"event" : @"permission", @"tabId" : @(tab.tabId), @"request" : request});
  NSDictionary* answers = _config[@"permissionAnswers"];
  NSString* kind = [request[@"permissions"] firstObject] ?: @"";
  NSString* answer = answers[kind];
  if (answer) {
    [engine resolvePermission:request[@"id"] result:answer remember:NO];
  }
}
- (void)engine:(NNCoreEngine*)engine permissionRequestDismissed:(NSString*)requestId {
  Log(@{@"event" : @"permissionDismissed", @"id" : requestId});
}
- (void)engine:(NNCoreEngine*)engine extensionSidePanel:(NSDictionary*)panel tab:(NNCoreTab*)tab {
  Log(@{@"event" : @"sidePanel", @"tabId" : @(tab.tabId), @"panel" : panel});
}

- (void)tabWillClose:(NNCoreTab*)tab {
  Log(@{@"event" : @"tabWillClose", @"tabId" : @(tab.tabId)});
}
- (void)tab:(NNCoreTab*)tab rendererGone:(NSString*)status code:(int)code {
  Log(@{@"event" : @"rendererGone", @"tabId" : @(tab.tabId), @"status" : status, @"code" : @(code)});
}
- (void)tab:(NNCoreTab*)tab didFailLoad:(NSString*)url code:(int)code description:(NSString*)text {
  Log(@{@"event" : @"didFailLoad", @"tabId" : @(tab.tabId), @"url" : url, @"code" : @(code),
        @"description" : text});
}
- (void)tab:(NNCoreTab*)tab didChangeStatusText:(NSString*)text {
  Log(@{@"event" : @"statusText", @"tabId" : @(tab.tabId), @"text" : text});
}
- (void)tabDidChangeThemeColor:(NNCoreTab*)tab {
  Log(@{@"event" : @"themeColor", @"tabId" : @(tab.tabId), @"color" : tab.themeColor ?: NSNull.null});
}
- (void)tabDidGainFocus:(NNCoreTab*)tab {
  Log(@{@"event" : @"tabFocus", @"tabId" : @(tab.tabId)});
}
- (void)tabDidChangeAudio:(NNCoreTab*)tab {
  Log(@{@"event" : @"audio", @"tabId" : @(tab.tabId), @"audible" : @(tab.audible), @"muted" : @(tab.muted)});
}

// --- Test commands ---------------------------------------------------------------------

- (void)pollCommand {
  NSString* path = [gDir stringByAppendingPathComponent:@"cmd.json"];
  NSData* data = [NSData dataWithContentsOfFile:path];
  if (!data) {
    return;
  }
  [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  NSDictionary* cmd = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![cmd isKindOfClass:NSDictionary.class]) {
    return;
  }
  [self run:cmd reply:^(id result) {
    NSDictionary* out = @{@"id" : cmd[@"id"] ?: @"", @"result" : result ?: NSNull.null};
    NSData* json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    NSString* tmp = [gDir stringByAppendingPathComponent:@"result.json.tmp"];
    [json writeToFile:tmp atomically:NO];
    rename(tmp.fileSystemRepresentation,
           [gDir stringByAppendingPathComponent:@"result.json"].fileSystemRepresentation);
  }];
}

- (NSDictionary*)tabInfo:(NNCoreTab*)tab {
  NSDictionary* origin = _origins[@(tab.tabId)] ?: @{};
  NSView* view = tab.view;
  NSRect inWindow = view.window ? [view convertRect:view.bounds toView:nil] : NSZeroRect;
  return @{
    @"tabId" : @(tab.tabId), @"url" : tab.url, @"title" : tab.title,
    @"loading" : @(tab.loading), @"progress" : @(tab.progress),
    @"favicon" : @(tab.favicon != nil), @"canGoBack" : @(tab.canGoBack),
    @"canGoForward" : @(tab.canGoForward), @"profile" : tab.profile.name ?: @"",
    @"opener" : origin[@"opener"] ?: NSNull.null,
    @"disposition" : origin[@"disposition"] ?: NSNull.null,
    @"inWindow" : @(view.window == _window.window),
    @"windowNumber" : @(view.window.windowNumber),
    @"browserId" : @(tab.browserId), @"faviconURL" : tab.faviconURL ?: NSNull.null,
    @"themeColor" : tab.themeColor ?: NSNull.null, @"muted" : @(tab.muted),
    @"audible" : @(tab.audible), @"offTheRecord" : @(tab.profile.offTheRecord),
    @"frame" : NSStringFromRect(inWindow),
    @"devTools" : tab.devToolsView
        ? @{@"inWindow" : @(tab.devToolsView.window == _window.window),
            @"frame" : NSStringFromRect([tab.devToolsView convertRect:tab.devToolsView.bounds
                                                               toView:nil])}
        : NSNull.null,
  };
}

- (NSArray*)extraWindowsInfo {
  NSMutableArray* list = [NSMutableArray array];
  for (NNCoreWindow* w in _extraWindows) {
    NSMutableArray* tabs = [NSMutableArray array];
    for (NSNumber* tabId in _tabWindow) {
      NNCoreTab* t = [self tabWithId:tabId.integerValue];
      if (_tabWindow[tabId] == w && t && !t.closed) {
        [tabs addObject:@{@"tabId" : tabId, @"url" : t.url, @"offTheRecord" : @(t.profile.offTheRecord)}];
      }
    }
    [list addObject:@{@"windowNumber" : [_windowNumbers objectForKey:w] ?: @(w.window.windowNumber),
                      @"visible" : @(w.window.visible), @"hasNSWindow" : @(w.window != nil),
                      @"tabs" : tabs,
                      @"lookup" : @([NNCoreWindow windowForNSWindow:w.window] == w)}];
  }
  return list;
}

- (id)state {
  NSMutableArray* tabs = [NSMutableArray array];
  for (NNCoreTab* tab in _tabs) {
    [tabs addObject:[self tabInfo:tab]];
  }
  NSMutableArray* children = [NSMutableArray array];
  for (NSWindow* child in _window.window.childWindows) {
    [children addObject:@{@"class" : NSStringFromClass(child.class),
                          @"frame" : NSStringFromRect(child.frame),
                          @"visible" : @(child.visible),
                          @"windowNumber" : @(child.windowNumber)}];
  }
  NSMutableArray* windows = [NSMutableArray array];
  for (NSWindow* w in NSApp.windows) {
    [windows addObject:@{@"class" : NSStringFromClass(w.class),
                         @"frame" : NSStringFromRect(w.frame), @"visible" : @(w.visible),
                         @"parent" : w.parentWindow ? @(w.parentWindow.windowNumber) : NSNull.null,
                         @"windowNumber" : @(w.windowNumber), @"title" : w.title ?: @""}];
  }
  NSMutableDictionary* chromeWindows = [NSMutableDictionary dictionary];
  for (NSString* name in _profiles) {
    chromeWindows[name] = @([_window chromeWindowIdForProfile:_profiles[name]]);
  }
  return @{
    @"tabs" : tabs, @"shown" : _shown ? @(_shown.tabId) : NSNull.null,
    @"activeProfile" : _window.activeProfile.name ?: NSNull.null,
    @"profiles" : @{@"A" : _profiles[@"A"].name ?: @"", @"B" : _profiles[@"B"].name ?: @""},
    @"chromeWindowIds" : chromeWindows, @"childWindows" : children, @"appWindows" : windows,
    @"windowNumber" : @(_window.window.windowNumber),
    @"windowFrame" : NSStringFromRect(_window.window.frame),
    @"isKey" : @(_window.window.isKeyWindow), @"appActive" : @(NSApp.active),
    @"passwordPrompts" : _passwordPrompts,
    @"keepAlive" : NNCoreEngine.sharedEngine.keepAliveState,
    @"extraWindows" : [self extraWindowsInfo],
    @"menuHits" : _menuHits, @"keyEvents" : _keyEvents,
    @"appDelegate" : NSStringFromClass([(NSObject*)NSApp.delegate class]),
    @"appClass" : NSStringFromClass(NSApp.class),
  };
}

- (NNCoreWindow*)windowWithNumber:(NSInteger)number {
  if (_window.window.windowNumber == number) {
    return _window;
  }
  for (NNCoreWindow* w in _extraWindows) {
    if ([[_windowNumbers objectForKey:w] integerValue] == number) {
      return w;
    }
  }
  return nil;
}

- (NSDictionary*)windowStyleInfo {
  NSWindow* w = _window.window;
  return @{
    @"styleMask" : @(w.styleMask),
    @"fullSizeContentView" : @((w.styleMask & NSWindowStyleMaskFullSizeContentView) != 0),
    @"titlebarTransparent" : @(w.titlebarAppearsTransparent),
    @"titleHidden" : @(w.titleVisibility == NSWindowTitleHidden),
    @"background" : w.backgroundColor.description ?: @"",
    @"minSize" : NSStringFromSize(w.minSize),
    @"frame" : NSStringFromRect(w.frame),
    @"contentView" : NSStringFromRect(w.contentView.frame),
    @"hostView" : NSStringFromRect([_window.hostView convertRect:_window.hostView.bounds toView:nil]),
    @"closeButton" : NSStringFromPoint([w standardWindowButton:NSWindowCloseButton].frame.origin),
  };
}

// A key down delivered as AppKit delivers one to the key window: the window's key
// equivalents (the first responder's view tree), then the main menu, then keyDown:. The
// test window can't be key, so isKeyWindow is faked for it (as Chromium's
// ScopedFakeNSWindowFocus does).
- (NSDictionary*)deliverKey:(NSDictionary*)cmd tab:(NNCoreTab*)tab {
  NSWindow* window = _window.window;
  if ([cmd[@"target"] isEqualToString:@"field"]) {
    [window makeFirstResponder:_address];
  } else {
    [tab focus];
  }
  NSString* key = cmd[@"key"];
  NSEventModifierFlags flags = [cmd[@"meta"] boolValue] ? NSEventModifierFlagCommand : 0;
  NSString* chars = key;
  NSUInteger before = _menuHits.count;
  NSEvent* event = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:flags
                                   timestamp:NSProcessInfo.processInfo.systemUptime
                                windowNumber:window.windowNumber context:nil characters:chars
                 charactersIgnoringModifiers:key isARepeat:NO keyCode:[cmd[@"keyCode"] unsignedShortValue]];
  NSString* responder = NSStringFromClass(window.firstResponder.class);
  BOOL byWindow = NO;
  BOOL byMenu = NO;
  if ([cmd[@"direct"] boolValue]) {
    // What a not-key window's page gets from a dev harness: RenderWidgetHostViewCocoa's
    // key-equivalent entry point, called directly.
    gFakeKey = NO;
    SEL sel = NSSelectorFromString(@"keyEvent:wasKeyEquivalent:");
    ((void (*)(id, SEL, NSEvent*, BOOL))[window.firstResponder methodForSelector:sel])(
        window.firstResponder, sel, event, YES);
    byWindow = YES;
  } else if (!(byWindow = [window performKeyEquivalent:event])) {
    byMenu = [NSApp.mainMenu performKeyEquivalent:event];
    if (!byMenu) {
      [window sendEvent:event];
    }
  }
  NSEvent* up = [NSEvent keyEventWithType:NSEventTypeKeyUp location:NSZeroPoint modifierFlags:flags
                                timestamp:NSProcessInfo.processInfo.systemUptime
                             windowNumber:window.windowNumber context:nil characters:chars
              charactersIgnoringModifiers:key isARepeat:NO keyCode:[cmd[@"keyCode"] unsignedShortValue]];
  [window sendEvent:up];
  return @{@"firstResponder" : responder, @"handledByWindow" : @(byWindow),
           @"handledByMenu" : @(byMenu), @"menuHitsNow" : @(_menuHits.count - before),
           @"textInputClient" : @([window.firstResponder conformsToProtocol:@protocol(NSTextInputClient)])};
}

- (void)run:(NSDictionary*)cmd reply:(void (^)(id))reply {
  NSString* name = cmd[@"cmd"];
  NNCoreTab* tab = cmd[@"tabId"] ? [self tabWithId:[cmd[@"tabId"] integerValue]] : _shown;
  NNCoreProfile* profile = _profiles[cmd[@"profile"] ?: @"A"];
  if ([name isEqualToString:@"state"]) {
    reply([self state]);
  } else if ([name isEqualToString:@"open"]) {
    NNCoreTab* t = [_window openTab:cmd[@"url"] profile:profile
                         foreground:![cmd[@"background"] boolValue]];
    reply(t ? [self tabInfo:t] : NSNull.null);
  } else if ([name isEqualToString:@"show"]) {
    [self show:tab];
    reply([self state]);
  } else if ([name isEqualToString:@"profile"]) {
    _profileSwitch.selectedSegment = [cmd[@"profile"] isEqual:@"B"] ? 1 : 0;
    [self profileSwitched:_profileSwitch];
    reply([self state]);
  } else if ([name isEqualToString:@"nav"]) {
    NSString* action = cmd[@"action"];
    if ([action isEqualToString:@"back"]) [tab goBack];
    else if ([action isEqualToString:@"forward"]) [tab goForward];
    else if ([action isEqualToString:@"reload"]) [tab reload];
    else if ([action isEqualToString:@"stop"]) [tab stop];
    else if ([action isEqualToString:@"close"]) [tab close];
    else if ([action isEqualToString:@"closeNow"]) [tab closeNow];
    else if ([action isEqualToString:@"load"]) [tab loadURL:cmd[@"url"]];
    reply(@YES);
  } else if ([name isEqualToString:@"devtools"]) {
    if ([cmd[@"open"] boolValue]) [tab showDevTools];
    else [tab closeDevTools];
    reply(@YES);
  } else if ([name isEqualToString:@"ext.load"]) {
    [profile loadUnpackedExtension:cmd[@"path"]
                        completion:^(NSString* extId, NSString* error) {
                          Log(@{@"event" : @"extensionLoaded", @"id" : extId ?: NSNull.null,
                                @"error" : error ?: NSNull.null});
                          reply(@{@"id" : extId ?: NSNull.null, @"error" : error ?: NSNull.null});
                        }];
  } else if ([name isEqualToString:@"ext.list"]) {
    reply(profile.extensions);
  } else if ([name isEqualToString:@"ext.popup"]) {
    // Under the right end of our toolbar, as Dia's extension button.
    NSRect anchor = [_toolbar convertRect:NSMakeRect(NSWidth(_toolbar.bounds) - 40, 0, 32, 40)
                                   toView:nil];
    BOOL ok = [tab openActionPopupForExtension:cmd[@"extId"] anchor:anchor];
    reply(@(ok));
  } else if ([name isEqualToString:@"nativeClick"]) {
    // A real AppKit mouse click on the page (CSS pixels from the page's top left), delivered
    // to the view AppKit's hit-testing finds, without making the window key.
    NSView* view = tab.view;
    CGFloat x = [cmd[@"x"] doubleValue], y = [cmd[@"y"] doubleValue];
    NSPoint inView = view.isFlipped ? NSMakePoint(x, y) : NSMakePoint(x, NSHeight(view.bounds) - y);
    NSPoint inWindow = [view convertPoint:inView toView:nil];
    NSView* content = _window.window.contentView;
    NSView* hit = [content hitTest:[content.superview convertPoint:inWindow fromView:nil]];
    NSEventModifierFlags flags = [cmd[@"command"] boolValue] ? NSEventModifierFlagCommand : 0;
    for (NSEventType type : {NSEventTypeLeftMouseDown, NSEventTypeLeftMouseUp}) {
      NSEvent* e = [NSEvent mouseEventWithType:type location:inWindow modifierFlags:flags
                                     timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:_window.window.windowNumber context:nil
                                   eventNumber:0 clickCount:1 pressure:1];
      if (type == NSEventTypeLeftMouseDown) [hit mouseDown:e];
      else [hit mouseUp:e];
    }
    reply(@{@"hit" : hit ? NSStringFromClass(hit.class) : NSNull.null,
            @"inWindow" : NSStringFromPoint(inWindow)});
  } else if ([name isEqualToString:@"chromeCommand"]) {
    reply(@([_window executeChromeCommand:[cmd[@"command"] intValue] profile:profile]));
  } else if ([name isEqualToString:@"find"]) {
    [tab find:cmd[@"text"] forward:YES];
    reply(@YES);
  } else if ([name isEqualToString:@"focus"]) {
    [tab focus];
    reply(@{@"firstResponder" : NSStringFromClass(_window.window.firstResponder.class)});
  } else if ([name isEqualToString:@"pw.save"]) {
    [tab savePendingPassword];
    reply(@YES);
  } else if ([name isEqualToString:@"logins"]) {
    [profile fetchSavedLogins:^(NSArray* logins) {
      reply(logins);
    }];
  } else if ([name isEqualToString:@"config"]) {
    [_config addEntriesFromDictionary:cmd[@"values"] ?: @{}];
    reply(_config);
  } else if ([name isEqualToString:@"newWindow"]) {
    NNCoreWindow* w = [self newWindow];
    NNCoreTab* t = [w openTab:cmd[@"url"] profile:profile foreground:YES];
    reply(@{@"windowNumber" : @(w.window.windowNumber), @"tabId" : t ? @(t.tabId) : NSNull.null});
  } else if ([name isEqualToString:@"closeWindow"]) {
    NNCoreWindow* w = [self windowWithNumber:[cmd[@"windowNumber"] integerValue]];
    if ([cmd[@"performClose"] boolValue]) {
      [w.window performClose:nil];  // the title bar's close button
    } else {
      [w close];
    }
    reply(@(w != nil));
  } else if ([name isEqualToString:@"terminate"]) {
    reply(@YES);
    dispatch_async(dispatch_get_main_queue(), ^{
      if ([cmd[@"appleEvent"] boolValue]) {
        // The Dock's Quit, logout and `osascript … to quit` send kAEQuitApplication.
        NSAppleEventDescriptor* target =
            [NSAppleEventDescriptor descriptorWithProcessIdentifier:getpid()];
        NSAppleEventDescriptor* event =
            [NSAppleEventDescriptor appleEventWithEventClass:kCoreEventClass
                                                     eventID:kAEQuitApplication
                                            targetDescriptor:target
                                                    returnID:kAutoGenerateReturnID
                                               transactionID:kAnyTransactionID];
        NSError* error = nil;
        [event sendEventWithOptions:NSAppleEventSendNoReply timeout:5 error:&error];
        Log(@{@"event" : @"quitAppleEventSent", @"error" : error.description ?: NSNull.null});
      } else {
        [NSApp terminate:nil];
      }
    });
  } else if ([name isEqualToString:@"key"]) {
    gFakeKey = YES;
    NSDictionary* result = [self deliverKey:cmd tab:tab];
    gFakeKey = NO;
    reply(result);
  } else if ([name isEqualToString:@"evaluate"]) {
    [tab evaluate:cmd[@"code"] completion:^(NSString* json) {
      reply(json ?: NSNull.null);
    }];
  } else if ([name isEqualToString:@"exec"]) {
    [tab executeJavaScript:cmd[@"code"]];
    reply(@YES);
  } else if ([name isEqualToString:@"callPage"]) {
    [tab callPage:cmd[@"kind"] json:cmd[@"json"]];
    reply(@YES);
  } else if ([name isEqualToString:@"tabInfo"]) {
    reply(tab ? @{@"info" : [self tabInfo:tab], @"entries" : tab.navigationEntries} : NSNull.null);
  } else if ([name isEqualToString:@"mute"]) {
    tab.muted = [cmd[@"muted"] boolValue];
    reply(@(tab.muted));
  } else if ([name isEqualToString:@"goToOffset"]) {
    [tab goToOffset:[cmd[@"offset"] intValue]];
    reply(@YES);
  } else if ([name isEqualToString:@"loadUser"]) {
    [tab loadURL:cmd[@"url"] userInitiated:[cmd[@"user"] boolValue]];
    reply(@YES);
  } else if ([name isEqualToString:@"reloadHard"]) {
    [tab reloadIgnoringCache];
    reply(@YES);
  } else if ([name isEqualToString:@"placeTab"]) {
    [_window placeTab:tab index:[cmd[@"index"] intValue] pinned:[cmd[@"pinned"] boolValue]];
    NSMutableArray* order = [NSMutableArray array];
    for (NNCoreTab* t in [_window tabsForProfile:profile]) {
      [order addObject:@(t.tabId)];
    }
    reply(order);
  } else if ([name isEqualToString:@"adoptTab"]) {
    [_window adoptTab:tab];
    _tabWindow[@(tab.tabId)] = _window;
    reply(@{@"inMain" : @(tab.view.window == _window.window || !tab.view.window),
            @"closed" : @(tab.closed)});
  } else if ([name isEqualToString:@"incognito"]) {
    NNCoreProfile* otr = [NNCoreEngine.sharedEngine offTheRecordProfileFor:profile];
    reply(@{@"name" : otr.name ?: @"", @"offTheRecord" : @(otr.offTheRecord),
            @"command" : @([_window executeChromeCommand:34001 /* IDC_NEW_INCOGNITO_WINDOW */
                                                 profile:profile])});
  } else if ([name isEqualToString:@"styleWindow"]) {
    // What the RN host does to its window after -initWithContentRect:.
    NSWindow* w = _window.window;
    w.styleMask |= NSWindowStyleMaskFullSizeContentView;
    w.titlebarAppearsTransparent = YES;
    w.titleVisibility = NSWindowTitleHidden;
    w.backgroundColor = NSColor.systemPinkColor;
    w.minSize = NSMakeSize(500, 400);
    [w standardWindowButton:NSWindowCloseButton].frameOrigin = NSMakePoint(20, 10);
    [w setFrame:NSOffsetRect(w.frame, 1, 0) display:YES];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      reply([self windowStyleInfo]);
    });
  } else if ([name isEqualToString:@"windowStyle"]) {
    reply([self windowStyleInfo]);
  } else if ([name isEqualToString:@"component"]) {
    if (cmd[@"unload"]) {
      [profile unloadComponentExtension:cmd[@"unload"]];
      reply(@YES);
    } else {
      reply([profile loadComponentExtension:cmd[@"path"]] ?: NSNull.null);
    }
  } else if ([name isEqualToString:@"security"]) {
    reply(tab.securityInfo);
  } else if ([name isEqualToString:@"zoom"]) {
    if (cmd[@"factor"]) tab.zoomFactor = [cmd[@"factor"] doubleValue];
    if (cmd[@"step"]) [tab zoomStep:[cmd[@"step"] intValue]];
    reply(@(tab.zoomFactor));
  } else if ([name isEqualToString:@"tabCommand"]) {
    reply(@([tab executeChromeCommand:[cmd[@"command"] intValue]]));
  } else if ([name isEqualToString:@"openPopup"]) {
    [tab openBlockedPopup:cmd[@"popupId"] always:[cmd[@"always"] boolValue]];
    reply(@YES);
  } else if ([name isEqualToString:@"discard"]) {
    reply(@{@"ok" : @([tab discard]), @"discarded" : @(tab.discarded)});
  } else if ([name isEqualToString:@"frozen"]) {
    tab.frozen = [cmd[@"value"] boolValue];
    reply(@(tab.frozen));
  } else if ([name isEqualToString:@"background"]) {
    tab.pageBackgroundColor = cmd[@"color"] ? NSColor.systemTealColor : nil;
    reply(@(tab.pageBackgroundColor != nil));
  } else if ([name isEqualToString:@"extAction"]) {
    reply([tab executeExtensionAction:cmd[@"extId"]]);
  } else if ([name isEqualToString:@"actionStates"]) {
    reply([tab actionStatesForExtensions:cmd[@"ids"]]);
  } else if ([name isEqualToString:@"sidePanelURL"]) {
    reply([tab sidePanelURLForExtension:cmd[@"extId"]] ?: NSNull.null);
  } else if ([name isEqualToString:@"pref"]) {
    if (cmd[@"value"]) [profile setBoolPreference:cmd[@"name"] value:[cmd[@"value"] boolValue]];
    reply([profile boolPreference:cmd[@"name"]] ?: NSNull.null);
  } else if ([name isEqualToString:@"clearData"]) {
    [profile clearBrowsingData:cmd[@"types"] since:nil completion:^{
      reply(@YES);
    }];
  } else if ([name isEqualToString:@"quit"]) {
    reply(@YES);
    dispatch_async(dispatch_get_main_queue(), ^{
      [NNCoreEngine.sharedEngine quit];
    });
  } else {
    reply(@{@"error" : [NSString stringWithFormat:@"unknown command %@", name]});
  }
}

@end

// Tests only: the hidden test window counts as key (Chromium's ScopedFakeNSWindowFocus),
// so AppKit-path key equivalents reach the page as they do in a key window.
static BOOL (*gOriginalIsKeyWindow)(id, SEL);
static BOOL FakeIsKeyWindow(NSWindow* self, SEL _cmd) {
  if (gFakeKey && [NNCoreWindow windowForNSWindow:self]) {
    return YES;
  }
  return gOriginalIsKeyWindow(self, _cmd);
}

int main(int argc, const char* argv[]) {
  {
    Method m = class_getInstanceMethod([NSWindow class], @selector(isKeyWindow));
    gOriginalIsKeyWindow = (BOOL(*)(id, SEL))method_getImplementation(m);
    method_setImplementation(m, (IMP)FakeIsKeyWindow);
  }
  // Never touch NSApp before Chromium does: it makes NSApp its own NSApplication subclass.
  const char* dir = getenv("NNHOST_DIR");
  gDir = dir ? @(dir) : [NSTemporaryDirectory() stringByAppendingPathComponent:@"nncore-host"];
  [NSFileManager.defaultManager createDirectoryAtPath:gDir
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  std::string data_dir = std::string("--user-data-dir=") +
                         [gDir stringByAppendingPathComponent:@"data"].UTF8String;
  std::vector<const char*> args(argv, argv + argc);
  bool helper = false;
  for (int i = 1; i < argc; ++i) {
    helper |= strncmp(argv[i], "--type=", 7) == 0;
  }
  std::string port;
  if (!helper) {
    args.push_back(data_dir.c_str());
    if (const char* p = getenv("NNHOST_CDP_PORT")) {
      port = std::string("--remote-debugging-port=") + p;
      args.push_back(port.c_str());
    }
    // Keeps the test instance off the network's Google endpoints and the keychain.
    args.push_back("--use-mock-keychain");
    args.push_back("--password-store=basic");
  }
  static Host* host = [[Host alloc] init];
  return [NNCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:host];
}
