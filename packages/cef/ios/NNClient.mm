#import "NNClient.h"

#import "NNChromeUI.h"
#import "NNExternalApps.h"
#import "NNPictureInPicture.h"
#import "NNPopupWindow.h"
#import "NNSiteSettings.h"
#import "NNWindowHost.h"
#import "NNZoom.h"

#include "include/cef_command_ids.h"
#include "include/cef_process_message.h"
#include "include/cef_values.h"
#if defined(CEF_NN_MEDIA_REQUEST_SOURCE)
#include "include/cef_media_capture.h"
#endif

namespace nn {

namespace {

enum MenuId : int {
  kOpenLinkNewTab = MENU_ID_USER_FIRST,
  kOpenLinkNewWindow,
  kOpenLinkIncognito,
  kCopyLink,
  kOpenImageNewTab,
  kSaveImage,
  kCopyImageAddress,
  kSaveLinkAs,
  kSearchSelection,
  kAskSelection,
  kCopyLinkToHighlight,
  kInspect,
};

constexpr bool kChatEnabled = false;

NSString *gSearchEngineName = @"Google";

void ToggleWindowFullScreen(NSWindow *window) {
  if (!activation::Background()) return [window toggleFullScreen:nil];
  const bool leaving = host::FullScreenWindow(window) != nil;
  activation::Allow(leaving ? @"toggleFullScreen: (page left full screen; acted out)" : @"toggleFullScreen: (page full screen; acted out)");
  // NETNYAHOO_FAKE_FULLSCREEN_MS gives the acted-out transition AppKit's duration.
  NSString *ms = NSProcessInfo.processInfo.environment[@"NETNYAHOO_FAKE_FULLSCREEN_MS"] ?: @"0";
  host::DevWindowAction(window.windowNumber, [NSString stringWithFormat:@"fakeFullScreen:%d:%@", !leaving, ms]);
}

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

bool IsSplitClick(cef_window_open_disposition_t d) {
  NSEventModifierFlags held = NSEvent.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  return d == CEF_WOD_NEW_WINDOW && (held & NSEventModifierFlagShift) && (held & NSEventModifierFlagOption) &&
         !(held & NSEventModifierFlagCommand);
}

NSString *DispositionName(cef_window_open_disposition_t d) {
  switch (d) {
    case CEF_WOD_NEW_BACKGROUND_TAB: return @"background";
    case CEF_WOD_NEW_WINDOW: return @"window";
    case CEF_WOD_NEW_POPUP: return @"popup";
    case CEF_WOD_OFF_THE_RECORD: return @"incognito";
    case CEF_WOD_CURRENT_TAB: return @"current";
    default: return @"foreground";
  }
}

class BlockedCounter : public CefResourceRequestHandler {
 public:
  void OnResourceLoadComplete(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> request,
                              CefRefPtr<CefResponse> response, URLRequestStatus status, int64_t) override {
    if (!browser || !response || response->GetError() != ERR_BLOCKED_BY_CLIENT) return;
    NSString *url = ToNS(request->GetURL());
    int browserId = browser->GetIdentifier();
    dispatch_async(dispatch_get_main_queue(), ^{
      for (NNBrowserView *view in LiveViews())
        if (view.browserId == browserId && view.client) view.client->NoteBlocked(url);
    });
  }

 private:
  IMPLEMENT_REFCOUNTING(BlockedCounter);
};

class PictureInPictureClient : public CefClient, public CefLifeSpanHandler {
 public:
  explicit PictureInPictureClient(NNBrowserView *opener) : opener_(opener) {}
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override { BrowserCreated(browser); }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    BrowserClosed(browser);
    [opener_ emit:@"pictureInPicture" payload:@{@"kind" : @"document", @"active" : @NO}];
  }

 private:
  __weak NNBrowserView *opener_;
  IMPLEMENT_REFCOUNTING(PictureInPictureClient);
};

bool IsReservedShortcut(NSEvent *event) {
  NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  bool cmd = mods & NSEventModifierFlagCommand, shift = mods & NSEventModifierFlagShift,
       opt = mods & NSEventModifierFlagOption, ctrl = mods & NSEventModifierFlagControl;
  if (ctrl && event.keyCode == 48) return true;
  if (!cmd || ctrl) return false;
  if (!opt && [@[ @"t", @"n", @"w", @"q" ] containsObject:key]) return true;
  if (!opt && !shift && key.length == 1 && [key characterAtIndex:0] >= '1' && [key characterAtIndex:0] <= '9') return true;
  if (shift && ([key isEqualToString:@"["] || [key isEqualToString:@"]"] || [key isEqualToString:@"{"] ||
                [key isEqualToString:@"}"]))
    return true;
  if (opt && (event.keyCode == 123 || event.keyCode == 124)) return true;
  return false;
}

NSTimeInterval gMenuKeyTime = -1;

bool PerformMenuKey(NSEvent *event) {
  gMenuKeyTime = event.timestamp;
  return [NSApp.mainMenu performKeyEquivalent:event];
}

void WatchMenuKeys() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [NSNotificationCenter.defaultCenter addObserverForName:NSMenuWillSendActionNotification
                                                    object:nil
                                                     queue:nil
                                                usingBlock:^(NSNotification *) {
                                                  NSEvent *event = NSApp.currentEvent;
                                                  if (event.type == NSEventTypeKeyDown) gMenuKeyTime = event.timestamp;
                                                }];
  });
}

bool IsChromeTabSwitch(int command_id) {
  return (command_id >= IDC_SELECT_NEXT_TAB && command_id <= IDC_SELECT_LAST_TAB) ||
         command_id == IDC_CYCLE_TO_NEXT_TAB || command_id == IDC_CYCLE_TO_PREV_TAB;
}

bool IsChromeShortcutCommand(int command_id) {
  if (IsChromeTabSwitch(command_id)) return true;
  switch (command_id) {
    case IDC_MOVE_TAB_NEXT: case IDC_MOVE_TAB_PREVIOUS: case IDC_SHOW_AVATAR_MENU: case IDC_SHOW_DOWNLOADS:
    case IDC_DEV_TOOLS_INSPECT: case IDC_FOCUS_NEXT_PANE: case IDC_FOCUS_PREVIOUS_PANE:
    case IDC_FOCUS_INACTIVE_POPUP_FOR_ACCESSIBILITY: case IDC_SHOW_READING_MODE_KEYBOARD: case IDC_ADD_NEW_TAB_TO_GROUP:
    case IDC_CREATE_NEW_TAB_GROUP: case IDC_CLOSE_TAB_GROUP: case IDC_FOCUS_NEXT_TAB_GROUP: case IDC_FOCUS_PREV_TAB_GROUP:
      return true;
    default:
      return false;
  }
}

bool IsAppURL(NSString *url) { return [url.lowercaseString hasPrefix:@"netnyahoo:"]; }
bool IsWebUIPage(NSString *url) {
  NSString *u = url.lowercaseString;
  return [u hasPrefix:@"chrome:"] || [u hasPrefix:@"devtools:"];
}
NSString *EngineURL(NSString *appURL) {
  NSString *rest = [appURL substringFromIndex:@"netnyahoo:".length];
  return [@"chrome:" stringByAppendingString:[rest hasPrefix:@"//"] ? rest : [@"//" stringByAppendingString:rest]];
}

