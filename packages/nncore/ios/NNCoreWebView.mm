// The WebView on NNCore. It hosts one live tab, an NNCoreTab: Chrome's WebContents in the Browser of its window
// and profile, with its page view placed straight in this view.
//
// Where packages/cef adopts popups by id after the fact (OnBeforePopup → JS → a new browser adopts the popup,
// with a 30 s orphan timer and a replay of the navigation), Chrome here has already made the tab with its
// navigation (POST body included): the app gets onOpenWindow with "nncore:<id>", and the WebView it mounts
// takes that live tab.
#import "NNCoreWebView.h"
#import "NNCoreWebViewInternal.h"
#import "NNCorePictureInPicture.h"
#import "NNCoreServices.h"

#import <IOKit/IOKitLib.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

#import "NNCoreNavigationDownloads.h"

#include <climits>
#include <cmath>

namespace {

// NETNYAHOO_TRACE_VISIBILITY=1: each change of what a WebView shows, for chasing a page Chrome reports hidden.
bool TraceVisibility() {
  static const bool on = getenv("NETNYAHOO_TRACE_VISIBILITY") != nullptr;
  return on;
}

constexpr CFTimeInterval kTransferWindow = 3;
// The tab's current parking (closeBrowser), so an earlier parking's deadline leaves a later one alone.
const char kParkingKey = 0;
// How long a page that left the screen keeps painting (leaveScreen): a few frames, under load too.
constexpr CFTimeInterval kLeaveScreenDelay = 0.1;

NSHashTable<NNCoreWebView *> *LiveViews() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}

// Views whose visible or warm prop changed this run-loop turn, and whether the drain is scheduled (schedulePainting).
NSHashTable<NNCoreWebView *> *PendingPainting() {
  static NSHashTable *views = [NSHashTable weakObjectsHashTable];
  return views;
}
bool gPaintingScheduled = false;

NSMutableDictionary<NSString *, NSNumber *> *TransferRequests() {
  static NSMutableDictionary *requests = [NSMutableDictionary dictionary];
  return requests;
}

bool TransferRequested(NSString *key) {
  if (!key.length) return false;
  NSNumber *at = TransferRequests()[key];
  return at && CACurrentMediaTime() - at.doubleValue < kTransferWindow;
}

// A tab whose view unmounted while it moves to another window (prepareTransfer), until its new view takes it.
NSMutableDictionary<NSString *, NNCoreTab *> *Parked() {
  static NSMutableDictionary *parked = [NSMutableDictionary dictionary];
  return parked;
}

NSView *ParkingView() {
  static NSView *view = [[NSView alloc] initWithFrame:NSZeroRect];
  return view;
}

bool SamePage(NSString *a, NSString *b) {
  auto strip = [](NSString *url) {
    NSRange hash = [url rangeOfString:@"#"];
    return hash.location == NSNotFound ? url : [url substringToIndex:hash.location];
  };
  return a && b && [strip(a) isEqualToString:strip(b)];
}

// Chrome's renderer debug URLs (blink::IsRendererDebugURL and the GPU ones content handles), as chrome:// or as the
// netnyahoo:// the app shows them as.
bool IsRendererDebugURL(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  if (![@[ @"chrome", @"netnyahoo" ] containsObject:c.scheme.lowercaseString ?: @""]) return false;
  static NSSet *hosts = [NSSet setWithArray:@[
    @"badcastcrash", @"crash", @"crashdump", @"kill", @"hang", @"shorthang", @"memory-exhaust", @"memory-pressure-critical",
    @"memory-pressure-moderate", @"gpuclean", @"gpucrash", @"gpuhang", @"inducebrowsercrashforrealz",
    @"inducebrowserdcheckforrealz", @"cfi-crash", @"heap-corruption-crash"
  ]];
  return [hosts containsObject:c.host.lowercaseString ?: @""];
}

// Chrome names a page after its URL until the page names itself (NavigationEntryImpl::GetTitleForDisplay: the URL
// without "http(s)://", "www." or a bare host's slash, spaces unescaped). While the page loads that stand-in isn't
// reported: it changed the tab's title once more per load (one more store update for every listener and row), and the
// page's own title follows within a frame or two. A page that never names itself gets it once loaded, as Chrome shows.
NSString *ReportedTitle(NSString *title, NSString *url, BOOL loading) {
  if (!loading || !title.length) return title ?: @"";
  NSURLComponents *c = [NSURLComponents componentsWithString:url];
  NSString *scheme = c.scheme.lowercaseString;
  if ((![scheme isEqualToString:@"http"] && ![scheme isEqualToString:@"https"]) || ![[url substringWithRange:NSMakeRange(scheme.length, MIN(3, url.length - scheme.length))] isEqualToString:@"://"])
    return title;
  NSString *shown = [url substringFromIndex:scheme.length + 3];
  if ([shown.lowercaseString hasPrefix:@"www."]) shown = [shown substringFromIndex:4];
  if ([c.path isEqualToString:@"/"] && !c.query && !c.fragment && [shown hasSuffix:@"/"]) shown = [shown substringToIndex:shown.length - 1];
  shown = [shown stringByReplacingOccurrencesOfString:@"%20" withString:@" "];
  return [title isEqualToString:shown] ? @"" : title;
}

NSString *PNGDataURL(NSImage *image) {
  CGImageRef cg = [image CGImageForProposedRect:nil context:nil hints:nil];
  if (!cg) return nil;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png.length ? [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]] : nil;
}

id JSONValue(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  return data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
}

template <typename T>
T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max) {
  NSString *s = Field<NSString>(d, key);
  if (s.length <= max) return s;
  return [s substringToIndex:[s rangeOfComposedCharacterSequenceAtIndex:max].location];
}

bool Flag(NSDictionary *d, NSString *key) {
  return Field<NSNumber>(d, key).boolValue;
}

bool Finite(NSDictionary *d, NSString *key, double *out) {
  NSNumber *n = Field<NSNumber>(d, key);
  if (!n || !std::isfinite(n.doubleValue)) return false;
  *out = n.doubleValue;
  return true;
}

NSString *OriginOf(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url ?: @""];
  if (!c.scheme.length || !c.host.length) return nil;
  return c.port ? [NSString stringWithFormat:@"%@://%@:%@", c.scheme, c.host, c.port] : [NSString stringWithFormat:@"%@://%@", c.scheme, c.host];
}

NSDictionary *NowPlayingState(NSDictionary *d) {
  NSString *state = Field<NSString>(d, @"playbackState");
  if (![@[ @"none", @"paused", @"playing" ] containsObject:state]) state = @"none";
  NSMutableArray *actions = [NSMutableArray array];
  for (id action in Field<NSArray>(d, @"actions"))
    if ([action isKindOfClass:NSString.class] && [action length] <= 64 && actions.count < 32) [actions addObject:action];
  double position = 0, duration = 0, rate = 1, timestamp = 0;
  Finite(d, @"position", &position);
  const bool hasDuration = Finite(d, @"duration", &duration) && duration >= 0;
  Finite(d, @"playbackRate", &rate);
  Finite(d, @"timestamp", &timestamp);
  return @{
    @"frame" : Text(d, @"frame", 64) ?: @"",
    @"title" : Text(d, @"title", 1024) ?: @"",
    @"artist" : Text(d, @"artist", 1024) ?: @"",
    @"album" : Text(d, @"album", 1024) ?: @"",
    @"artwork" : Text(d, @"artwork", 1 << 20) ?: NSNull.null,
    @"playbackState" : state,
    @"position" : @(MAX(position, 0)),
    @"duration" : hasDuration ? @(duration) : NSNull.null,
    @"playbackRate" : @(rate),
    @"timestamp" : @(timestamp),
    @"hasVideo" : @(Flag(d, @"hasVideo")),
    @"actions" : actions,
  };
}

NSDictionary *SelectionState(NSDictionary *d) {
  NSString *text = Text(d, @"text", 4000);
  NSDictionary *rect = Field<NSDictionary>(d, @"rect");
  double x, y, width, height;
  if (!text || !Finite(rect, @"x", &x) || !Finite(rect, @"y", &y) || !Finite(rect, @"width", &width) ||
      !Finite(rect, @"height", &height))
    return nil;
  return @{@"text" : text, @"rect" : @{@"x" : @(x), @"y" : @(y), @"width" : @(width), @"height" : @(height)}};
}

// The last events each tab's view sent (names and payloads), for tests (devEvents).
NSMutableDictionary<NSNumber *, NSMutableArray *> *RecentEvents() {
  static NSMutableDictionary *events = [NSMutableDictionary dictionary];
  return events;
}

void NoteEvent(int browserId, NSString *name, NSDictionary *payload) {
#if DEBUG
  NSMutableArray *list = RecentEvents()[@(browserId)];
  if (!list) RecentEvents()[@(browserId)] = list = [NSMutableArray array];
  NSMutableDictionary *brief = [NSMutableDictionary dictionary];
  for (NSString *key in payload) {
    id value = payload[key];
    brief[key] = [value isKindOfClass:NSString.class] && [value length] > 200 ? [value substringToIndex:200] : value;
  }
  [list addObject:@{@"name" : name, @"payload" : brief, @"t" : @(round(CACurrentMediaTime() * 1000))}];
  if (list.count > 80) [list removeObjectAtIndex:0];
#endif
}

// The search engine the app names in its menu ("Search Google for …"), as CEF's NNClient keeps it.
NSString *gSearchEngineName = @"Google";
// The app's screen-share picker (setDisplayMediaPicker): pages' getDisplayMedia asks the app for a source.
BOOL gDisplayMediaPicker = NO;

// CEF's SelectionLabel: whitespace collapsed, cut near 50 characters at a word.
NSString *SelectionLabel(NSString *text) {
  NSArray *words = [text componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSString *collapsed = [[words filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]]
      componentsJoinedByString:@" "];
  if (collapsed.length <= 50) return collapsed;
  NSRange space = [collapsed rangeOfString:@" " options:NSBackwardsSearch range:NSMakeRange(0, 50)];
  NSUInteger end = space.location != NSNotFound && space.location > 25 ? space.location : 50;
  end = [collapsed rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, end)].length;
  return [[collapsed substringToIndex:end] stringByAppendingString:@"…"];
}

// Chrome's menu model items (ui::MenuModel::ItemType in "type"; an older engine says "separator") as CEF's
// DescribeMenu wrote them for NETNYAHOO_CONTEXT_MENU_LOG: cef_menu_item_type_t, CefSimpleMenuModelImpl's mapping.
constexpr int kMenuSeparator = 3;

int MenuItemType(NSDictionary *item) {
  if (NSNumber *type = Field<NSNumber>(item, @"type")) return type.intValue;
  return Flag(item, @"separator") ? kMenuSeparator : 0;
}

NSString *MenuTitle(NSString *label);

NSArray *DescribeMenu(NSArray *items) {
  NSMutableArray *out = [NSMutableArray array];
  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    static const int kCefTypes[] = {1, 2, 3, 4, 0, 5, 5};  // command, check, radio, separator, button, submenus
    const int type = MenuItemType(item);
    NSMutableDictionary *described = [@{
      @"id" : Field<NSNumber>(item, @"id") ?: @0,
      @"label" : MenuTitle(Field<NSString>(item, @"label") ?: @""),
      @"type" : @(type >= 0 && type < 7 ? kCefTypes[type] : 0),
      @"enabled" : @(Flag(item, @"enabled")),
      @"visible" : @(Field<NSNumber>(item, @"visible") ? Flag(item, @"visible") : YES),
    } mutableCopy];
    if (NSArray *submenu = Field<NSArray>(item, @"submenu")) described[@"submenu"] = DescribeMenu(submenu);
    [out addObject:described];
  }
  return out;
}