// MARK: Page message fields
// The page script runs in the page's own world, where the page can replace
// JSON.stringify or the prototypes it serializes: every field is untrusted.

template <typename T> T *Field(NSDictionary *d, NSString *key) {
  id value = d[key];
  return [value isKindOfClass:[T class]] ? value : nil;
}

NSString *Text(NSDictionary *d, NSString *key, NSUInteger max) {
  NSString *s = Field<NSString>(d, key);
  if (s.length <= max) return s;
  return [s substringToIndex:[s rangeOfComposedCharacterSequenceAtIndex:max].location];
}

bool Flag(NSDictionary *d, NSString *key) { return Field<NSNumber>(d, key).boolValue; }

bool Finite(NSDictionary *d, NSString *key, double *out) {
  NSNumber *n = Field<NSNumber>(d, key);
  if (!n || !isfinite(n.doubleValue)) return false;
  *out = n.doubleValue;
  return true;
}

NSDictionary *NowPlayingState(NSDictionary *d) {
  NSString *state = Field<NSString>(d, @"playbackState");
  if (![@[ @"none", @"paused", @"playing" ] containsObject:state]) state = @"none";
  NSMutableArray *actions = [NSMutableArray array];
  for (id action in Field<NSArray>(d, @"actions"))
    if ([action isKindOfClass:NSString.class] && [action length] <= 64 && actions.count < 32) [actions addObject:action];
  double position = 0, duration = 0, rate = 1, timestamp = 0;
  Finite(d, @"position", &position);
  bool hasDuration = Finite(d, @"duration", &duration) && duration >= 0;
  Finite(d, @"playbackRate", &rate);
  Finite(d, @"timestamp", &timestamp);
  return @{
    @"frame" : Text(d, @"frame", 64) ?: @"",
    @"title" : Text(d, @"title", 1024) ?: @"",
    @"artist" : Text(d, @"artist", 1024) ?: @"",
    @"album" : Text(d, @"album", 1024) ?: @"",
    @"artwork" : Text(d, @"artwork", 1 << 20) ?: [NSNull null],
    @"playbackState" : state,
    @"position" : @(MAX(position, 0)),
    @"duration" : hasDuration ? @(duration) : [NSNull null],
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

}

std::map<std::string, PendingPopup> &Popups() {
  static std::map<std::string, PendingPopup> popups;
  return popups;
}

Client::Client(NNBrowserView *view, NSString *profile) : view_(view), profile_([profile copy] ?: @"") {
  WatchMenuKeys();
  external::WatchUserInput();
}

NSString *Client::URL() const {
  if (!browser_) return @"";
  CefRefPtr<CefFrame> main = browser_->GetMainFrame();
  return main ? ToNS(main->GetURL()) : @"";
}

void Client::Emit(NSString *name, NSDictionary *payload) { [view_ emit:name payload:payload]; }

void Client::EmitNavigation() {
  if (!browser_) return;
  NSString *url = URL();
  if (CefRefPtr<CefNavigationEntry> entry = browser_->GetHost()->GetVisibleNavigationEntry()) {
    NSString *display = ToNS(entry->GetDisplayURL());
    if ([display hasPrefix:@"view-source:"]) url = display;
  }
  Emit(@"navigation", @{
    @"url" : url,
    @"title" : title_ ?: @"",
    @"canGoBack" : @(browser_->CanGoBack()),
    @"canGoForward" : @(browser_->CanGoForward()),
    @"isLoading" : @(browser_->IsLoading()),
    @"themeColor" : themeColor_ ?: [NSNull null],
    @"themeColorSource" : themeSource_ ?: [NSNull null],
  });
}

void Client::EmitMedia() {
  bool playing = false;
  for (const auto &[_, p] : mediaFrames_) playing |= p;
  Emit(@"media", @{@"playing" : @(playing), @"muted" : @(browser_ && browser_->GetHost()->IsAudioMuted())});
}

void Client::EmitSecurity() {
  if (browser_) Emit(@"security", site::SecurityInfo(browser_));
}

void Client::EmitZoom(bool force) {
  if (!browser_) return;
  double factor = zoom::FactorForLevel(browser_->GetHost()->GetZoomLevel());
  if (!force && fabs(factor - lastZoom_) < 0.001) return;
  lastZoom_ = factor;
  Emit(@"zoom", @{
    @"zoom" : @(round(factor * 100) / 100),
    @"host" : HostOf(URL()),
    @"isDefault" : @(fabs(factor - 1) < 0.001),
    @"pinchScale" : @(pinchScale_),
  });
}

void Client::FlushEvals() {
  auto pending = std::move(evals_);
  evals_.clear();
  for (auto &[_, completion] : pending) completion(nil);
}

void Client::SetUserMuted(bool muted) {
  userMuted_ = muted;
  ApplyMute();
}

void Client::SetSiteMuted(bool muted) {
  siteMuted_ = muted;
  ApplyMute();
}

void Client::ApplyMute() {
  if (!browser_) return;
  bool muted = userMuted_ || siteMuted_;
  if (browser_->GetHost()->IsAudioMuted() != muted) browser_->GetHost()->SetAudioMuted(muted);
  EmitMedia();
}

void Client::NoteBlocked(NSString *url) {
  blockedCount_++;
  lastBlocked_ = url;
  if (blockedEmitQueued_) return;
  blockedEmitQueued_ = true;
  CefRefPtr<Client> self(this);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    self->blockedEmitQueued_ = false;
    self->Emit(@"contentBlocked", @{@"count" : @(self->blockedCount_), @"url" : self->lastBlocked_ ?: @""});
  });
}

// MARK: Media

NSDictionary *Client::NowPlaying() const {
  auto it = nowPlaying_.find(nowPlayingFrame_);
  return it == nowPlaying_.end() ? nil : it->second;
}

bool Client::PlayingVideo() const {
  NSDictionary *np = NowPlaying();
  return [np[@"hasVideo"] boolValue] && [np[@"playbackState"] isEqual:@"playing"];
}

bool Client::WantsDocumentPictureInPicture() const {
  NSDictionary *np = NowPlaying();
  bool handles = [np[@"actions"] isKindOfClass:NSArray.class] && [np[@"actions"] containsObject:@"enterpictureinpicture"];
  return handles && (capturing_ || [np[@"playbackState"] isEqual:@"playing"]);
}

void Client::MediaCommand(NSString *action, double seconds) {
  if (!browser_) return;
  CefRefPtr<CefFrame> frame = nowPlayingFrame_.empty() ? nullptr : browser_->GetFrameByIdentifier(nowPlayingFrame_);
  if (!frame) frame = browser_->GetMainFrame();
  CallPage(frame, @"media", @{@"action" : action, @"seconds" : @(seconds)});
}

void Client::ResolveDisplayMedia(NSString *requestId, NSString *sourceId) {
  auto it = displayRequests_.find(requestId.UTF8String ?: "");
  if (it == displayRequests_.end() || !browser_) return;
  DisplayRequest request = it->second;
  displayRequests_.erase(it);
  CefRefPtr<CefFrame> frame = browser_->GetFrameByIdentifier(request.frameId);
  if (!frame) return;
  if (sourceId.length) {
    // Only what the picker showed: this source, and a shared tab's own audio.
    bool tab = [sourceId hasPrefix:@"web-contents-media-stream://"];
    uint32_t media = CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE |
                     (request.audio && tab ? CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE : 0);
    site::AllowDesktopCapture(browser_->GetIdentifier(), request.frameId, OriginOf(ToNS(frame->GetURL())), sourceId,
                              media);
  }
  CallPage(frame, @"displayMedia", @{@"id" : @(request.pageId), @"sourceId" : sourceId.length ? sourceId : [NSNull null]});
}

void Client::NotificationAction(NSString *notificationId, NSString *action) {
  auto it = notificationFrames_.find(notificationId.UTF8String ?: "");
  if (it == notificationFrames_.end() || !browser_) return;
  CefRefPtr<CefFrame> frame = browser_->GetFrameByIdentifier(it->second);
  if (![action isEqualToString:@"click"]) notificationFrames_.erase(it);
  if (frame) CallPage(frame, @"notification", @{@"id" : notificationId, @"action" : action});
}

// MARK: Page script messages

bool Client::OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source,
                                      CefRefPtr<CefProcessMessage> message) {
  if (message->GetName() != "nn") return false;
  CefRefPtr<CefListValue> args = message->GetArgumentList();
  std::string kind = args->GetString(0);
  NSString *json = ToNS(args->GetString(1));
  if (kind == "result") {
    int id = args->GetSize() > 2 ? args->GetInt(2) : 0;
    auto it = evals_.find(id);
    if (it != evals_.end()) {
      auto block = it->second;
      evals_.erase(it);
      block(json);
    }
    return true;
  }
  OnPageMessage(frame, kind, FromJSON(json));
  return true;
}

void Client::OnPageMessage(CefRefPtr<CefFrame> frame, const std::string &kind, id data) {
  NSDictionary *dict = [data isKindOfClass:NSDictionary.class] ? data : nil;
  std::string frameId = frame->GetIdentifier().ToString();
  if (kind == "hello") {
    NSMutableDictionary *config = [NSMutableDictionary dictionary];
    NSString *frameURL = [dict[@"url"] isKindOfClass:NSString.class] ? dict[@"url"] : ToNS(frame->GetURL());
    NSString *topURL = frame->IsMain() ? frameURL : URL();
    if (site::AutoplayBlocked(profile_, topURL)) config[@"blockAutoplay"] = @YES;
    if (DisplayMediaPickerEnabled()) config[@"displayMediaPicker"] = @YES;
    CallPage(frame, @"config", config);
  } else if (kind == "media" && dict) {
    NSString *mediaFrame = Text(dict, @"frame", 64);
    std::string key = frameId + ":" + (mediaFrame.UTF8String ?: "");
    if (!mediaFrame || (mediaFrames_.size() >= 256 && !mediaFrames_.count(key))) return;
    mediaFrames_[key] = Flag(dict, @"playing");
    EmitMedia();
  } else if (kind == "nowPlaying") {
    if (dict) nowPlaying_[frameId] = NowPlayingState(dict);
    else nowPlaying_.erase(frameId);
    nowPlayingFrame_ = dict ? frameId : (nowPlaying_.empty() ? "" : nowPlaying_.begin()->first);
    for (const auto &[fid, np] : nowPlaying_)
      if ([np[@"playbackState"] isEqual:@"playing"]) nowPlayingFrame_ = fid;
    NSMutableDictionary *payload = [NowPlaying() mutableCopy];
    [payload removeObjectForKey:@"frame"];
    Emit(@"nowPlaying", payload ? @{@"state" : payload} : @{@"state" : [NSNull null]});
  } else if (kind == "theme" && frame->IsMain() && dict) {
    NSString *color = [dict[@"color"] isKindOfClass:NSString.class] ? dict[@"color"] : nil;
    NSString *src = [dict[@"source"] isKindOfClass:NSString.class] ? dict[@"source"] : nil;
    if (!((color == themeColor_ || [color isEqualToString:themeColor_]) && (src == themeSource_ || [src isEqualToString:themeSource_]))) {
      themeColor_ = color;
      themeSource_ = src;
      EmitNavigation();
    }
  } else if (kind == "pinch" && frame->IsMain() && dict) {
    double scale;
    if (!Finite(dict, @"scale", &scale) || scale <= 0) return;
    pinchScale_ = MIN(scale, 100);
    EmitZoom(true);
  } else if (kind == "displayMedia" && dict) {
    double pageId;
    if (!Finite(dict, @"id", &pageId) || pageId < 1 || pageId > INT_MAX || pageId != floor(pageId) ||
        displayRequests_.size() >= 16)
      return;
    NSString *origin = OriginOf(ToNS(frame->GetURL()));
    NSString *requestId = NSUUID.UUID.UUIDString;
    displayRequests_[requestId.UTF8String] = {frameId, (int)pageId, Flag(dict, @"audio")};
    Emit(@"displayMediaRequest", @{
      @"id" : requestId,
      @"origin" : origin ?: @"",
      @"audio" : @(Flag(dict, @"audio")),
      @"sources" : site::DesktopCaptureSources(),
    });
  } else if (kind == "pip" && dict) {
    NSNumber *active = Field<NSNumber>(dict, @"active");
    NSString *pipKind = dict[@"kind"] ? Field<NSString>(dict, @"kind") : @"video";
    if (!active || ![@[ @"video", @"document" ] containsObject:pipKind]) return;
    Emit(@"pictureInPicture", @{@"kind" : pipKind, @"active" : @(active.boolValue)});
    if (![pipKind isEqualToString:@"document"]) pip::VideoChanged(view_, HostOf(URL()), frame, active.boolValue);
    // Leaving Picture in Picture never shows the tab by itself: closing the window leaves the video playing where it
    // is. Back to Tab shows it (our pill asks, Chrome's button activates the tab in Chrome's tab strip).
  } else if (kind == "notification" && dict) {
    NSString *nid = Field<NSString>(dict, @"id");
    NSString *origin = OriginOf(ToNS(frame->GetURL()));
    if (!nid.length || nid.length > 128 || !Field<NSString>(dict, @"title") || !origin) return;
    if (notificationFrames_.size() > 500) notificationFrames_.clear();
    notificationFrames_[nid.UTF8String] = frameId;
    Emit(@"notification", @{
      @"id" : nid,
      @"title" : Text(dict, @"title", 1024),
      @"body" : Text(dict, @"body", 4096) ?: @"",
      @"icon" : Text(dict, @"icon", 1 << 20) ?: [NSNull null],
      @"tag" : Text(dict, @"tag", 1024) ?: @"",
      @"silent" : @(Flag(dict, @"silent")),
      @"requireInteraction" : @(Flag(dict, @"requireInteraction")),
      @"origin" : origin,
      @"browserId" : @(browser_ ? browser_->GetIdentifier() : 0),
      @"isMainFrame" : @(frame->IsMain()),
    });
  } else if (kind == "notificationClose" && dict) {
    NSString *nid = Field<NSString>(dict, @"id");
    if (nid.length && nid.length <= 128) {
      notificationFrames_.erase(nid.UTF8String);
      Emit(@"notificationClose", @{@"id" : nid});
    }
  } else if (kind == "selection") {
    Emit(@"pageMessage", @{@"kind" : @"selection", @"data" : SelectionState(dict) ?: [NSNull null]});
  }
}