// A Chrome menu label as its Mac menus show it (l10n_util::FixUpWindowsStyleLabel): no Windows mnemonics ("&Copy",
// "Emoji && Symbols"), as CEF's background guard logged the NSMenu's titles.
NSString *MenuTitle(NSString *label) {
  NSMutableString *title = [NSMutableString stringWithCapacity:label.length];
  for (NSUInteger i = 0; i < label.length; i++) {
    const unichar c = [label characterAtIndex:i];
    if (c != '&') {
      [title appendFormat:@"%C", c];
    } else if (i + 1 < label.length && [label characterAtIndex:i + 1] == '&') {
      [title appendString:@"&"];
      i++;
    }
  }
  return title;
}

NSNumber *FindMenuItem(NSArray *items, NSString *label) {
  for (NSDictionary *item in items) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    if ([MenuTitle(Field<NSString>(item, @"label") ?: @"") isEqualToString:label]) return Field<NSNumber>(item, @"id");
    if (NSNumber *found = FindMenuItem(Field<NSArray>(item, @"submenu"), label)) return found;
  }
  return nil;
}

NSString *JSONString(id value) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"null";
}

}  // namespace

@interface NNCoreWebView () <NNCoreTabDelegate>
@end

@implementation NNCoreWebView {
  NNCoreTab *_tab;
  // The app's first load (a restored tab's URL), and the URL the app last asked for until a document commits: what a
  // navigation that became a download remembers (NNCoreNavigationDownloads).
  BOOL _loadedOnce;
  BOOL _pendingUserInitiated;
  NSString *_requestedURL;
  BOOL _creating;
  BOOL _closing;
  BOOL _moving;
  NSString *_pendingURL;
  // The URL a new tab opens with: the page's first loadURL asks for it again (ContentCard), and loading it twice
  // would run the page twice.
  NSString *_creatingURL;
  CFTimeInterval _creatingAt;
  NSString *_transferredURL;
  BOOL _muted;
  NSInteger _tabIndex;
  BOOL _pinned;
  NSView *_devtoolsView;
  BOOL _navigationQueued;
  NSString *_pageTheme;
  NSString *_pageThemeSource;
  NSUInteger _createGeneration;
  NSUInteger _blockedGeneration;
  // Requests the content blocker stopped on this page (onContentBlocked), as CEF's NNClient counts them.
  NSInteger _blockedCount;
  NSString *_lastBlocked;
  BOOL _blockedEmitQueued;
  NSDictionary *_sentNavigation;
  NSString *_lastFavicon;
  CFTimeInterval _sentProgressAt;
  double _sentProgress;
  BOOL _progressQueued;
  // The page script's reports, per frame (as packages/cef's NNClient keeps them).
  NSMutableDictionary<NSString *, NSNumber *> *_mediaFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_nowPlaying;
  NSString *_nowPlayingFrame;
  NSMutableDictionary<NSString *, NSString *> *_notificationFrames;
  NSMutableDictionary<NSString *, NSDictionary *> *_displayRequests;
  double _pinchScale;
  BOOL _autoPictureInPictureActive;
  // The page uses the camera, microphone or screen (CEF's capturing_): auto Picture in Picture takes its document PiP.
  BOOL _capturing;
  // Its renderer died and nothing loaded since (emitNavigation).
  BOOL _crashed;
  // Just left the screen: still painting (visible to Chrome), at alpha 0, for kLeaveScreenDelay.
  BOOL _leaving;
  NSUInteger _leaveGeneration;
}

+ (void)prepareTransfer:(NSString *)transferKey {
  if (transferKey.length) TransferRequests()[transferKey] = @(CACurrentMediaTime());
}

- (instancetype)initWithFrame:(NSRect)frameRect {
  if ((self = [super initWithFrame:frameRect])) {
    _profile = @"";
    _visible = YES;
    _tabIndex = -1;
    self.wantsLayer = YES;
  }
  return self;
}

- (void)dealloc {
  [self closeBrowser];
}

- (BOOL)isFlipped {
  return YES;
}

- (int)browserId {
  return _tab ? nncore_host::BrowserId(_tab) : 0;
}

- (int)chromeTabId {
  return _tab ? _tab.tabId : 0;
}

- (NNCoreWindowController *)controller {
  return [NNCoreWindowController forNSWindow:self.window];
}

// MARK: The tab

- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (TraceVisibility()) NSLog(@"[nncore-vis] %@ window=%ld tab=%d", _transferKey, (long)self.window.windowNumber, _tab ? (int)_tab.tabId : -1);
  if (!self.window) return;
  if (_tab) [self adoptIntoWindow];
  else [self ensureTab];
}

- (void)setExtensionHost:(NSString *)extensionHost {
  _extensionHost = [extensionHost copy];
  // Never in a tab strip, as a standalone view.
  if (_extensionHost.length) _standalone = YES;
}

- (void)setAdoptId:(NSString *)adoptId {
  _adoptId = [adoptId copy];
  if (self.window) [self ensureTab];
}

- (void)ensureTab {
  if (_tab || _creating || !self.window || !NNCoreHost.isStarted || !self.controller) return;
  if (TransferRequested(_transferKey) && [self takeTransferredTab]) return;
  if ([_adoptId hasPrefix:@"nncore:"] || [_adoptId hasPrefix:@"tab:"]) {
    NNCoreTab *offered = [NNCoreTabs takeOffered:_adoptId];
    _adoptId = nil;
    // Never a private tab in a normal view, or the reverse, and a private view takes only Personal's private tabs
    // (its profile): the view loads its URL itself instead.
    const BOOL wantsPrivate = nncore_host::IsIncognito(_profile);
    if (offered && (!offered.profile || offered.profile.offTheRecord != wantsPrivate ||
                    (wantsPrivate && ![offered.profile.name isEqualToString:@"Default"]))) {
      [offered closeNow];
      offered = nil;
    }
    if (offered && !offered.closed) return [self attach:offered];
  }
  // "restore:<closed tab id>" and "clone:<source tab id>": a tab with history (⇧⌘T, Duplicate).
  NSString *kind = nil, *key = nil;
  NSRange colon = _adoptId ? [_adoptId rangeOfString:@":"] : NSMakeRange(NSNotFound, 0);
  if (colon.location != NSNotFound) {
    kind = [_adoptId substringToIndex:colon.location];
    key = [_adoptId substringFromIndex:NSMaxRange(colon)];
  }
  _adoptId = nil;
  _creating = YES;
  // A close (or a new creation) while Chrome is asked makes this one stale.
  const NSUInteger generation = ++_createGeneration;
  __weak NNCoreWebView *weakSelf = self;
  nncore_host::WithProfile(_profile, ^(NNCoreProfile *profile) {
    NNCoreWebView *view = weakSelf;
    if (!view || view->_createGeneration != generation) return;
    view->_creating = NO;
    NNCoreWindowController *controller = view.controller;
    if (!profile || view->_tab || !controller) return;
    // Extension popups and side panels: out of the app window's Browser and strip, as CEF's standalone browsers.
    const BOOL standalone = view->_standalone;
    NSString *url = view->_pendingURL ?: view->_initialURL;
    view->_pendingURL = nil;
    view->_creatingURL = url;
    view->_creatingAt = CACurrentMediaTime();
    // Chrome's own extension view (an engine that has it): bound to this window's Browser, so the page's current
    // window and active tab are this window's and its tab, as for Chrome's popup. Else a tab in a hidden window.
    if (view->_extensionHost.length && url.length &&
        [controller.coreWindow respondsToSelector:@selector(openExtensionView:profile:kind:)]) {
      if (NNCoreTab *tab = [controller.coreWindow openExtensionView:url profile:profile kind:view->_extensionHost])
        return [view attach:tab];
    }
    if (standalone) controller = [NNCoreWindowController standaloneWindowForProfile:profile] ?: controller;
    if (!standalone && [kind isEqualToString:@"clone"] && [view cloneTab:key profile:profile]) return;
    if (!standalone && [kind isEqualToString:@"restore"] && url.length && !nncore_host::IsIncognito(view->_profile) &&
        [controller.coreWindow respondsToSelector:@selector(restoreTab:profile:foreground:)]) {
      // Its back/forward list is the one Chrome's TabRestoreService kept when it closed (closeBrowser tagged it
      // with the tab's id; on disk, so it survives a relaunch). Without one, the page loads. The view stays
      // "creating" meanwhile, so a load asked for in between waits for the tab (attach loads it).
      view->_creating = YES;
      [NNCoreServices call:@"nn_tab_restore_take" profile:view->_profile args:@{@"key" : key}
                completion:^(NSDictionary *result) {
                  NNCoreWebView *later = weakSelf;
                  if (!later || later->_createGeneration != generation) return;
                  later->_creating = NO;
                  NNCoreWindowController *now = later.controller;
                  if (later->_tab || !now) return;
                  NSString *state = [result[@"state"] isKindOfClass:NSString.class] ? result[@"state"] : nil;
                  NNCoreTab *tab = nil;
                  now.hostChanges++;
                  if (state.length) tab = [now.coreWindow restoreTab:state profile:profile foreground:NO];
                  if (!tab) tab = [now.coreWindow openTab:url profile:profile foreground:NO];
                  now.hostChanges--;
                  if (tab) [later attach:tab];
                }];
      return;
    }
    if (url.length && [view skipsNavigationDownload:url userInitiated:view->_pendingUserInitiated]) url = nil;
    controller.hostChanges++;
    NNCoreTab *tab = [controller.coreWindow openTab:url.length ? url : @"about:blank" profile:profile foreground:NO];
    controller.hostChanges--;
    if (tab) [view attach:tab];
    if (tab && url.length) [view focusAfterLoad];
  });
}

// Duplicate: Chrome's copy of the source tab (its back/forward list and current page), for this view.
- (BOOL)cloneTab:(NSString *)sourceKey profile:(NNCoreProfile *)profile {
  NNCoreWindowController *controller = self.controller;
  if (![controller.coreWindow respondsToSelector:@selector(duplicateTab:profile:foreground:)]) return NO;
  NNCoreTab *source = nil;
  for (NNCoreWebView *other in LiveViews())
    if (other != self && [other.transferKey isEqualToString:sourceKey] && other->_tab && !other->_tab.closed) source = other->_tab;
  if (!source || source.profile != profile) return NO;
  NNCoreWindowController *holder = [NNCoreWindowController holding:source];
  _pendingURL = nil;
  controller.hostChanges++;
  holder.hostChanges++;
  NNCoreTab *tab = [controller.coreWindow duplicateTab:source profile:profile foreground:NO];
  holder.hostChanges--;
  controller.hostChanges--;
  if (!tab) return NO;
  [self attach:tab];
  return YES;
}