// MARK: CefDisplayHandler

void Client::OnAddressChange(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &url) {
  if (!frame->IsMain()) return;
  NSString *origin = OriginOf(ToNS(url));
  if (!(origin == committedOrigin_ || [origin isEqualToString:committedOrigin_])) {
    committedOrigin_ = origin;
    site::OriginChanged(this);
  }
  zoom::Committed(this);
  EmitNavigation();
  EmitSecurity();
}

void Client::OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString &title) {
  title_ = ToNS(title);
  EmitNavigation();
}

void Client::OnFaviconURLChange(CefRefPtr<CefBrowser> browser, const std::vector<CefString> &icon_urls) {
  NSMutableArray *urls = [NSMutableArray array];
  for (const auto &u : icon_urls) [urls addObject:ToNS(u)];
  Emit(@"favicon", @{@"url" : urls.firstObject ?: @"", @"urls" : urls});
}

// Page (element) full screen: the page fills the window, which enters macOS full screen for it unless it
// already was, and leaves it afterwards only if it entered for the page.
void Client::OnFullscreenModeChange(CefRefPtr<CefBrowser> browser, bool fullscreen) {
  fullscreen_ = fullscreen;
  if (fullscreen && !fullscreenWindow_) {
    NSWindow *window = view_.window;
    fullscreenWindow_ = host::FullScreenWindow(window) ?: window;
  }
  SyncWindowFullScreen();
  Emit(@"fullscreen", @{@"fullscreen" : @(fullscreen)});
}

void Client::SyncWindowFullScreen() {
  NSWindow *window = fullscreenWindow_;
  if (!window) return WatchFullscreenWindow(nil);
  WatchFullscreenWindow(window);
  // AppKit ignores -toggleFullScreen: mid-transition; FullscreenWindowSettled() comes back here.
  if (host::InFullScreenTransition(window)) return;
  const bool full = host::FullScreenWindow(window) != nil;
  if (fullscreen_ && !full && !enteredFullscreen_) {
    enteredFullscreen_ = true;
    ToggleWindowFullScreen(window);
  } else if (!fullscreen_ && full && enteredFullscreen_) {
    enteredFullscreen_ = false;
    leavingFullscreen_ = true;
    ToggleWindowFullScreen(window);
  } else if (!fullscreen_ && !leavingFullscreen_) {
    enteredFullscreen_ = false;
    fullscreenWindow_ = nil;
    WatchFullscreenWindow(nil);
  }
}

void Client::WatchFullscreenWindow(NSWindow *window) {
  if (fullscreenObservers_ && observedFullscreenWindow_ == window) return;
  for (id observer in fullscreenObservers_) [NSNotificationCenter.defaultCenter removeObserver:observer];
  fullscreenObservers_ = nil;
  observedFullscreenWindow_ = window;
  if (!window) return;
  CefRefPtr<Client> self(this);
  NSMutableArray *observers = [NSMutableArray array];
  for (NSNotificationName name in @[ NSWindowDidEnterFullScreenNotification, NSWindowDidExitFullScreenNotification ]) {
    const bool entered = name == NSWindowDidEnterFullScreenNotification;
    [observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:name
                                                                         object:window
                                                                          queue:nil
                                                                     usingBlock:^(NSNotification *) {
                                                                       // After the window host clears its transition state.
                                                                       dispatch_async(dispatch_get_main_queue(), ^{
                                                                         self->FullscreenWindowSettled(entered);
                                                                       });
                                                                     }]];
  }
  fullscreenObservers_ = observers;
}

void Client::FullscreenWindowSettled(bool entered) {
  if (!entered && !leavingFullscreen_) {
    // Left by hand (the green button, ⌃⌘F): the page leaves full screen too.
    enteredFullscreen_ = false;
    if (fullscreen_ && browser_) return browser_->GetHost()->ExitFullscreen(true);
  }
  if (!entered) leavingFullscreen_ = false;
  SyncWindowFullScreen();
}

#if NN_DOCKED_DEVTOOLS
void Client::OnDevToolsDockChanged(CefRefPtr<CefBrowser> browser) {
  __weak NNBrowserView *view = view_;
  dispatch_async(dispatch_get_main_queue(), ^{ [view layoutDockedDevTools]; });
}
#endif

void Client::OnStatusMessage(CefRefPtr<CefBrowser> browser, const CefString &value) {
  Emit(@"status", @{@"text" : ToNS(value)});
}

void Client::OnLoadingProgressChange(CefRefPtr<CefBrowser> browser, double progress) {
  Emit(@"progress", @{@"progress" : @(progress)});
}

void Client::OnMediaAccessChange(CefRefPtr<CefBrowser> browser, bool has_video_access, bool has_audio_access) {
  uint32_t granted = site::GrantedMedia(browser->GetIdentifier());
  bool screen = has_video_access && (granted & CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE);
  Emit(@"mediaAccess", @{
    @"camera" : @(has_video_access && (!screen || (granted & CEF_MEDIA_PERMISSION_DEVICE_VIDEO_CAPTURE))),
    @"microphone" : @(has_audio_access),
    @"screen" : @(screen),
  });
  capturing_ = has_video_access || has_audio_access;
  if (!has_video_access && !has_audio_access) site::ClearGrantedMedia(browser->GetIdentifier());
}

// MARK: CefLoadHandler

void Client::OnLoadingStateChange(CefRefPtr<CefBrowser> browser, bool isLoading, bool canGoBack, bool canGoForward) {
  EmitNavigation();
  if (!isLoading) EmitSecurity();
}

void Client::OnLoadStart(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, TransitionType) {
  if (!frame->IsMain()) return;
  FlushEvals();
  pendingNavigation_.clear();
  std::string committed = frame->GetURL().ToString();
  if (!committed.empty() && committed != "about:blank") committedPage_ = true;
  mediaFrames_.clear();
  ApplyMute();
  if (!nowPlaying_.empty()) {
    nowPlaying_.clear();
    nowPlayingFrame_.clear();
    Emit(@"nowPlaying", @{@"state" : [NSNull null]});
  }
}

void Client::OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, ErrorCode errorCode,
                         const CefString &errorText, const CefString &failedUrl) {
  if (!frame->IsMain() || errorCode == ERR_ABORTED) return;
  Emit(@"loadError", @{@"url" : ToNS(failedUrl), @"code" : @(errorCode), @"text" : ToNS(errorText)});
}

// MARK: CefLifeSpanHandler

bool Client::OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                           const CefString &target_url, const CefString &target_frame_name,
                           cef_window_open_disposition_t disposition, bool user_gesture,
                           const CefPopupFeatures &features, CefWindowInfo &windowInfo, CefRefPtr<CefClient> &client,
                           CefBrowserSettings &settings, CefRefPtr<CefDictionaryValue> &extra_info,
                           bool *no_javascript_access) {
  NSString *url = ToNS(target_url);
  NSString *openerURL = frame ? ToNS(frame->GetURL()) : URL();
  if (IsAppURL(url) && !IsWebUIPage(openerURL)) return true;

  if (disposition == CEF_WOD_NEW_PICTURE_IN_PICTURE) {
    client = new PictureInPictureClient(view_);
    Emit(@"pictureInPicture", @{@"kind" : @"document", @"active" : @YES});
    return false;
  }
  if (!user_gesture && !site::PopupsAllowed(profile_, openerURL)) {
    NSString *blockedId = site::RecordBlockedPopup(browser->GetIdentifier(), url, ToNS(target_frame_name), features);
    Emit(@"popupBlocked", @{@"id" : blockedId, @"url" : url, @"origin" : OriginOf(openerURL) ?: @""});
    return true;
  }
  if (user_gesture && IsSplitClick(disposition)) {
    Emit(@"openWindow", @{@"url" : url, @"disposition" : @"split", @"userGesture" : @YES});
    return true;
  }
  if (disposition == CEF_WOD_OFF_THE_RECORD) {
    Emit(@"openWindow", @{@"url" : url, @"disposition" : @"incognito", @"userGesture" : @(user_gesture)});
    return true;
  }

  bool popup = disposition == CEF_WOD_NEW_POPUP;
  std::string adoptId = [[NSUUID UUID].UUIDString UTF8String];
  CefRefPtr<Client> popupClient = new Client(nil, profile_);
  popupClient->adoptId_ = adoptId;
  popupClient->openerBrowserId_ = browser->GetIdentifier();
  NSRect bounds = view_ ? view_.bounds : NSMakeRect(0, 0, 1000, 700);
  if (popup) {
    bounds.size = NSMakeSize(features.widthSet ? features.width : 500, features.heightSet ? features.height : 600);
  }
  host::ConfigurePopup(windowInfo, bounds.size);
  client = popupClient;
  Popups()[adoptId] = {popupClient, nullptr, nil};

  NSString *adopt = @(adoptId.c_str());
  if (popup) {
    PopupRequest request;
    request.adoptId = adopt;
    request.profile = profile_;
    request.url = url;
    request.size = bounds.size;
    request.hasOrigin = features.xSet && features.ySet;
    request.origin = NSMakePoint(features.x, features.y);
    request.opener = view_;
    OpenPopupWindow(request);
    return false;
  }
  // An app link opens no tab: ask in the opener, as the page that asked.
  if (external::IsAppLink(target_url)) {
    OpenAppLink(frame, url, user_gesture);
    return true;
  }
  Emit(@"openWindow", @{
    @"url" : url,
    @"adoptId" : adopt,
    @"disposition" : DispositionName(disposition),
    @"userGesture" : @(user_gesture),
  });
  return false;
}

void Client::OnBeforeDevToolsPopup(CefRefPtr<CefBrowser> browser, CefWindowInfo &windowInfo,
                                   CefRefPtr<CefClient> &client, CefBrowserSettings &settings,
                                   CefRefPtr<CefDictionaryValue> &extra_info, bool *use_default_window) {
  if (client.get() == this) client = DevToolsFrontendClient(browser);
}

void Client::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  browser_ = browser;
  BrowserCreated(browser);
  if (openerBrowserId_) host::TabOpenedFrom(browser, openerBrowserId_);
  if (!adoptId_.empty()) {
    auto it = Popups().find(adoptId_);
    if (it == Popups().end()) return;
    it->second.browser = browser;
    if (NNBrowserView *adopter = it->second.adopter) {
      Popups().erase(it);
      SetView(adopter);
      [adopter browserCreated:browser];
      return;
    }
    std::string adoptId = adoptId_;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
      auto pending = Popups().find(adoptId);
      if (pending == Popups().end() || pending->second.adopter) return;
      CefRefPtr<CefBrowser> orphan = pending->second.browser;
      CefRefPtr<Client> client = pending->second.client;
      Popups().erase(pending);
      client->closingByEngine_ = true;
      if (orphan) orphan->GetHost()->CloseBrowser(true);
    });
    return;
  }
  [view_ browserCreated:browser];
}

bool Client::DoClose(CefRefPtr<CefBrowser> browser) {
// Use a run-loop block so shutdown’s nested loop can drain it.
  NSView *hostView = host::ContentsView(browser);
  [NSRunLoop.mainRunLoop performBlock:^{ [hostView removeFromSuperview]; }];
  if (view_ && !view_.closingByRequest && !ShuttingDown() && !closingByEngine_) Emit(@"windowClose", @{});
  return true;
}

void Client::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  if (host::IsChromeTab(browser)) {
    [host::ContentsView(browser) removeFromSuperview];
    if (view_ && !view_.closingByRequest && !ShuttingDown() && !closingByEngine_) Emit(@"windowClose", @{});
  }
  FlushEvals();
  if (fullscreen_) {
    fullscreen_ = false;
    SyncWindowFullScreen();
  }
  BrowserClosed(browser);
  site::BrowserClosed(browser->GetIdentifier());
  if (!adoptId_.empty()) Popups().erase(adoptId_);
  [view_ browserClosed];
  browser_ = nullptr;
}

#if NN_TAB_STRIP
void Client::OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) {
  if (tabStripIndex_ == index && tabStripActive_ == active && tabStripPinned_ == pinned) return;
  const bool first = tabStripIndex_ < 0;
  tabStripIndex_ = index;
  tabStripActive_ = active;
  tabStripPinned_ = pinned;
  if (first) return;
  Emit(@"tabStrip", @{@"index" : @(index), @"active" : @(active), @"pinned" : @(pinned)});
}
#endif

#if NN_TAB_DISCARD
void Client::OnTabDiscardedChanged(CefRefPtr<CefBrowser> browser, bool discarded) {
  [view_ tabDiscardedChanged:discarded];
}
#endif

// MARK: CefRequestHandler

bool Client::OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request,
                            bool user_gesture, bool is_redirect) {
  NSString *url = ToNS(request->GetURL());
  if (IsAppURL(url)) {
    if (frame->IsMain() && IsWebUIPage(ToNS(frame->GetURL()))) {
      CefRefPtr<CefFrame> main = frame;
      NSString *engineURL = EngineURL(url);
      dispatch_async(dispatch_get_main_queue(), ^{ main->LoadURL(ToCef(engineURL)); });
    }
    return true;
  }
  if (!frame->IsMain()) return false;
  if (!is_redirect) pendingNavigation_.clear();
  external::BrowserClosed(browser->GetIdentifier());
  pendingNavigation_.push_back(url.UTF8String);
  bool userInitiated = ConsumeUserNavigation(url) || user_gesture;
  if (!is_redirect && !userInitiated && !committedPage_ && WasNavigationDownload(url, profile_)) {
    pendingNavigation_.clear();
    Emit(@"downloadNavigation", @{@"url" : url, @"committedUrl" : URL(), @"skipped" : @YES});
    return true;
  }
  return false;
}