+ (void)keepTransfersOfWindow:(NSWindow *)window {
  NNCoreWindowController *closing = [NNCoreWindowController forNSWindow:window];
  if (!closing || ![closing.coreWindow respondsToSelector:@selector(adoptTab:)]) return;
  // Moving a window's last tab to another window closes the window at once, while the tab's new view is still to
  // mount: its tab closed with the Browser, and the new view loaded the page afresh (blank for a moment, its history
  // and state gone).
  for (NNCoreWebView *view in LiveViews().allObjects)
    if (view->_tab && !view->_tab.closed && TransferRequested(view->_transferKey) && [NNCoreWindowController holding:view->_tab] == closing)
      [view closeBrowser];
  for (NNCoreTab *tab in Parked().allValues) {
    if (tab.closed || [NNCoreWindowController holding:tab] != closing || !tab.profile) continue;
    NNCoreWindowController *keeper = [NNCoreWindowController strayWindowForProfile:tab.profile];
    keeper.hostChanges++;
    closing.hostChanges++;
    [keeper.coreWindow adoptTab:tab];
    closing.hostChanges--;
    keeper.hostChanges--;
  }
}

// Only a page of this view's own profile: a tab moved to another profile opens afresh there, and a page parked as
// its view went (ContentCard) mustn't show in a profile the tab moved to meanwhile.
- (BOOL)canTake:(NNCoreTab *)tab {
  NNCoreProfile *profile = tab.profile;
  if (!profile || tab.closed || profile.offTheRecord != nncore_host::IsIncognito(_profile)) return NO;
  return profile.offTheRecord || [nncore_host::ProfileName(profile) isEqualToString:_profile ?: @""];
}

- (BOOL)takeTransferredTab {
  NNCoreTab *tab = Parked()[_transferKey];
  if (tab && ![self canTake:tab]) return NO;
  if (tab) [Parked() removeObjectForKey:_transferKey];
  // The new view can mount before the old one unmounts: take the tab from it.
  if (!tab) {
    for (NNCoreWebView *other in LiveViews()) {
      if (other == self || ![other.transferKey isEqualToString:_transferKey] || other.window == self.window || !other->_tab) continue;
      if (![self canTake:other->_tab]) return NO;
      tab = other->_tab;
      [other detach];
      break;
    }
  }
  if (!tab || tab.closed) return NO;
  [TransferRequests() removeObjectForKey:_transferKey];
  _adoptId = nil;
  _transferredURL = tab.url;
  if (SamePage(_pendingURL, _transferredURL)) _pendingURL = nil;
  [self attach:tab];
  return YES;
}

// The tab's Browser is its window's: a tab this view takes from elsewhere (a popup Chrome opened in another
// window's Browser, a tab moved between windows) moves into this window's Browser for its profile.
- (void)adoptIntoWindow {
  if (_standalone) return;
  NNCoreWindowController *controller = self.controller;
  if (!controller || ![controller.coreWindow respondsToSelector:@selector(adoptTab:)]) return;
  if ([[controller.coreWindow tabsForProfile:_tab.profile] containsObject:_tab]) return;
  NNCoreWindowController *source = [NNCoreWindowController holding:_tab];
  _moving = YES;
  controller.hostChanges++;
  source.hostChanges++;
  [controller.coreWindow adoptTab:_tab];
  source.hostChanges--;
  controller.hostChanges--;
  _moving = NO;
  if (_tabIndex >= 0) [self placeTab];
}

- (void)attach:(NNCoreTab *)tab {
  if (TraceVisibility()) NSLog(@"[nncore-vis] %@ attach tab=%d visible=%d", _transferKey, (int)tab.tabId, _visible);
  [LiveViews() addObject:self];
  _tab = tab;
  tab.delegate = self;
  [NNCoreTabs setView:self forTab:tab];
  [self adoptIntoWindow];
  NSView *page = tab.view;
  if (page.superview != self) {
    [page removeFromSuperview];
    [self addSubview:page];
  }
  if (NSView *devtools = tab.devToolsView) [self devToolsChanged:devtools];
  [self layoutPage];
  [self applyPainting];
  if (_muted && [tab respondsToSelector:@selector(setMuted:)]) tab.muted = YES;
  if (_pageBackgroundColor && [tab respondsToSelector:@selector(setPageBackgroundColor:)]) tab.pageBackgroundColor = _pageBackgroundColor;
  if (_pendingURL) {
    [self loadNow:_pendingURL userInitiated:_pendingUserInitiated];
    _pendingURL = nil;
  }
  [self emit:@"ready" payload:@{@"browserId" : @(nncore_host::BrowserId(tab)), @"tabId" : @(tab.tabId)}];
  [self emitNavigation];
  [self tabDidChangeFavicon:tab];
  if (_tabIndex >= 0) [self placeTab];
  if (_visible && !NNCoreTabStrip.commandsSeen) [self activate];
  // The strip names the tab by this view's key from now on (re-sent as Chrome's report, cmd null).
  if (NNCoreWindowController *controller = self.controller)
    [NNCoreTabStrip changedInWindow:controller profile:tab.profile cause:NSNull.null];
}

- (void)detach {
  if (!_tab) return;
  if (TraceVisibility()) NSLog(@"[nncore-vis] %@ detach tab=%d", _transferKey, (int)_tab.tabId);
  if (_tab.delegate == self) _tab.delegate = nil;
  [NNCoreTabs setView:nil forTab:_tab];
  if (_tab.view.superview == self) [_tab.view removeFromSuperview];
  [self dropDevTools];
  [self resetBlocked:NO];
  _tab = nil;
  _leaving = NO;
  _leaveGeneration++;
}

- (void)closeBrowser {
  // A tab still being made for this view is no longer wanted.
  _createGeneration++;
  _creating = NO;
  if (!_tab) return;
  NNCoreTab *tab = _tab;
  if (TransferRequested(_transferKey) && !tab.closed) {
    // Moving to another window: the new view takes it within kTransferWindow, else it closes.
    [self detach];
    [ParkingView() addSubview:tab.view];
    NSString *key = [_transferKey copy];
    Parked()[key] = tab;
    // Each parking has its own deadline: an earlier one's (the tab taken and parked again since) isn't this one's.
    static NSUInteger parkings = 0;
    const NSUInteger parking = ++parkings;
    objc_setAssociatedObject(tab, &kParkingKey, @(parking), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kTransferWindow * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (Parked()[key] != tab || [objc_getAssociatedObject(tab, &kParkingKey) unsignedIntegerValue] != parking) return;
      [Parked() removeObjectForKey:key];
      // At once, as a closed view's tab: a beforeunload prompt nobody sees would keep it (and the hidden window
      // keepTransfersOfWindow: put it in) alive.
      if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
      else [tab close];
    });
    return;
  }
  _closing = YES;
  // The entry Chrome's TabRestoreService records for the tab carries the app's id for it, so ⇧⌘T finds this one.
  if (_transferKey.length && !nncore_host::IsIncognito(_profile) && NNCoreHost.isStarted)
    [NNCoreServices call:@"nn_tab_restore_tag" profile:_profile args:@{@"tab" : @(tab.tabId), @"key" : _transferKey}
              completion:^(NSDictionary *) {}];
  [[NNCoreWindowController holding:tab] noteClosing:tab];
  [self detach];
  // As CEF's CloseBrowser(true): the app already dropped the tab, so no beforeunload keeps it alive unseen.
  if ([tab respondsToSelector:@selector(closeNow)]) [tab closeNow];
  else [tab close];
}

- (void)activate {
  NNCoreWindowController *controller = self.controller;
  if (!_tab || !controller) return;
  controller.hostChanges++;
  [controller.coreWindow activateTab:_tab];
  [NNCoreTabStrip activated:_tab inWindow:controller];
  controller.hostChanges--;
}

- (void)placeTab {
  NNCoreWindowController *controller = self.controller;
  if (!_tab || !controller || ![controller.coreWindow respondsToSelector:@selector(placeTab:index:pinned:)]) return;
  controller.hostChanges++;
  [controller.coreWindow placeTab:_tab index:(int)_tabIndex pinned:_pinned];
  controller.hostChanges--;
}

// MARK: From the window

- (void)openedTab:(NNCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition {
  [self announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:0];
}

// window.open makes its contents before it navigates them: wait (briefly) for the URL it is going to.
- (void)announceOpenedTab:(NNCoreTab *)tab adoptId:(NSString *)adoptId disposition:(NSString *)disposition tries:(int)tries {
  if (tab.closed) return;
  NSString *url = tab.url;
  if ((!url.length || [url isEqualToString:@"about:blank"]) && tries < 20) {
    __weak NNCoreWebView *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [weakSelf announceOpenedTab:tab adoptId:adoptId disposition:disposition tries:tries + 1];
    });
    return;
  }
  [self emit:@"openWindow"
      payload:@{
        @"url" : url ?: @"",
        @"disposition" : disposition,
        @"adoptId" : adoptId,
        @"userGesture" : @YES,
        @"postBody" : @NO,
      }];
}