bool Client::OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &target_url,
                              cef_window_open_disposition_t disposition, bool user_gesture) {
  if (disposition == CEF_WOD_CURRENT_TAB) return false;
  if (IsAppURL(ToNS(target_url)) && !IsWebUIPage(frame ? ToNS(frame->GetURL()) : URL())) return true;
  if (user_gesture) AllowUserNavigation(ToNS(target_url));
  Emit(@"openWindow", @{
    @"url" : ToNS(target_url),
    @"disposition" : IsSplitClick(disposition) ? @"split" : DispositionName(disposition),
    @"userGesture" : @(user_gesture),
  });
  return true;
}

CefRefPtr<CefResourceRequestHandler> Client::GetResourceRequestHandler(
    CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request, bool is_navigation,
    bool is_download, const CefString &request_initiator, bool &disable_default_handling) {
  CefRefPtr<Client> self(this);
  if (is_navigation && frame && frame->IsMain()) {
    dispatch_async(dispatch_get_main_queue(), ^{
      self->blockedCount_ = 0;
      self->lastBlocked_ = nil;
      self->Emit(@"contentBlocked", @{@"count" : @0, @"url" : @""});
    });
    return nullptr;
  }
  static CefRefPtr<BlockedCounter> counter = new BlockedCounter();
  // An app link: GetResourceRequestHandler cancels it and asks (NNExternalApps).
  if (external::IsAppLink(request->GetURL())) {
    external::NoteNavigation(browser->GetIdentifier(), frame->GetIdentifier().ToString(), url, user_gesture);
    return false;
  }
  return is_download ? nullptr : counter;
}

bool Client::OnRenderProcessUnresponsive(CefRefPtr<CefBrowser> browser,
                                         CefRefPtr<CefUnresponsiveProcessCallback> callback) {
  unresponsive_ = true;
  site::SetUnresponsiveCallback(browser->GetIdentifier(), callback);
  Emit(@"unresponsive", @{});
  return true;
}

void Client::OnRenderProcessResponsive(CefRefPtr<CefBrowser> browser) {
  site::SetUnresponsiveCallback(browser->GetIdentifier(), nullptr);
  if (!unresponsive_) return;
  unresponsive_ = false;
  Emit(@"responsive", @{});
  if (external::IsAppLink(target_url)) {
    OpenAppLink(frame, ToNS(target_url), user_gesture);
    return true;
  }
}

void Client::OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int error_code,
                                       const CefString &error_string) {
  FlushEvals();
  mediaFrames_.clear();
  nowPlaying_.clear();
  unresponsive_ = false;
  site::SetUnresponsiveCallback(browser->GetIdentifier(), nullptr);
// An app link from window.open, target=_blank or a modified click: no new tab, the opener asks.
void Client::OpenAppLink(CefRefPtr<CefFrame> frame, NSString *url, bool user_gesture) {
  external::Navigation navigation;
  navigation.url = url;
  navigation.initiator = OriginOf(frame ? ToNS(frame->GetURL()) : URL()) ?: @"null";
  navigation.ownsTab = false;
  navigation.userGesture = user_gesture;
  external::Handle(this, navigation);
}

  static NSString *const kReasons[] = {@"abnormal", @"killed", @"crashed", @"oom", @"launchFailed", @"integrity"};
  NSString *reason = status >= 0 && status < 6 ? kReasons[status] : @"unknown";
  Emit(@"crashed", @{@"status" : @(status), @"reason" : reason, @"code" : @(error_code)});
}
  // Chromium has no loader for an app link; left alone, CEF shows ERR_UNKNOWN_URL_SCHEME. Cancel
  // it quietly (the page stays) and ask on the main thread, with the initiator only this sees.
  if (is_navigation && external::IsAppLink(request->GetURL())) {
    external::Navigation navigation;
    navigation.url = ToNS(request->GetURL());
    navigation.initiator = ToNS(request_initiator);
    navigation.frameId = frame ? frame->GetIdentifier().ToString() : "";
    navigation.ownsTab = !frame || frame->IsMain();
    navigation.typed = (request->GetTransitionType() & TT_SOURCE_MASK) == TT_EXPLICIT;
    dispatch_async(dispatch_get_main_queue(), ^{ external::Handle(self, navigation); });
    return external::Canceller();
  }

bool Client::OnCertificateError(CefRefPtr<CefBrowser> browser, cef_errorcode_t cert_error,
                                const CefString &request_url, CefRefPtr<CefSSLInfo> ssl_info,
                                CefRefPtr<CefCallback> callback) {
  return site::OnCertificateError(this, cert_error, ToNS(request_url), ssl_info, callback);
}

// MARK: CefDownloadHandler

bool Client::OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                              const CefString &suggested_name, CefRefPtr<CefBeforeDownloadCallback> callback) {
  std::string original = item->GetOriginalUrl().ToString(), final = item->GetURL().ToString();
  bool fromNavigation = false;
  for (const std::string &u : pendingNavigation_) fromNavigation |= u == original || u == final;
  if (fromNavigation) {
    NSString *requested = @(pendingNavigation_.front().c_str());
    pendingNavigation_.clear();
    for (NSString *url in @[ requested, ToNS(item->GetOriginalUrl()), ToNS(item->GetURL()) ])
      NoteNavigationDownload(url, profile_);
    Emit(@"downloadNavigation", @{@"url" : requested, @"committedUrl" : committedPage_ ? URL() : @"", @"skipped" : @NO});
  }
  CefRefPtr<CefFrame> page = browser->GetMainFrame();
  return nn::OnBeforeDownload(item, suggested_name, callback, profile_, page ? ToNS(page->GetURL()) : nil);
}

void Client::OnDownloadUpdated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                               CefRefPtr<CefDownloadItemCallback> callback) {
  nn::OnDownloadUpdated(item, callback, profile_);
}

// MARK: CefFindHandler

void Client::OnFindResult(CefRefPtr<CefBrowser> browser, int identifier, int count, const CefRect &rect, int active,
                          bool finalUpdate) {
  Emit(@"find", @{@"count" : @(count), @"active" : @(active), @"final" : @(finalUpdate)});
}

// MARK: CefPermissionHandler

bool Client::OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                            const CefString &origin, uint32_t permissions,
                                            CefRefPtr<CefMediaAccessCallback> callback) {
  if (permissions & (CEF_MEDIA_PERMISSION_DESKTOP_AUDIO_CAPTURE | CEF_MEDIA_PERMISSION_DESKTOP_VIDEO_CAPTURE)) {
    // Screen sharing needs the share picker, and its approval covers only the
    // frame, source and media it was given for: the page chooses what
    // getUserMedia asks for. Like Chrome, nothing else captures the desktop.
    NSString *source = nil;
#if defined(CEF_NN_MEDIA_REQUEST_SOURCE)
    source = ToNS(CefGetMediaAccessDesktopSource(callback));
#endif
    int bid = browser->GetIdentifier();
    if (site::ConsumeDesktopCapture(bid, frame ? frame->GetIdentifier().ToString() : "", OriginOf(ToNS(origin)), source,
                                    permissions)) {
      site::NoteGrantedMedia(bid, permissions);
      callback->Continue(permissions);
    } else {
      callback->Cancel();
    }
    return true;
  }
  return RequestMediaAccess(browser, origin, permissions, callback);
}

bool Client::OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &origin,
                                    uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) {
  return RequestPermission(browser, origin, permissions, callback);
}

// MARK: CefContextMenuHandler

namespace {

constexpr int kUnavailableChromeItems[] = {
    IDC_CONTENT_CONTEXT_OPENLINKINPROFILE, IDC_CONTENT_CONTEXT_OPENLINKBOOKMARKAPP, IDC_CONTENT_CONTEXT_OPENLINKWITH,
    IDC_CONTENT_CONTEXT_OPENLINK_ISOLATED, IDC_CONTENT_CONTEXT_TRANSLATE, IDC_CONTENT_CONTEXT_PARTIAL_TRANSLATE,
    IDC_CONTENT_CONTEXT_OPEN_IN_READING_MODE, IDC_CONTENT_CONTEXT_LENS_REGION_SEARCH, IDC_CONTENT_CONTEXT_LENS_OVERLAY,
    IDC_CONTENT_CONTEXT_SEARCHWEBFORIMAGE, IDC_CONTENT_CONTEXT_SEARCHWEBFORVIDEOFRAME, IDC_CONTENT_CONTEXT_GLIC,
    IDC_CONTENT_CONTEXT_GLICSHAREIMAGE, IDC_CONTENT_CONTEXT_GENERATE_QR_CODE, IDC_CONTENT_CONTEXT_SHARING_SUBMENU,
    IDC_SEND_TAB_TO_SELF,
};

void TidySeparators(CefRefPtr<CefMenuModel> model) {
  for (int i = (int)model->GetCount() - 1; i >= 0; i--) {
    bool separator = model->GetTypeAt(i) == MENUITEMTYPE_SEPARATOR;
    bool edge = i == 0 || i == (int)model->GetCount() - 1;
    if (separator && (edge || model->GetTypeAt(i - 1) == MENUITEMTYPE_SEPARATOR)) model->RemoveAt(i);
  }
}

NSArray *DescribeMenu(CefRefPtr<CefMenuModel> model) {
  NSMutableArray *items = [NSMutableArray array];
  for (size_t i = 0; i < model->GetCount(); i++) {
    NSMutableDictionary *item = [@{
      @"id" : @(model->GetCommandIdAt(i)),
      @"label" : ToNS(model->GetLabelAt(i)),
      @"type" : @(model->GetTypeAt(i)),
      @"enabled" : @(model->IsEnabledAt(i)),
      @"visible" : @(model->IsVisibleAt(i)),
    } mutableCopy];
    if (CefRefPtr<CefMenuModel> sub = model->GetSubMenuAt(i)) item[@"submenu"] = DescribeMenu(sub);
    [items addObject:item];
  }
  return items;
}

int FindMenuItem(CefRefPtr<CefMenuModel> model, NSString *label) {
  for (size_t i = 0; i < model->GetCount(); i++) {
    if ([ToNS(model->GetLabelAt(i)) isEqualToString:label]) return model->GetCommandIdAt(i);
    if (CefRefPtr<CefMenuModel> sub = model->GetSubMenuAt(i))
      if (int id = FindMenuItem(sub, label)) return id;
  }
  return 0;
}

}

void Client::OnBeforeContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                 CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model) {
  if (host::IsChromeTab(browser)) return ChromeTabContextMenu(frame, params, model);
  int index = 0;
  auto insert = [&](int id, NSString *label) { model->InsertItemAt(index++, id, ToCef(label)); };
  auto separator = [&]() { model->InsertSeparatorAt(index++); };
  if (!params->GetLinkUrl().empty()) {
    insert(kOpenLinkNewTab, @"Open Link in New Tab");
    insert(kOpenLinkNewWindow, @"Open Link in New Window");
    if (!Incognito()) insert(kOpenLinkIncognito, @"Open Link in Incognito Window");
    separator();
    insert(kSaveLinkAs, @"Save Link As…");
    insert(kCopyLink, @"Copy Link Address");
    separator();
  }
  if (params->GetMediaType() == CM_MEDIATYPE_IMAGE && !params->GetSourceUrl().empty()) {
    insert(kOpenImageNewTab, @"Open Image in New Tab");
    insert(kSaveImage, @"Save Image As…");
    insert(kCopyImageAddress, @"Copy Image Address");
    separator();
  }
  if (!params->GetSelectionText().empty() && !params->IsEditable()) {
    int copy = model->GetIndexOf(MENU_ID_COPY);
    bool afterCopy = copy >= index;
    if (afterCopy) index = copy + 1;
    if (kChatEnabled) insert(kAskSelection, @"Ask About Selection");
    if (frame->IsMain() && [URL() hasPrefix:@"http"]) insert(kCopyLinkToHighlight, @"Copy Link to Highlight");
    NSString *label = SelectionLabel(ToNS(params->GetSelectionText()));
    insert(kSearchSelection, [NSString stringWithFormat:@"Search %@ for “%@”", gSearchEngineName, label]);
    if (!afterCopy) separator();
  }
  if (model->GetCount() > 0 && model->GetTypeAt(model->GetCount() - 1) != MENUITEMTYPE_SEPARATOR)
    model->AddSeparator();
  model->AddItem(kInspect, "Inspect");
  while (model->GetCount() > 0 && model->GetTypeAt(0) == MENUITEMTYPE_SEPARATOR) model->RemoveAt(0);
}

void Client::ChromeTabContextMenu(CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                                  CefRefPtr<CefMenuModel> model) {
  for (int id : kUnavailableChromeItems)
    while (model->Remove(id)) {
    }
  if (!params->GetSelectionText().empty()) {
    NSString *label = [NSString stringWithFormat:@"Search %@ for “%@”", gSearchEngineName,
                                                 SelectionLabel(ToNS(params->GetSelectionText()))];
    if (model->GetIndexOf(IDC_CONTENT_CONTEXT_SEARCHWEBFOR) >= 0) {
      model->SetLabel(IDC_CONTENT_CONTEXT_SEARCHWEBFOR, ToCef(label));
    } else if (model->GetIndexOf(IDC_CONTENT_CONTEXT_SEARCHWEBFORNEWTAB) >= 0) {
      model->SetLabel(IDC_CONTENT_CONTEXT_SEARCHWEBFORNEWTAB, ToCef(label));
    } else if (!params->IsEditable() && model->GetIndexOf(MENU_ID_COPY) >= 0) {
      model->InsertItemAt(model->GetIndexOf(MENU_ID_COPY) + 1, kSearchSelection, ToCef(label));
    }
    if (kChatEnabled && !params->IsEditable() && model->GetIndexOf(MENU_ID_COPY) >= 0)
      model->InsertItemAt(model->GetIndexOf(MENU_ID_COPY) + 1, kAskSelection, "Ask About Selection");
  }
  TidySeparators(model);
}