- (void)tabRemovedFromWindow:(NNCoreWindow *)window {
  if (_moving || _closing || !_tab) return;
  // A stage 1 engine says when Chrome closes a tab (tabWillClose:); a removal is then a move (an extension's
  // tabs.move to another window), which keeps the tab.
  if (nncore_host::EngineHasTabModel()) return;
  // Chrome closed it (window.close(), an extension): the app closes the tab (onWindowClose).
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

- (void)tabActivatedByChrome:(BOOL)chromes {
  if (TraceVisibility()) NSLog(@"[nncore-vis] %@ chrome-activated tab=%d byChrome=%d", _transferKey, _tab ? (int)_tab.tabId : -1, chromes);
  if (_standalone) return;
  [self emit:@"tabStrip"
      payload:@{
        @"index" : @(MAX(_tabIndex, 0)),
        @"active" : @YES,
        @"pinned" : @(_pinned),
        @"activated" : @YES,
        @"byApp" : @(!chromes),
      }];
}

- (void)devToolsChanged:(NSView *)devToolsView {
  if (_devtoolsView && _devtoolsView != devToolsView && _devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = devToolsView;
  if (devToolsView && devToolsView.superview != self) {
    [devToolsView removeFromSuperview];
    NSView *page = _tab.view;
    if (page.superview == self) [self addSubview:devToolsView positioned:NSWindowBelow relativeTo:page];
    else [self addSubview:devToolsView];
  }
  [self layoutPage];
}

- (void)dropDevTools {
  if (_devtoolsView.superview == self) [_devtoolsView removeFromSuperview];
  _devtoolsView = nil;
}

// MARK: Layout and painting

- (void)setFrameSize:(NSSize)newSize {
  [super setFrameSize:newSize];
  [self layoutPage];
}

- (void)layoutPage {
  NSView *page = _tab.view;
  if (!page || page.superview != self) return;
  if (_devtoolsView) {
    NSRect devtools = NSZeroRect, pageFrame = self.bounds;
    [_tab devToolsLayoutForSize:self.bounds.size devTools:&devtools page:&pageFrame];
    _devtoolsView.frame = devtools;
    page.frame = pageFrame;
  } else {
    page.frame = self.bounds;
  }
}

- (BOOL)paints {
  return _visible || _warm || _leaving;
}

- (void)applyPainting {
  self.alphaValue = _visible || !(_warm || _leaving) ? 1 : 0;
  const BOOL shown = self.paints;
  for (NSView *sub in self.subviews) sub.hidden = !shown;
  if (TraceVisibility())
    NSLog(@"[nncore-vis] %@ paint visible=%d warm=%d tab=%d page=%@ inWindow=%ld hiddenAncestor=%d", _transferKey,
          _visible, _warm, _tab ? (int)_tab.tabId : -1, _tab.view.superview == self ? @"here" : @"elsewhere",
          (long)self.window.windowNumber, _tab.view.isHiddenOrHasHiddenAncestor);
}

- (void)setWarm:(BOOL)warm {
  if (_warm == warm) return;
  _warm = warm;
  [self schedulePainting];
}

- (void)setVisible:(BOOL)visible {
  if (_visible == visible) return;
  _visible = visible;
  [self schedulePainting];
  [self updateAutoPictureInPicture];
  // With tab-strip commands, only they (and Chrome) change the active tab.
  if (visible && !NNCoreTabStrip.commandsSeen) [self activate];
}

// A tab switch arrives as one batch of view updates, and showing a page makes Chrome commit the Core Animation
// transaction there and then: the screen got the half-applied batch (the new page's first tiles over the old page,
// the old tab's toolbar) for a frame. The pages change once the batch is done, before the turn's transaction commits
// (Core Animation's commit observer runs at order 2000000): the ones leaving first, then the ones coming in. The
// visible and warm props both go through here, so a page going from warm to visible (a profile swipe) never hides.
- (void)schedulePainting {
  [PendingPainting() addObject:self];
  if (gPaintingScheduled) return;
  gPaintingScheduled = true;
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(nil, kCFRunLoopBeforeWaiting, false, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
    [NNCoreWebView drainPainting];
  });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  CFRelease(observer);
}

+ (void)drainPainting {
  gPaintingScheduled = false;
  NSArray<NNCoreWebView *> *views = PendingPainting().allObjects;
  [PendingPainting() removeAllObjects];
  for (NNCoreWebView *view in views) {
    if (view->_visible) continue;
    [view leaveScreen];
    [view applyPainting];
  }
  for (NNCoreWebView *view in views)
    if (view->_visible) [view applyPainting];
}

// Hiding Chrome's view tells the page it's hidden, and Chrome drops its layers at once, on its own schedule: the page
// went blank (or kept a few tiles) for a frame before the app's switch to the next tab reached the screen. A page
// leaving the screen goes transparent with the rest of the switch and stays visible to Chrome a few frames more.
- (void)leaveScreen {
  const NSUInteger generation = ++_leaveGeneration;
  NSView *page = _tab.view;
  // Only a page on screen now (not one already hidden, nor a warm one, which keeps painting anyway).
  _leaving = !_visible && !_warm && page.superview == self && !page.hidden && self.alphaValue > 0;
  if (!_leaving) return;
  __weak NNCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kLeaveScreenDelay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    if (!view || view->_leaveGeneration != generation) return;
    view->_leaving = NO;
    [view schedulePainting];
  });
}

- (void)setFrozen:(BOOL)frozen {
  _frozen = frozen;
  if ([_tab respondsToSelector:@selector(setFrozen:)]) _tab.frozen = frozen;
}

- (void)setPageBackgroundColor:(NSColor *)color {
  _pageBackgroundColor = color;
  if ([_tab respondsToSelector:@selector(setPageBackgroundColor:)]) _tab.pageBackgroundColor = color;
}

// MARK: Events

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
  // Events reach JS in the order they happened: a held navigation report goes first.
  if (_navigationQueued && ![name isEqualToString:@"navigation"]) [self emitNavigation];
  if (_tab) NoteEvent(nncore_host::BrowserId(_tab), name, payload);
  [self.delegate webView:self event:name payload:payload];
}

+ (NSArray<NSDictionary<NSString *, id> *> *)devEventsForBrowser:(int)browserId {
  return RecentEvents()[@(browserId)] ?: @[];
}

+ (void)setDisplayMediaPicker:(BOOL)enabled {
  gDisplayMediaPicker = enabled;
}

+ (void)setSearchEngineName:(NSString *)name {
  gSearchEngineName = name.length ? [name copy] : @"Google";
}

+ (NSInteger)devWindowNumberForBrowser:(int)browserId {
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  NNCoreWebView *view = tab ? [NNCoreTabs viewForTab:tab] : nil;
  return view.window.windowNumber;
}

// Tests: a click into the page as the user's, though a hidden instance's window is never key. For the moment Chrome's
// page view takes the window as key (AppKit's isKeyWindow and the view's didBecomeKey), and becomes first responder
// as a mouse down makes it; then the window resigns again. Chrome's own focus path runs (GotFocus →
// OnWebContentsFocused → tabDidGainFocus:), and nothing is activated.
+ (BOOL)devFocusPageOfBrowser:(int)browserId {
#if DEBUG
  NNCoreTab *tab = nncore_host::TabWithBrowserId(browserId);
  NSWindow *window = tab.view.window;
  NSView *page = nil;
  for (NSMutableArray<NSView *> *queue = [NSMutableArray arrayWithObject:tab.view ?: [NSView new]]; queue.count && !page;) {
    NSView *v = queue.firstObject;
    [queue removeObjectAtIndex:0];
    if ([NSStringFromClass(v.class) isEqual:@"RenderWidgetHostViewCocoa"]) page = v;
    [queue addObjectsFromArray:v.subviews];
  }
  if (!window || !page) return NO;
  Method isKey = class_getInstanceMethod(NSWindow.class, @selector(isKeyWindow));
  IMP original = method_getImplementation(isKey);
  method_setImplementation(isKey, imp_implementationWithBlock(^BOOL(NSWindow *w) {
    return w == window || ((BOOL (*)(id, SEL))original)(w, @selector(isKeyWindow));
  }));
  [window makeFirstResponder:nil];
  ((void (*)(id, SEL, id))objc_msgSend)(page, NSSelectorFromString(@"windowDidBecomeKey:"),
                                        [NSNotification notificationWithName:NSWindowDidBecomeKeyNotification object:window]);
  const BOOL took = [window makeFirstResponder:page];
  method_setImplementation(isKey, original);
  ((void (*)(id, SEL, id))objc_msgSend)(page, NSSelectorFromString(@"windowDidResignKey:"),
                                        [NSNotification notificationWithName:NSWindowDidResignKeyNotification object:window]);
  return took;
#else
  return NO;
#endif
}

- (void)emitNavigation {
  _navigationQueued = NO;
  if (!_tab) return;
  // The page script's colour (its <meta name="theme-color">, else the colour at the top of the page), as packages/cef
  // reports it; Chrome's meta theme-color until the page script has said.
  NSString *theme = _pageTheme ?: ([_tab respondsToSelector:@selector(themeColor)] ? _tab.themeColor : nil);
  NSString *themeSource = _pageTheme ? _pageThemeSource : (theme ? @"meta" : nil);
  NSString *url = _tab.url ?: @"";
  // A renderer debug URL (chrome://crash, kill, hang…) never commits: Chrome runs it in the page's renderer and its
  // pending entry stays visible. As on CEF (the main frame's URL), the tab keeps the page it had, so a reload or the
  // restored session doesn't crash it again.
  if (IsRendererDebugURL(url)) url = _sentNavigation[@"url"] ?: @"";
  NSDictionary *navigation = @{
        @"url" : url,
        @"title" : ReportedTitle(_tab.title, url, _tab.loading),
        @"canGoBack" : @(_tab.canGoBack),
        @"canGoForward" : @(_tab.canGoForward),
        @"isLoading" : @(_tab.loading),
        @"themeColor" : theme ?: NSNull.null,
        @"themeColorSource" : themeSource ?: NSNull.null,
  };
  // The first load after a crash: CEF's dead main frame has no URL, so its first report there says none and the app
  // (ContentCard) takes the reload for a new page and drops the sad tab. The same here, before the real report.
  if (_crashed && _tab.loading) {
    _crashed = NO;
    NSMutableDictionary *gone = [navigation mutableCopy];
    gone[@"url"] = @"";
    _sentNavigation = gone;
    [self emit:@"navigation" payload:gone];
  }
  // As packages/cef (NNClient): a report that changes nothing isn't sent.
  if ([navigation isEqualToDictionary:_sentNavigation]) return;
  _sentNavigation = navigation;
  [self emit:@"navigation" payload:navigation];
}

// Title, URL, loading and history change together during a navigation: one report per run-loop turn.
- (void)queueNavigation {
  if (_navigationQueued) return;
  _navigationQueued = YES;
  __weak NNCoreWebView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    if (view && view->_navigationQueued) [view emitNavigation];
  });
}

- (void)tabDidChangeTitle:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeURL:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeLoading:(NNCoreTab *)tab {
  // A page starting to load starts its blocked count again, as CEF's at each main-frame navigation request.
  if (tab.loading) [self resetBlocked:YES];
  [self queueNavigation];
}

- (void)resetBlocked:(BOOL)report {
  _blockedGeneration++;
  _blockedEmitQueued = NO;
  const BOOL had = _blockedCount || _lastBlocked;
  _blockedCount = 0;
  _lastBlocked = nil;
  if (report && had) [self emit:@"contentBlocked" payload:@{@"count" : @0, @"url" : @""}];
}

- (void)tabDidChangeNavigationState:(NNCoreTab *)tab {
  [self queueNavigation];
}

- (void)tabDidChangeThemeColor:(NNCoreTab *)tab {
  [self queueNavigation];
}

// Load progress at most 10 times a second; its start and end at once (as packages/cef's NNClient).
- (void)tabDidChangeProgress:(NNCoreTab *)tab {
  const double progress = tab.progress;
  const CFTimeInterval wait = _sentProgressAt + 0.1 - CACurrentMediaTime();
  if (progress <= 0.1 || progress >= 1 || wait <= 0) return [self sendProgress];
  if (_progressQueued) return;
  _progressQueued = YES;
  __weak NNCoreWebView *weakSelf = self;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    if (view && view->_progressQueued) [view sendProgress];
  });
}

- (void)sendProgress {
  _progressQueued = NO;
  if (!_tab || _tab.progress == _sentProgress) return;
  _sentProgress = _tab.progress;
  _sentProgressAt = CACurrentMediaTime();
  [self emit:@"progress" payload:@{@"progress" : @(_sentProgress)}];
}

// A browser page's link to an app page (netnyahoo:) opens in its tab as if typed: the app maps it (core/appUrls).
- (void)tab:(NNCoreTab *)tab didRequestAppURL:(NSString *)url userGesture:(BOOL)userGesture {
  [self emit:@"openWindow" payload:@{@"url" : url ?: @"", @"disposition" : @"current", @"userGesture" : @(userGesture)}];
}

- (void)tabDidChangeFavicon:(NNCoreTab *)tab {
  NSImage *image = tab.favicon;
  if (!image) return;
  NSString *url = [tab respondsToSelector:@selector(faviconURL)] ? tab.faviconURL : nil;
  if (url.length) [NNCoreFavicons noteImage:image forURL:url profile:_profile];
  else url = PNGDataURL(image);
  if (!url.length || [url isEqualToString:_lastFavicon]) return;
  _lastFavicon = url;
  [self emit:@"favicon" payload:@{@"url" : url, @"urls" : @[ url ]}];
}

- (void)tab:(NNCoreTab *)tab didFindMatches:(int)count active:(int)active final:(BOOL)final {
  [self emit:@"find" payload:@{@"count" : @(count), @"active" : @(active), @"final" : @(final)}];
}

// The page script's messages from every frame (packages/cef/helper/page_script.js; NNClient::OnPageMessage on CEF).
// The page runs it in its own world, so every field is untrusted.
- (void)tab:(NNCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json frame:(NSString *)frameId main:(BOOL)main {
  id data = JSONValue(json);
  NSDictionary *dict = [data isKindOfClass:NSDictionary.class] ? data : nil;
  frameId = frameId ?: @"";
  if ([kind isEqualToString:@"hello"]) {
    // A new main document: the old page's media and now-playing went with it (CEF's OnLoadStart).
    if (main) [self resetPageMedia];
    // A real document committed (not a new tab's initial about:blank): the app's request didn't become a download.
    if (main && ![(Text(dict, @"url", 8192) ?: @"about:") hasPrefix:@"about:"]) _requestedURL = nil;
    // The frame's settings, as CEF's NNClient answers hello: autoplay blocked for the top page's site.
    NSString *frameURL = Text(dict, @"url", 8192) ?: tab.url;
    NSString *origin = OriginOf(main ? frameURL : tab.url);
    __weak NNCoreWebView *weakSelf = self;
    void (^answer)(BOOL) = ^(BOOL blockAutoplay) {
      NSMutableDictionary *config = [NSMutableDictionary dictionary];
      if (blockAutoplay) config[@"blockAutoplay"] = @YES;
      // The app's screen-share picker, when the engine can grant the picked source to getUserMedia (CEF's
      // site::AllowDesktopCapture).
      if (gDisplayMediaPicker && [NNCoreEngine respondsToSelector:@selector(allowDesktopCapture:tab:frame:origin:)])
        config[@"displayMediaPicker"] = @YES;
      [weakSelf callFrame:frameId kind:@"config" json:JSONString(config)];
    };
    if (origin && [origin hasPrefix:@"http"])
      [NNCoreServices siteSettings:_profile ?: @"" origin:origin completion:^(NSDictionary *settings) {
        NSDictionary *autoplay = [settings[@"autoplay"] isKindOfClass:NSDictionary.class] ? settings[@"autoplay"] : nil;
        answer([autoplay[@"value"] isEqual:@"block"]);
      }];
    else
      answer(NO);
  } else if ([kind isEqualToString:@"selection"] && main) {
    [self emit:@"pageMessage" payload:@{@"kind" : @"selection", @"data" : SelectionState(dict) ?: NSNull.null}];
  } else if ([kind isEqualToString:@"media"] && dict) {
    NSString *mediaFrame = Text(dict, @"frame", 64);
    if (!mediaFrame) return;
    if (!_mediaFrames) _mediaFrames = [NSMutableDictionary dictionary];
    NSString *key = [NSString stringWithFormat:@"%@:%@", frameId, mediaFrame];
    if (_mediaFrames.count >= 256 && !_mediaFrames[key]) return;
    _mediaFrames[key] = @(Flag(dict, @"playing"));
    [self emitMedia];
  } else if ([kind isEqualToString:@"nowPlaying"]) {
    if (!_nowPlaying) _nowPlaying = [NSMutableDictionary dictionary];
    if (dict) _nowPlaying[frameId] = NowPlayingState(dict);
    else [_nowPlaying removeObjectForKey:frameId];
    _nowPlayingFrame = dict ? frameId : _nowPlaying.allKeys.firstObject;
    for (NSString *f in _nowPlaying)
      if ([_nowPlaying[f][@"playbackState"] isEqual:@"playing"]) _nowPlayingFrame = f;
    NSMutableDictionary *state = [_nowPlaying[_nowPlayingFrame ?: @""] mutableCopy];
    [state removeObjectForKey:@"frame"];
    [self emit:@"nowPlaying" payload:@{@"state" : state ?: NSNull.null}];
  } else if ([kind isEqualToString:@"theme"]) {
    if (!main || !dict) return;
    NSString *color = [dict[@"color"] isKindOfClass:NSString.class] ? Text(dict, @"color", 64) : nil;
    NSString *source = [dict[@"source"] isKindOfClass:NSString.class] ? Text(dict, @"source", 32) : nil;
    _pageTheme = color;
    _pageThemeSource = source;
    [self queueNavigation];
  } else if ([kind isEqualToString:@"pinch"] && main && dict) {
    double scale;
    if (!Finite(dict, @"scale", &scale) || scale <= 0) return;
    _pinchScale = MIN(scale, 100);
    [self emitZoom];
  } else if ([kind isEqualToString:@"pip"] && dict) {
    NSNumber *active = [dict[@"active"] isKindOfClass:NSNumber.class] ? dict[@"active"] : nil;
    NSString *pipKind = [dict[@"kind"] isEqual:@"document"] ? @"document" : @"video";
    if (!active) return;
    [self emit:@"pictureInPicture" payload:@{@"kind" : pipKind, @"active" : active}];
    // Chrome's video window, styled and handled as on CEF (NNCorePictureInPicture).
    if ([pipKind isEqual:@"video"]) nncore_pip::VideoChanged(self, [NSURL URLWithString:tab.url ?: @""].host ?: @"", frameId, active.boolValue);
  } else if ([kind isEqualToString:@"notification"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    NSString *origin = OriginOf(tab.url);
    if (!nid.length || !Text(dict, @"title", 1024) || !origin) return;
    if (!_notificationFrames || _notificationFrames.count > 500) _notificationFrames = [NSMutableDictionary dictionary];
    _notificationFrames[nid] = frameId;
    [self emit:@"notification"
        payload:@{
          @"id" : nid,
          @"title" : Text(dict, @"title", 1024),
          @"body" : Text(dict, @"body", 4096) ?: @"",
          @"icon" : Text(dict, @"icon", 1 << 20) ?: NSNull.null,
          @"tag" : Text(dict, @"tag", 1024) ?: @"",
          @"silent" : @(Flag(dict, @"silent")),
          @"requireInteraction" : @(Flag(dict, @"requireInteraction")),
          @"origin" : origin,
          @"browserId" : @(nncore_host::BrowserId(tab)),
          @"isMainFrame" : @(main),
        }];
  } else if ([kind isEqualToString:@"notificationClose"] && dict) {
    NSString *nid = Text(dict, @"id", 128);
    if (!nid.length) return;
    [_notificationFrames removeObjectForKey:nid];
    [self emit:@"notificationClose" payload:@{@"id" : nid}];
  } else if ([kind isEqualToString:@"displayMedia"] && dict) {
    double pageId;
    if (!Finite(dict, @"id", &pageId) || pageId < 1 || pageId > INT_MAX || pageId != floor(pageId)) return;
    if (!_displayRequests) _displayRequests = [NSMutableDictionary dictionary];
    if (_displayRequests.count >= 16) return;
    NSString *requestId = NSUUID.UUID.UUIDString;
    _displayRequests[requestId] = @{@"frame" : frameId, @"id" : @((int)pageId), @"audio" : @(Flag(dict, @"audio"))};
    [self emit:@"displayMediaRequest"
        payload:@{@"id" : requestId, @"origin" : OriginOf(tab.url) ?: @"", @"audio" : @(Flag(dict, @"audio")), @"sources" : NNCoreHost.displayMediaSources}];
  }
}

// Engines without per-frame messages: main-frame posts only.
- (void)tab:(NNCoreTab *)tab didReceivePageMessage:(NSString *)kind json:(NSString *)json {
  [self tab:tab didReceivePageMessage:kind json:json frame:@"" main:YES];
}

- (void)callFrame:(NSString *)frameId kind:(NSString *)kind json:(NSString *)json {
  if (frameId.length && [_tab respondsToSelector:@selector(callFrame:kind:json:)]) [_tab callFrame:frameId kind:kind json:json];
  else if ([_tab respondsToSelector:@selector(callPage:json:)]) [_tab callPage:kind json:json];
}

- (void)emitMedia {
  BOOL playing = NO;
  for (NSNumber *p in _mediaFrames.allValues) playing |= p.boolValue;
  // As packages/cef's EmitMedia: playing is the page script's (a muted tab's video still "plays"; Chrome's audibility
  // lags a pause by its hold time), muted is Chrome's own state.
  const BOOL muted = [_tab respondsToSelector:@selector(muted)] ? _tab.muted : _muted;
  [self emit:@"media" payload:@{@"playing" : @(playing), @"muted" : @(muted)}];
}

- (void)emitZoom {
  const double zoom = [_tab respondsToSelector:@selector(zoomFactor)] ? _tab.zoomFactor : 1;
  [self emit:@"zoom"
      payload:@{
        @"zoom" : @(round(zoom * 100) / 100),
        @"host" : [NSURL URLWithString:_tab.url ?: @""].host.lowercaseString ?: @"",
        @"isDefault" : @(fabs(zoom - 1) < 0.001),
        @"pinchScale" : @(_pinchScale ?: 1),
      }];
}

- (void)tabDidChangeZoom:(NNCoreTab *)tab {
  [self emitZoom];
}

- (void)tabDidChangeSecurity:(NNCoreTab *)tab {
  if (NSDictionary *info = tab.securityInfo) [self emit:@"security" payload:info];
}

- (void)tabWillClose:(NNCoreTab *)tab {
  if (_closing || tab != _tab) return;
  [self detach];
  [self emit:@"windowClose" payload:@{}];
}

// The page's media state starts again (a new main document, a crash), as packages/cef's OnLoadStart and
// OnRenderProcessTerminated: nothing plays and nothing is now playing until the page says so.
- (void)resetPageMedia {
  const BOOL hadMedia = _mediaFrames.count > 0, hadNowPlaying = _nowPlaying.count > 0;
  [_mediaFrames removeAllObjects];
  [_nowPlaying removeAllObjects];
  _nowPlayingFrame = nil;
  if (hadMedia) [self emitMedia];
  if (hadNowPlaying) [self emit:@"nowPlaying" payload:@{@"state" : NSNull.null}];
}

- (void)tab:(NNCoreTab *)tab rendererGone:(NSString *)status code:(int)code {
  _crashed = YES;
  [self resetPageMedia];
  [self emit:@"crashed" payload:@{@"status" : @(code), @"reason" : status ?: @"unknown", @"code" : @(code)}];
}

- (void)tab:(NNCoreTab *)tab didFailLoad:(NSString *)url code:(int)code description:(NSString *)text {
  [self emit:@"loadError" payload:@{@"url" : url ?: @"", @"code" : @(code), @"text" : text ?: @""}];
}

- (void)tab:(NNCoreTab *)tab didChangeStatusText:(NSString *)text {
  [self emit:@"status" payload:@{@"text" : text ?: @""}];
}

- (void)tabDidGainFocus:(NNCoreTab *)tab {
  [self emit:@"focus" payload:@{}];
}

- (void)tabDidChangeAudio:(NNCoreTab *)tab {
  [self emitMedia];
}

// MARK: Commands

- (void)loadURL:(NSString *)url {
  [self loadURL:url userInitiated:NO];
}

- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated {
  if (!url.length) return;
  NSString *transferred = _transferredURL;
  _transferredURL = nil;
  NSString *creating = _creatingURL;
  _creatingURL = nil;
  if (_tab && SamePage(url, transferred)) return;
  // Only the page's own first request, which follows the view's creation at once.
  if ((_tab || _creating) && [url isEqualToString:creating] && CACurrentMediaTime() - _creatingAt < 2) return;
  if (_tab) return [self loadNow:url userInitiated:userInitiated];
  _pendingURL = url;
  _pendingUserInitiated = userInitiated;
  if (self.window) [self ensureTab];
}

- (void)loadNow:(NSString *)url userInitiated:(BOOL)userInitiated {
  if ([self skipsNavigationDownload:url userInitiated:userInitiated]) return;
  if ([_tab respondsToSelector:@selector(loadURL:userInitiated:)]) [_tab loadURL:url userInitiated:userInitiated];
  else [_tab loadURL:url];
  [self focusAfterLoad];
}

// The page on screen takes keyboard focus after a load the app asked for, as on CEF (LoadURL and a new browser's
// first navigation call OnSetFocus(FOCUS_SOURCE_NAVIGATION), which NNClient allows only for a visible view): typing
// goes to the page, and Chrome's page focus (autofill on a click, find…) holds in a window that isn't key.
- (void)focusAfterLoad {
  if (_visible && _tab) [self focusPage];
}

// A restored or reopened tab whose first page was a download stays empty instead of downloading it again (CEF's
// OnBeforeBrowse); the user asking for it again downloads it. Notes the request otherwise.
- (BOOL)skipsNavigationDownload:(NSString *)url userInitiated:(BOOL)userInitiated {
  const BOOL first = !_loadedOnce;
  _loadedOnce = YES;
  _pendingUserInitiated = NO;
  if (first && !userInitiated && nncore_host::WasNavigationDownload(url, _profile)) {
    // After the tab it opens instead is attached (a new view's tab is made right after this).
    __weak NNCoreWebView *weakSelf = self;
    NSDictionary *payload = @{@"url" : url ?: @"", @"committedUrl" : @"", @"skipped" : @YES};
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf emit:@"downloadNavigation" payload:payload]; });
    return YES;
  }
  _requestedURL = url;
  return NO;
}