bool Client::RunContextMenu(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefContextMenuParams> params, CefRefPtr<CefMenuModel> model,
                            CefRefPtr<CefRunContextMenuCallback> callback) {
  static const char *log = getenv("NETNYAHOO_CONTEXT_MENU_LOG");
  if (!log) return false;
  NSString *path = @(log), *pickPath = [path stringByAppendingString:@".pick"];
  NSDictionary *menu = @{@"url" : URL(), @"link" : ToNS(params->GetLinkUrl()), @"items" : DescribeMenu(model)};
  [ToJSON(menu) writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil];
  NSString *pick = [NSString stringWithContentsOfFile:pickPath encoding:NSUTF8StringEncoding error:nil];
  [NSFileManager.defaultManager removeItemAtPath:pickPath error:nil];
  pick = [pick stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (int id = pick.length ? FindMenuItem(model, pick) : 0) callback->Continue(id, EVENTFLAG_NONE);
  else callback->Cancel();
  return true;
}

bool Client::OnContextMenuCommand(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                                  CefRefPtr<CefContextMenuParams> params, int command_id,
                                  cef_event_flags_t event_flags) {
  NSString *link = ToNS(params->GetLinkUrl());
  NSString *src = ToNS(params->GetSourceUrl());
  switch (command_id) {
    case IDC_CONTENT_CONTEXT_SEARCHWEBFOR:
    case IDC_CONTENT_CONTEXT_SEARCHWEBFORNEWTAB:
      command_id = kSearchSelection;
      break;
    case IDC_CONTENT_CONTEXT_COPYLINKTOTEXT:
      command_id = kCopyLinkToHighlight;
      break;
    case IDC_CONTENT_CONTEXT_INSPECTELEMENT:
      command_id = kInspect;
      break;
    case IDC_CONTENT_CONTEXT_OPENLINKSPLITVIEW:
      AllowUserNavigation(link);
      Emit(@"openWindow", @{@"url" : link, @"disposition" : @"split", @"userGesture" : @YES});
      return true;
  }
  switch (command_id) {
    case kOpenLinkNewTab:
      AllowUserNavigation(link);
      Emit(@"openWindow", @{@"url" : link, @"disposition" : @"background"});
      return true;
    case kOpenLinkNewWindow:
      AllowUserNavigation(link);
      Emit(@"openWindow", @{@"url" : link, @"disposition" : @"window"});
      return true;
    case kOpenLinkIncognito:
      AllowUserNavigation(link);
      Emit(@"openWindow", @{@"url" : link, @"disposition" : @"incognito"});
      return true;
    case kCopyLink:
      [NSPasteboard.generalPasteboard clearContents];
      [NSPasteboard.generalPasteboard setString:link forType:NSPasteboardTypeString];
      return true;
    case kSaveLinkAs:
      browser->GetHost()->StartDownload(params->GetLinkUrl());
      return true;
    case kOpenImageNewTab:
      Emit(@"openWindow", @{@"url" : src, @"disposition" : @"background"});
      return true;
    case kSaveImage:
      browser->GetHost()->StartDownload(params->GetSourceUrl());
      return true;
    case kCopyImageAddress:
      [NSPasteboard.generalPasteboard clearContents];
      [NSPasteboard.generalPasteboard setString:src forType:NSPasteboardTypeString];
      return true;
    case kSearchSelection:
      Emit(@"command", @{@"command" : @"search", @"text" : ToNS(params->GetSelectionText())});
      return true;
    case kAskSelection:
      Emit(@"command", @{@"command" : @"ask", @"text" : ToNS(params->GetSelectionText())});
      return true;
    case kCopyLinkToHighlight:
      Emit(@"command", @{@"command" : @"copyLinkToHighlight", @"text" : ToNS(params->GetSelectionText())});
      return true;
    case kInspect:
      nn::ShowDevTools(browser, nil, CefPoint(params->GetXCoord(), params->GetYCoord()));
      return true;
  }
  return false;
}

// MARK: CefFocusHandler

void Client::OnGotFocus(CefRefPtr<CefBrowser> browser) {
  if (host::ActivatingTab()) return;
  if (view_) host::TabShown(view_);
  Emit(@"focus", @{});
}

// MARK: CefKeyboardHandler

bool Client::OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                           bool *is_keyboard_shortcut) {
  if (event.type != KEYEVENT_RAWKEYDOWN) return false;
  if (event.windows_key_code == 0x1B && fullscreen_) {
    browser->GetHost()->ExitFullscreen(true);
    return true;
  }
  NSEvent *ns = (__bridge NSEvent *)os_event;
  if (!ns || ns.type != NSEventTypeKeyDown) return false;
  if (IsReservedShortcut(ns)) return PerformMenuKey(ns);
  if (ns.modifierFlags & NSEventModifierFlagCommand) *is_keyboard_shortcut = true;
  return false;
}

bool Client::OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) {
  NSEvent *ns = (__bridge NSEvent *)os_event;
  if (event.type != KEYEVENT_RAWKEYDOWN || !ns || ns.type != NSEventTypeKeyDown) return false;
  if (event.windows_key_code == 0x1B && !(ns.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask & ~NSEventModifierFlagFunction) &&
      browser->IsLoading()) {
    browser->StopLoad();
    return true;
  }
  if (!(ns.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagFunction)))
    return false;
  if (event.focus_on_editable_field && event.windows_key_code == 0x0D &&
      (ns.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask) == NSEventModifierFlagCommand)
    return false;
  return PerformMenuKey(ns);
}

// MARK: CefJSDialogHandler

bool Client::OnBeforeUnloadDialog(CefRefPtr<CefBrowser> browser, const CefString &message_text, bool is_reload,
                                  CefRefPtr<CefJSDialogCallback> callback) {
  if (view_ || is_reload || ShuttingDown()) return false;
  NSWindow *window = host::OpenWindowOf(browser);
  if (!window) return false;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Leave site?";
  alert.informativeText = @"Changes you made may not be saved.";
  [alert addButtonWithTitle:@"Leave"];
  external::NoteUserInput();
  [alert addButtonWithTitle:@"Cancel"];
  CefRefPtr<Client> self(this);
  CefRefPtr<CefBrowser> tab = browser;
  [alert beginSheetModalForWindow:window
                completionHandler:^(NSModalResponse response) {
                  bool leave = response == NSAlertFirstButtonReturn;
                  callback->Continue(leave, "");
                  if (!leave && !host::ReadoptTab(tab, self)) tab->GetHost()->CloseBrowser(true);
                }];
  return true;
}

// MARK: CefCommandHandler

bool Client::OnChromeCommand(CefRefPtr<CefBrowser> browser, int command_id, cef_window_open_disposition_t disposition) {
  if (command_id == IDC_MANAGE_PASSWORDS_FOR_PAGE) return chromeui::ShowPasswordPrompt(this, browser);
  return MenuBarTakesChromeShortcut(command_id) || host::BlocksChromeCommand(browser, command_id);
}

bool MenuBarTakesChromeShortcut(int command_id) {
  NSEvent *event = NSApp.currentEvent;
  if (event.type == NSEventTypeKeyDown && event.timestamp != gMenuKeyTime &&
      (PerformMenuKey(event) || IsChromeShortcutCommand(command_id)))
    return true;
  return IsChromeTabSwitch(command_id);
}

}

@implementation NNCef (ContextMenu)

+ (NSString *)searchEngineName {
  return nn::gSearchEngineName;
}

+ (void)setSearchEngineName:(NSString *)name {
  nn::gSearchEngineName = name.length ? [name copy] : @"Google";
}

@end