- (void)loadOpenedURL:(NSInteger)openedId url:(NSString *)url {
  // NNCore never keeps navigations for later ("open:<id>" is CEF's): load the URL.
  [self loadURL:url userInitiated:NO];
}

- (void)goBack {
  [_tab goBack];
}

- (void)goForward {
  [_tab goForward];
}

- (void)goToHistoryOffset:(NSInteger)offset {
  if ([_tab respondsToSelector:@selector(goToOffset:)]) [_tab goToOffset:(int)offset];
  else if (offset == -1) [_tab goBack];
  else if (offset == 1) [_tab goForward];
}

- (void)reload {
  [_tab reload];
}

- (void)reloadIgnoringCache {
  if ([_tab respondsToSelector:@selector(reloadIgnoringCache)]) [_tab reloadIgnoringCache];
  else [_tab reload];
}

- (void)stopLoading {
  [_tab stop];
}

- (void)focusPage {
  [_tab focus];
}

- (void)setMuted:(BOOL)muted {
  _muted = muted;
  if ([_tab respondsToSelector:@selector(setMuted:)]) _tab.muted = muted;
}

- (void)setZoomFactor:(double)factor {
  if ([_tab respondsToSelector:@selector(setZoomFactor:)]) _tab.zoomFactor = factor;
}

- (void)zoomStep:(NSInteger)direction {
  if ([_tab respondsToSelector:@selector(zoomStep:)]) [_tab zoomStep:(int)direction];
}

- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext {
  [_tab find:text forward:forward];
}

- (void)stopFinding:(BOOL)clearSelection {
  [_tab stopFinding];
}

- (void)print {
  [self runChromeCommand:35003];  // IDC_PRINT
}

- (void)runChromeCommand:(int)command {
  if ([_tab respondsToSelector:@selector(executeChromeCommand:)]) [_tab executeChromeCommand:command];
}

- (void)showDevTools {
  [_tab showDevTools];
}

- (void)showDevToolsPanel:(NSString *)panel {
  // As packages/cef's: Chrome's own commands, so a second ⌥⌘I closes DevTools and ⌥⌘J/⌥⌘C open their panel.
  const int command = [panel isEqualToString:@"console"]   ? 40005  // IDC_DEV_TOOLS_CONSOLE
                      : [panel isEqualToString:@"inspect"] ? 40023  // IDC_DEV_TOOLS_INSPECT
                      : [panel isEqualToString:@"toggle"]  ? 40237  // IDC_DEV_TOOLS_TOGGLE
                                                           : 0;
  if (command && [_tab respondsToSelector:@selector(executeChromeCommand:)]) [self runChromeCommand:command];
  else [_tab showDevTools];
}

- (void)runPageCommand:(NSString *)name {
  const int command = [name isEqualToString:@"savePage"]        ? 35004   // IDC_SAVE_PAGE
                      : [name isEqualToString:@"systemPrint"]   ? 35007   // IDC_BASIC_PRINT
                      : [name isEqualToString:@"caretBrowsing"] ? 40260   // IDC_CARET_BROWSING_TOGGLE
                                                                : 0;
  if (command) [self runChromeCommand:command];
}

- (void)executeJavaScript:(NSString *)code {
  if ([_tab respondsToSelector:@selector(executeJavaScript:)]) [_tab executeJavaScript:code];
}

- (void)evaluate:(NSString *)code completion:(void (^)(NSString *))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(nil);
  [_tab evaluate:code completion:completion];
}

// The page as painted (packages/cef's capturePicture, for the dragged tab's picture): a JPEG of the viewport and the
// view's frame in its window from the top-left; nil after a second (a hung or unpainted page).
- (void)capturePicture:(double)scale completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSWindow *window = self.window;
  if (!_tab || !window || self.hidden || ![_tab respondsToSelector:@selector(devToolsCall:params:completion:)]) return completion(nil);
  NSRect inWindow = [self convertRect:self.bounds toView:nil];
  CGFloat top = NSHeight(window.contentView.frame);
  NSArray *frame = @[ @(NSMinX(inWindow)), @(top - NSMaxY(inWindow)), @(NSWidth(inWindow)), @(NSHeight(inWindow)) ];
  __block BOOL answered = NO;
  void (^answer)(NSDictionary *) = ^(NSDictionary *result) {
    if (answered) return;
    answered = YES;
    completion(result);
  };
  NSDictionary *params = @{@"format" : @"jpeg", @"quality" : @(scale < 0.5 ? 55 : 75), @"optimizeForSpeed" : @YES};
  void (^done)(NSDictionary *, NSString *) = ^(NSDictionary *shot, NSString *error) {
    NSString *data = shot[@"data"];
    answer([data isKindOfClass:NSString.class] ? @{@"data" : data, @"frame" : frame} : nil);
  };
  // With a deadline the engine forgets the call (and detaches its DevTools client): a hung page keeps Chrome's hang
  // reporting, which ignores pages a debugger is attached to.
  SEL timed = NSSelectorFromString(@"devToolsCall:params:timeout:completion:");
  if ([_tab respondsToSelector:timed])
    ((void (*)(id, SEL, NSString *, NSDictionary *, NSTimeInterval, id))objc_msgSend)(_tab, timed, @"Page.captureScreenshot", params, 1.0, done);
  else
    [_tab devToolsCall:@"Page.captureScreenshot" params:params completion:done];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{ answer(nil); });
}

- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *))completion {
  completion([_tab respondsToSelector:@selector(navigationEntries)] ? _tab.navigationEntries : @[]);
}

- (void)downloadFavicon:(NSString *)url name:(NSString *)name completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [NNCoreFavicons fetch:url profile:_profile name:name completion:completion];
}

- (void)downloadImage:(NSString *)url maxPixels:(NSInteger)maxPixels completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  [NNCoreFavicons fetch:url profile:_profile name:nil completion:completion];
}

- (void)mediaCommand:(NSString *)action seconds:(double)seconds {
  [self callFrame:_nowPlayingFrame ?: @"" kind:@"media" json:JSONString(@{@"action" : action ?: @"", @"seconds" : @(seconds)})];
}

- (void)requestPictureInPicture:(void (^)(BOOL))completion {
  if (![_tab respondsToSelector:@selector(evaluate:completion:)]) return completion(NO);
  [self evaluateWithGesture:@"(async () => {"
                  "  const videos = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && !v.disablePictureInPicture);"
                  "  videos.sort((a, b) => (b.paused ? 0 : 1) - (a.paused ? 0 : 1) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);"
                  "  if (!videos.length) return post('result', 'false');"
                  "  if (document.pictureInPictureElement === videos[0]) return post('result', 'true');"
                  "  try { await videos[0].requestPictureInPicture(); post('result', 'true'); } catch (e) { post('result', 'false'); }"
                  "})()"
      completion:^(NSString *json) { completion([json isEqualToString:@"true"]); }];
}

// Picture in Picture needs the user activation a click would give (CEF's EvaluateWithGesture).
- (void)evaluateWithGesture:(NSString *)code completion:(void (^)(NSString *))completion {
  if ([_tab respondsToSelector:@selector(evaluate:userGesture:completion:)]) return [_tab evaluate:code userGesture:YES completion:completion];
  [_tab evaluate:code completion:completion];
}

// Auto Picture in Picture (Arc's): a playing video goes into PiP when its tab is switched away from, and comes back
// when it shows again.
- (void)updateAutoPictureInPicture {
  if (!_tab) return;
  NSDictionary *np = _nowPlaying[_nowPlayingFrame ?: @""];
  const BOOL playingVideo = [np[@"hasVideo"] boolValue] && [np[@"playbackState"] isEqual:@"playing"];
  // A page that handles Media Session's "enterpictureinpicture" (a call, a player with its own PiP) opens its own
  // document Picture in Picture, as on CEF (WantsDocumentPictureInPicture).
  const BOOL handles = [np[@"actions"] isKindOfClass:NSArray.class] && [np[@"actions"] containsObject:@"enterpictureinpicture"];
  const BOOL wantsDocument = handles && (_capturing || [np[@"playbackState"] isEqual:@"playing"]);
  if (!_visible && _autoPictureInPicture && wantsDocument) {
    _autoPictureInPictureActive = YES;
    // The page's handler needs a user activation: an empty gesture first, then the action.
    __weak NNCoreWebView *weakSelf = self;
    [self evaluateWithGesture:@"post('result', '0')" completion:^(NSString *) { [weakSelf mediaCommand:@"enterpictureinpicture" seconds:0]; }];
  } else if (!_visible && _autoPictureInPicture && playingVideo) {
    _autoPictureInPictureActive = YES;
    [self requestPictureInPicture:^(BOOL) {}];
  } else if (_visible && _autoPictureInPictureActive) {
    _autoPictureInPictureActive = NO;
    [self exitPictureInPicture];
  }
}

// Back to Tab from our PiP menu: the video's own frame leaves Picture in Picture (CEF kept the CefFrame).
- (void)exitPictureInPictureInFrame:(NSString *)frameId {
  if (frameId.length && [_tab respondsToSelector:@selector(executeJavaScript:frame:)])
    [_tab executeJavaScript:@"document.pictureInPictureElement && document.exitPictureInPicture()" frame:frameId];
  else
    [self exitPictureInPicture];
}

- (void)exitPictureInPicture {
  [self executeJavaScript:@"document.pictureInPictureElement && document.exitPictureInPicture();"
                           "window.documentPictureInPicture && documentPictureInPicture.window && documentPictureInPicture.window.close()"];
}

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *))completion {
  if ([_tab respondsToSelector:@selector(securityInfo)] && _tab.securityInfo) return completion(_tab.securityInfo);
  NSString *url = _tab.url ?: @"";
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  NSString *level = [scheme isEqualToString:@"https"] ? @"secure" : [scheme isEqualToString:@"http"] ? @"insecure" : @"local";
  completion(@{@"level" : level, @"url" : url, @"origin" : NSNull.null});
}

- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always {
  if ([_tab respondsToSelector:@selector(openBlockedPopup:always:)]) [_tab openBlockedPopup:popupId always:always];
}

// Requests the content blocker stopped (ERR_BLOCKED_BY_CLIENT), new since the last report: the page's total at most
// every 150 ms, as CEF's NNClient::NoteBlocked.
- (void)tab:(NNCoreTab *)tab didBlockRequests:(int)count lastURL:(NSString *)url {
  if (tab != _tab) return;
  _blockedCount += count;
  _lastBlocked = url;
  if (_blockedEmitQueued) return;
  _blockedEmitQueued = YES;
  __weak NNCoreWebView *weakSelf = self;
  const NSUInteger generation = _blockedGeneration;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    NNCoreWebView *view = weakSelf;
    // Reset (a new page, the tab gone or replaced) since: not this page's count any more.
    if (!view || view->_blockedGeneration != generation || !view->_tab) return;
    view->_blockedEmitQueued = NO;
    [view emit:@"contentBlocked" payload:@{@"count" : @(view->_blockedCount), @"url" : view->_lastBlocked ?: @""}];
  });
}

- (void)tab:(NNCoreTab *)tab didBlockPopup:(NSDictionary<NSString *, NSString *> *)popup {
  [self emit:@"popupBlocked" payload:popup];
}

- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *))completion {
  NSString *origin = OriginOf(_tab.url);
  if (!origin) return completion(@{@"cookies" : @NO, @"storage" : @NO});
  [NNCoreServices clearSiteData:_profile origin:origin completion:completion];
}

- (void)resolvePasswordPrompt:(NSString *)action username:(NSString *)username password:(NSString *)password {
  [_tab resolvePasswordPrompt:action username:username password:password];
}

- (void)setTabStripIndex:(NSInteger)index pinned:(BOOL)pinned {
  _tabIndex = index;
  _pinned = pinned;
  if (_tab) [NNCoreTabStrip setPinned:pinned tab:_tab];
  [self placeTab];
}

- (NSString *)executeExtensionAction:(NSString *)extensionId {
  return [_tab respondsToSelector:@selector(executeExtensionAction:)] ? [_tab executeExtensionAction:extensionId] : nil;
}

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(NSString *)sourceId {
  NSDictionary *request = requestId ? _displayRequests[requestId] : nil;
  if (!request) return;
  [_displayRequests removeObjectForKey:requestId];
  // The picked source, granted to that frame's next desktop getUserMedia (once, within 15 s).
  if (sourceId.length && _tab && [NNCoreEngine respondsToSelector:@selector(allowDesktopCapture:tab:frame:origin:)])
    [NNCoreEngine allowDesktopCapture:sourceId
                                  tab:_tab
                                frame:[request[@"frame"] length] ? request[@"frame"] : nil
                               origin:nil];
  [self callFrame:request[@"frame"] kind:@"displayMedia"
             json:JSONString(@{@"id" : request[@"id"], @"sourceId" : sourceId.length ? sourceId : NSNull.null})];
}

- (NSString *)mediaCaptureSourceId {
  return [_tab respondsToSelector:@selector(mediaCaptureSourceId)] ? _tab.mediaCaptureSourceId : nil;
}

- (void)tab:(NNCoreTab *)tab navigationBecameDownload:(NSString *)url {
  nncore_host::NoteNavigationDownload(url, _profile);
  if (_requestedURL && ![_requestedURL isEqualToString:url]) nncore_host::NoteNavigationDownload(_requestedURL, _profile);
  _requestedURL = nil;
  [self emit:@"downloadNavigation" payload:@{@"url" : url ?: @"", @"committedUrl" : tab.url ?: @"", @"skipped" : @NO}];
}

// The page's menu is Chrome's; the app adds "Search <engine> for …" after Copy, as CEF did, and runs it itself
// (onCommand "search", the app's engine and opening rules, with the keys held).
- (NSArray<NSDictionary<NSString *, NSString *> *> *)tab:(NNCoreTab *)tab
                           contextMenuItemsForSelection:(NSString *)text {
  return @[ @{
    @"id" : @"search",
    @"title" : [NSString stringWithFormat:@"Search %@ for “%@”", gSearchEngineName, SelectionLabel(text)],
    @"replaces" : @"search",
  } ];
}

- (void)tab:(NNCoreTab *)tab
    contextMenuCommand:(NSString *)itemId
                  text:(NSString *)selection
             modifiers:(NSDictionary<NSString *, NSNumber *> *)modifiers {
  if ([itemId isEqualToString:@"search"])
    [self emit:@"command" payload:@{@"command" : @"search", @"text" : selection ?: @"", @"modifiers" : modifiers ?: @{}}];
}

// The autofill suggestions Chrome showed for the page (tests: in the dev event log).
- (void)tab:(NNCoreTab *)tab didShowAutofillSuggestions:(NSArray<NSDictionary<NSString *, NSString *> *> *)items {
  NoteEvent(nncore_host::BrowserId(tab), @"autofillSuggestions", @{@"items" : items ?: @[]});
}

// Background mode (or NETNYAHOO_CONTEXT_MENU_LOG): the menu Chrome would have shown, not shown. In the dev event log
// (devEvents), and as packages/cef has it: a line in activation.log, or with NETNYAHOO_CONTEXT_MENU_LOG the menu
// dumped there and the item its ".pick" file names run (Client::RunContextMenu).
- (void)tab:(NNCoreTab *)tab didShowContextMenu:(NSArray<NSDictionary *> *)items {
  [self tab:tab runContextMenu:@{@"items" : items ?: @[]}];
}

- (NSDictionary<NSString *, NSNumber *> *)tab:(NNCoreTab *)tab runContextMenu:(NSDictionary<NSString *, id> *)menu {
  NSArray *items = Field<NSArray>(menu, @"items") ?: @[];
  NoteEvent(nncore_host::BrowserId(tab), @"contextMenu", @{@"items" : items});
  static const char *log = getenv("NETNYAHOO_CONTEXT_MENU_LOG");
  if (!log) {
    // CEF's background guard logs the NSMenu it didn't pop up: its titled items, top level.
    if (nncore_host::Background()) {
      NSMutableArray<NSString *> *titles = [NSMutableArray array];
      for (NSDictionary *item in items)
        if (MenuItemType(item) != kMenuSeparator && Field<NSString>(item, @"label").length) [titles addObject:MenuTitle(item[@"label"])];
      nncore_host::LogActivation([NSString stringWithFormat:@"context menu (not shown): %@", [titles componentsJoinedByString:@" | "]]);
    }
    return nil;
  }
  NSString *path = @(log), *pickPath = [path stringByAppendingString:@".pick"];
  NSDictionary *dump = @{
    @"url" : Field<NSString>(menu, @"url") ?: tab.url ?: @"",
    @"link" : Field<NSString>(menu, @"link") ?: @"",
    @"items" : DescribeMenu(items),
  };
  [JSONString(dump) writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSString *pick = [NSString stringWithContentsOfFile:pickPath encoding:NSUTF8StringEncoding error:nil];
  [NSFileManager.defaultManager removeItemAtPath:pickPath error:nil];
  pick = [pick stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  // "<label>\t<flags>" picks it as if with those keys held (cef_event_flags_t, the same bits as Chrome's ui::EventFlags).
  NSArray<NSString *> *parts = [pick componentsSeparatedByString:@"\t"];
  NSNumber *command = pick.length ? FindMenuItem(items, parts[0]) : nil;
  if (!command) return nil;
  return @{@"command" : command, @"flags" : @(parts.count > 1 ? parts[1].intValue : 0)};
}

// Chrome's own picture-in-picture windows: a document's is reported here only (a video's state comes from the page
// script, as on CEF).
- (void)tab:(NNCoreTab *)tab didChangePictureInPicture:(NSDictionary<NSString *, id> *)state {
  if (![state[@"kind"] isEqual:@"document"]) return;
  [self emit:@"pictureInPicture" payload:@{@"kind" : @"document", @"active" : @([state[@"active"] boolValue])}];
}

- (void)tab:(NNCoreTab *)tab requestsActivation:(NSString *)reason {
  [self emit:@"activateRequest" payload:@{@"reason" : reason ?: @"page"}];
}

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action {
  NSString *frame = notificationId ? _notificationFrames[notificationId] : nil;
  if (!frame) return;
  if (![action isEqualToString:@"click"]) [_notificationFrames removeObjectForKey:notificationId];
  [self callFrame:frame kind:@"notification" json:JSONString(@{@"id" : notificationId, @"action" : action ?: @""})];
}

- (void)resolveUnresponsive:(BOOL)terminate {
  if ([_tab respondsToSelector:@selector(resolveUnresponsive:)]) [_tab resolveUnresponsive:terminate];
}

- (BOOL)discard:(BOOL)unload {
  return [_tab respondsToSelector:@selector(discard)] && [_tab discard];
}

- (BOOL)discarded {
  return [_tab respondsToSelector:@selector(discarded)] && _tab.discarded;
}

- (void)tabDidChangeDiscarded:(NNCoreTab *)tab {
  // As CEF's onDiscarded: the page's URL, to load again when it shows.
  if (tab.discarded) [self emit:@"discarded" payload:@{@"url" : tab.url ?: @""}];
}

- (void)tabBecameUnresponsive:(NNCoreTab *)tab {
  [self emit:@"unresponsive" payload:@{}];
}

- (void)tabBecameResponsive:(NNCoreTab *)tab {
  [self emit:@"responsive" payload:@{}];
}

- (void)tab:(NNCoreTab *)tab didChangeMediaAccess:(NSDictionary<NSString *, NSNumber *> *)access {
  _capturing = [access[@"camera"] boolValue] || [access[@"microphone"] boolValue] || [access[@"screen"] boolValue];
  [self emit:@"mediaAccess" payload:access ?: @{}];
}

- (void)tab:(NNCoreTab *)tab externalAppRequest:(NSDictionary<NSString *, id> *)request {
  [self emit:@"externalApp" payload:request ?: @{}];
}

// MARK: ⌘-scroll zoom (packages/cef's NNZoom, the same rules)

namespace {

// Set by devScrollZoom: the device a synthetic scroll claims to come from, and the ⌘-scrolls that zoomed.
int gDevTrackpad = -1;
NSUInteger gZoomScrolls = 0;
bool gGestureTrackpad = false;

// Scroll events look the same from a trackpad and a Magic Mouse; the HID service that sent one doesn't. Built-in
// trackpads and Magic Trackpads are AppleMultitouchTrackpadHIDEventDriver. Momentum events have no sender.
BOOL FromTrackpad(NSEvent *event) {
  if (gDevTrackpad >= 0) return gDevTrackpad;
  static auto copyHIDEvent = (CFTypeRef (*)(CGEventRef))dlsym(RTLD_DEFAULT, "CGEventCopyIOHIDEvent");
  static auto senderOf = (uint64_t (*)(CFTypeRef))dlsym(RTLD_DEFAULT, "IOHIDEventGetSenderID");
  CGEventRef cg = event.CGEvent;
  CFTypeRef hid = copyHIDEvent && senderOf && cg ? copyHIDEvent(cg) : nullptr;
  if (!hid) return NO;
  uint64_t sender = senderOf(hid);
  CFRelease(hid);
  if (!sender) return NO;
  static NSMutableDictionary<NSNumber *, NSNumber *> *trackpads = [NSMutableDictionary dictionary];
  if (NSNumber *known = trackpads[@(sender)]) return known.boolValue;
  BOOL trackpad = NO;
  io_service_t service = IOServiceGetMatchingService(kIOMainPortDefault, IORegistryEntryIDMatching(sender));
  if (service) {
    io_name_t name;
    trackpad = IOObjectGetClass(service, name) == KERN_SUCCESS && strstr(name, "Trackpad");
    IOObjectRelease(service);
  }
  trackpads[@(sender)] = @(trackpad);
  return trackpad;
}

// A trackpad pinches to zoom; ⌘ with two fingers is a thumb resting on the key while scrolling (zoom::CommandScrollZooms).
bool CommandScrollZooms(NSEvent *event, bool trackpad) {
  if (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) gGestureTrackpad = trackpad;
  else if (event.phase == NSEventPhaseNone && event.momentumPhase == NSEventPhaseNone) gGestureTrackpad = false;
  else gGestureTrackpad = gGestureTrackpad || trackpad;
  return (event.modifierFlags & NSEventModifierFlagCommand) && !gGestureTrackpad;
}

}  // namespace

+ (void)installScrollZoom {
  static id monitor, touchMonitor;
  if (monitor) return;
  static double accumulated = 0;
  static NSUInteger touching = 0;
  static NSTimeInterval touchedAt = 0;
  touchMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskGesture handler:^NSEvent *(NSEvent *event) {
    touching = [event touchesMatchingPhase:NSTouchPhaseTouching inView:nil].count;
    touchedAt = event.timestamp;
    return event;
  }];
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    // Two fingers down is a trackpad too (a Magic Mouse scrolls with one), when AppKit reports touches.
    BOOL fingers = (event.phase & (NSEventPhaseBegan | NSEventPhaseMayBegin)) && touching >= 2 && event.timestamp - touchedAt < 0.5;
    BOOL trackpad = event.phase != NSEventPhaseNone && (fingers || FromTrackpad(event));
    if (!CommandScrollZooms(event, trackpad)) return event;
    NSWindow *window = event.window;
    NSPoint point = event.locationInWindow;
    if (!window) {
      // No window: the location is on the screen (packages/cef's NNZoom does the same).
      NSPoint screen = event.locationInWindow;
      for (NSWindow *w in NSApp.orderedWindows)
        if (w.isVisible && !w.ignoresMouseEvents && NSPointInRect(screen, w.frame)) {
          window = w;
          break;
        }
      point = [window convertPointFromScreen:screen];
    }
    NSView *content = window.contentView;
    NSView *hit = content ? [content hitTest:[content.superview convertPoint:point fromView:nil]] : nil;
    while (hit && ![hit isKindOfClass:NNCoreWebView.class]) hit = hit.superview;
    NNCoreWebView *view = (NNCoreWebView *)hit;
    if (gDevTrackpad >= 0 && (!view || !view->_tab))
      NSLog(@"[scroll-zoom] dev scroll not over a page: window %ld %@, hit %@", (long)window.windowNumber,
            NSStringFromPoint(point), [content hitTest:[content.superview convertPoint:point fromView:nil]]);
    // Over the sidebar, the toolbar or another window: not a page's to zoom.
    if (!view || !view->_tab) return event;
    if (event.phase == NSEventPhaseBegan) accumulated = 0;
    accumulated += event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 30;
    gZoomScrolls++;
    if (fabs(accumulated) >= 30) {
      [view zoomStep:accumulated > 0 ? 1 : -1];
      accumulated = 0;
    }
    return nil;
  }];
}

// DEV: ⌘-scroll events over the visible page through the app's event dispatch, as packages/cef's.
// Each step is {phase: "wheel" | "mayBegin" | "began" | "changed" | "ended" | "momentum", dy, trackpad}; the result
// says, per step, whether the scroll zoomed the page instead of scrolling it.
+ (NSArray<NSNumber *> *)devScrollZoom:(NSArray<NSDictionary<NSString *, id> *> *)steps browser:(int)browserId {
  NNCoreWebView *view = nil;
  // The page asked for (a run has several windows: the last visible view needn't be the check's).
  for (NNCoreWebView *v in LiveViews())
    if (v.window.isVisible && !v.isHiddenOrHasHiddenAncestor && v->_tab && v->_visible &&
        (!browserId || nncore_host::BrowserId(v->_tab) == browserId))
      view = v;
  if (!view) return @[];
  NSWindow *window = view.window;
  // A point of the page no app overlay covers (a toast, a bar, a prompt left from before): the first of a grid over
  // the page whose hit test lands in it.
  const NSRect b = view.bounds;
  NSView *content = window.contentView;
  NSPoint inWindow = [view convertPoint:NSMakePoint(NSMidX(b), NSMidY(b)) toView:nil];
  for (int i = 1; i < 8; i++)
    for (int j = 1; j < 8; j++) {
      const NSPoint candidate = [view convertPoint:NSMakePoint(NSMinX(b) + NSWidth(b) * j / 8, NSMinY(b) + NSHeight(b) * i / 8) toView:nil];
      NSView *hit = [content hitTest:[content.superview convertPoint:candidate fromView:nil]];
      while (hit && hit != view) hit = hit.superview;
      if (hit) {
        inWindow = candidate;
        i = j = 8;
      }
    }
  NSPoint screen = [window convertPointToScreen:inWindow];
  static auto setWindowLocation = (void (*)(CGEventRef, CGPoint))dlsym(RTLD_DEFAULT, "CGEventSetWindowLocation");
  NSMutableArray *zoomed = [NSMutableArray array];
  for (NSDictionary *step in steps) {
    NSString *phase = step[@"phase"];
    BOOL wheel = [phase isEqualToString:@"wheel"];
    int32_t dy = (int32_t)[step[@"dy"] intValue];
    CGEventRef cg = CGEventCreateScrollWheelEvent2(NULL, wheel ? kCGScrollEventUnitLine : kCGScrollEventUnitPixel, 1, dy, 0, 0);
    CGEventSetFlags(cg, kCGEventFlagMaskCommand);
    CGEventSetIntegerValueField(cg, kCGScrollWheelEventIsContinuous, !wheel);
    if (!wheel) CGEventSetDoubleValueField(cg, kCGScrollWheelEventFixedPtDeltaAxis1, dy);
    if ([phase isEqualToString:@"momentum"]) CGEventSetIntegerValueField(cg, kCGScrollWheelEventMomentumPhase, kCGMomentumScrollPhaseContinue);
    else if (!wheel)
      CGEventSetIntegerValueField(cg, kCGScrollWheelEventScrollPhase,
                                  [phase isEqualToString:@"mayBegin"] ? kCGScrollPhaseMayBegin
                                  : [phase isEqualToString:@"began"]  ? kCGScrollPhaseBegan
                                  : [phase isEqualToString:@"ended"]  ? kCGScrollPhaseEnded
                                                                      : kCGScrollPhaseChanged);
    CGEventSetLocation(cg, CGPointMake(screen.x, NSHeight(NSScreen.screens.firstObject.frame) - screen.y));
    CGEventSetIntegerValueField(cg, (CGEventField)51, window.windowNumber);
    if (setWindowLocation) setWindowLocation(cg, CGPointMake(inWindow.x, NSHeight(window.frame) - inWindow.y));
    NSEvent *event = [NSEvent eventWithCGEvent:cg];
    CFRelease(cg);
    gDevTrackpad = [step[@"trackpad"] boolValue];
    NSUInteger before = gZoomScrolls;
    [NSApp sendEvent:event];
    gDevTrackpad = -1;
    [zoomed addObject:@(gZoomScrolls > before)];
  }
  return zoomed;
}

@end

// MARK: - Tabs

namespace {

NSMapTable<NNCoreTab *, NNCoreWebView *> *Views() {
  static NSMapTable *views = [NSMapTable weakToWeakObjectsMapTable];
  return views;
}

NSMutableDictionary<NSString *, NNCoreTab *> *Offered() {
  static NSMutableDictionary *offered = [NSMutableDictionary dictionary];
  return offered;
}

// A tab Chrome opened that the app never adopts (it chose to open the URL fresh, in a private window, say).
constexpr int64_t kOfferSeconds = 30;

}  // namespace

@implementation NNCoreTabs

+ (void)setView:(NNCoreWebView *)view forTab:(NNCoreTab *)tab {
  if (view) [Views() setObject:view forKey:tab];
  else [Views() removeObjectForKey:tab];
}

+ (NNCoreWebView *)viewForTab:(NNCoreTab *)tab {
  return [Views() objectForKey:tab];
}

+ (NSString *)offerTab:(NNCoreTab *)tab {
  return [self offerTab:tab prefix:@"nncore"];
}

+ (NSString *)offerTab:(NNCoreTab *)tab prefix:(NSString *)prefix {
  NSString *adoptId = [NSString stringWithFormat:@"%@:%d", prefix, nncore_host::BrowserId(tab)];
  Offered()[adoptId] = tab;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, kOfferSeconds * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (Offered()[adoptId] != tab) return;
    [Offered() removeObjectForKey:adoptId];
    if (![NNCoreTabs viewForTab:tab]) [tab close];
  });
  return adoptId;
}

+ (NNCoreTab *)takeOffered:(NSString *)adoptId {
  NNCoreTab *tab = Offered()[adoptId];
  if (tab) [Offered() removeObjectForKey:adoptId];
  return tab;
}

+ (void)forget:(NNCoreTab *)tab {
  [Views() removeObjectForKey:tab];
  for (NSString *key in [Offered() allKeysForObject:tab]) [Offered() removeObjectForKey:key];
}

@end

namespace nncore_host {

bool EngineHasTabModel() {
  static const bool has = [NNCoreWindow instancesRespondToSelector:@selector(adoptTab:)];
  return has;
}

namespace {
const void *kBrowserIdKey = &kBrowserIdKey;
NSMapTable<NSNumber *, NNCoreTab *> *TabsById() {
  static NSMapTable *tabs = [NSMapTable strongToWeakObjectsMapTable];
  return tabs;
}
}  // namespace

int BrowserId(NNCoreTab *tab) {
  static int next = 0;
  NSNumber *id_ = objc_getAssociatedObject(tab, kBrowserIdKey);
  if (!id_) {
    id_ = @(++next);
    objc_setAssociatedObject(tab, kBrowserIdKey, id_, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [TabsById() setObject:tab forKey:id_];
  }
  return id_.intValue;
}

NNCoreTab *TabWithBrowserId(int browserId) {
  return [TabsById() objectForKey:@(browserId)];
}

}  // namespace nncore_host
