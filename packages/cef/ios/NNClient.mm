#import "NNClient.h"

#import "NNChromeUI.h"
#import "NNPictureInPicture.h"
#import "NNPopupWindow.h"
#import "NNSiteSettings.h"
#import "NNWindowHost.h"
#import "NNZoom.h"

#include "include/cef_command_ids.h"
#include "include/cef_process_message.h"
#include "include/cef_values.h"

namespace nn {

namespace {

// Custom context-menu command ids (MENU_ID_USER_FIRST .. MENU_ID_USER_LAST).
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

// "Ask About Selection" comes back with Chat (AI is deferred).
constexpr bool kChatEnabled = false;

NSString *gSearchEngineName = @"Google";

/// Chrome's label text for a selection: whitespace collapsed, cut at a word
/// boundary after 50 characters.
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

/// Dia's ⇧⌥-click opens the link in a split pane. Blink reports it as a new window
/// (⇧ wins), so look at the modifier keys held right now.
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

/// Counts the page's requests an extension blocked (the content blocker is
/// uBlock Origin Lite's declarativeNetRequest rules: ERR_BLOCKED_BY_CLIENT).
class BlockedCounter : public CefResourceRequestHandler {
 public:
  void OnResourceLoadComplete(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> request,
                              CefRefPtr<CefResponse> response, URLRequestStatus status, int64_t) override {
    // IO thread.
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

/// A Document Picture-in-Picture window (documentPictureInPicture.requestWindow):
/// the engine's own window; the opener's tab reports it closing.
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

/// Browser shortcuts a page can't intercept (Chrome's "reserved" commands):
/// new/close tab or window, reopen tab, tab switching, quit.
bool IsReservedShortcut(NSEvent *event) {
  NSEventModifierFlags mods = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  NSString *key = event.charactersIgnoringModifiers.lowercaseString;
  bool cmd = mods & NSEventModifierFlagCommand, shift = mods & NSEventModifierFlagShift,
       opt = mods & NSEventModifierFlagOption, ctrl = mods & NSEventModifierFlagControl;
  if (ctrl && event.keyCode == 48) return true;  // ⌃Tab / ⌃⇧Tab
  if (!cmd || ctrl) return false;
  if (!opt && [@[ @"t", @"n", @"w", @"q" ] containsObject:key]) return true;  // with or without ⇧
  if (!opt && !shift && key.length == 1 && [key characterAtIndex:0] >= '1' && [key characterAtIndex:0] <= '9') return true;
  if (shift && ([key isEqualToString:@"["] || [key isEqualToString:@"]"] || [key isEqualToString:@"{"] ||
                [key isEqualToString:@"}"]))
    return true;
  if (opt && (event.keyCode == 123 || event.keyCode == 124)) return true;  // ⌥⌘← / ⌥⌘→
  return false;
}

/// netnyahoo://x is the app's name for Chrome's chrome://x pages (the JS WebView maps what the app
/// loads). A page may open one only if it is a WebUI page itself, as Chrome keeps web pages from
/// opening chrome:// URLs (chrome://quit, chrome://settings/reset…).
bool IsAppURL(NSString *url) { return [url.lowercaseString hasPrefix:@"netnyahoo:"]; }
bool IsWebUIPage(NSString *url) {
  NSString *u = url.lowercaseString;
  return [u hasPrefix:@"chrome:"] || [u hasPrefix:@"devtools:"];
}
NSString *EngineURL(NSString *appURL) {
  NSString *rest = [appURL substringFromIndex:@"netnyahoo:".length];
  return [@"chrome:" stringByAppendingString:[rest hasPrefix:@"//"] ? rest : [@"//" stringByAppendingString:rest]];
}

}  // namespace

std::map<std::string, PendingPopup> &Popups() {
  static std::map<std::string, PendingPopup> popups;
  return popups;
}

Client::Client(NNBrowserView *view, NSString *profile) : view_(view), profile_([profile copy] ?: @"") {}

NSString *Client::URL() const {
  if (!browser_) return @"";
  CefRefPtr<CefFrame> main = browser_->GetMainFrame();
  return main ? ToNS(main->GetURL()) : @"";
}

void Client::Emit(NSString *name, NSDictionary *payload) { [view_ emit:name payload:payload]; }

void Client::EmitNavigation() {
  if (!browser_) return;
  // A view-source: tab's frame shows the page's own URL; Chrome's address bar (and a restored or
  // reloaded tab) keep the view-source: one.
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
  // Pages can block hundreds of requests; coalesce into a few events per second.
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
  auto [frameId, pageId] = it->second;
  displayRequests_.erase(it);
  CefRefPtr<CefFrame> frame = browser_->GetFrameByIdentifier(frameId);
  if (!frame) return;
  if (sourceId.length) site::AllowDesktopCapture(browser_->GetIdentifier());
  CallPage(frame, @"displayMedia", @{@"id" : @(pageId), @"sourceId" : sourceId.length ? sourceId : [NSNull null]});
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
    // Which page-script features run in this frame.
    NSMutableDictionary *config = [NSMutableDictionary dictionary];
    NSString *frameURL = [dict[@"url"] isKindOfClass:NSString.class] ? dict[@"url"] : ToNS(frame->GetURL());
    NSString *topURL = frame->IsMain() ? frameURL : URL();
    if (site::AutoplayBlocked(profile_, topURL)) config[@"blockAutoplay"] = @YES;
    if (DisplayMediaPickerEnabled()) config[@"displayMediaPicker"] = @YES;
    CallPage(frame, @"config", config);
  } else if (kind == "media" && dict) {
    mediaFrames_[frameId + ":" + [dict[@"frame"] description].UTF8String] = [dict[@"playing"] boolValue];
    EmitMedia();
  } else if (kind == "nowPlaying") {
    if (dict) nowPlaying_[frameId] = dict;
    else nowPlaying_.erase(frameId);
    // The playing frame wins; otherwise the one that reported last.
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
    pinchScale_ = [dict[@"scale"] doubleValue] ?: 1;
    EmitZoom(true);
  } else if (kind == "displayMedia" && dict) {
    NSString *origin = OriginOf(ToNS(frame->GetURL()));
    NSString *requestId = NSUUID.UUID.UUIDString;
    displayRequests_[requestId.UTF8String] = {frameId, [dict[@"id"] intValue]};
    Emit(@"displayMediaRequest", @{
      @"id" : requestId,
      @"origin" : origin ?: @"",
      @"audio" : @([dict[@"audio"] boolValue]),
      @"sources" : site::DesktopCaptureSources(),
    });
  } else if (kind == "pip" && dict) {
    bool active = [dict[@"active"] boolValue];
    Emit(@"pictureInPicture", @{@"kind" : dict[@"kind"] ?: @"video", @"active" : @(active)});
    // Dia's host pill, menu and edge stash on Chrome's video PiP window.
    if (![dict[@"kind"] isEqual:@"document"]) pip::VideoChanged(view_, HostOf(URL()), frame, active);
    // "Back to tab" from Chromium's PiP window reaches no delegate; the video
    // still playing after PiP closed is the tell.
    if (!active && [dict[@"playing"] boolValue] && (!view_.visible || !NSApp.isActive))
      Emit(@"activateRequest", @{@"reason" : @"pictureInPicture"});
  } else if (kind == "notification" && dict) {
    NSString *nid = [dict[@"id"] isKindOfClass:NSString.class] ? dict[@"id"] : nil;
    NSString *origin = OriginOf(ToNS(frame->GetURL()));
    if (!nid || !origin) return;
    if (notificationFrames_.size() > 500) notificationFrames_.clear();
    notificationFrames_[nid.UTF8String] = frameId;
    NSMutableDictionary *payload = [dict mutableCopy];
    payload[@"origin"] = origin;  // from the frame, not the page
    payload[@"browserId"] = @(browser_ ? browser_->GetIdentifier() : 0);
    payload[@"isMainFrame"] = @(frame->IsMain());
    Emit(@"notification", payload);
  } else if (kind == "notificationClose" && dict) {
    if ([dict[@"id"] isKindOfClass:NSString.class]) {
      notificationFrames_.erase([dict[@"id"] UTF8String]);
      Emit(@"notificationClose", @{@"id" : dict[@"id"]});
    }
  } else {
    Emit(@"pageMessage", @{@"kind" : @(kind.c_str()), @"data" : data ?: [NSNull null]});
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

void Client::OnFullscreenModeChange(CefRefPtr<CefBrowser> browser, bool fullscreen) {
  fullscreen_ = fullscreen;
  NSWindow *window = view_.window;
  BOOL windowFullscreen = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
  // A test instance (NETNYAHOO_BACKGROUND) never takes the window full screen: that opens a new
  // Space on the screen of whoever is working next to it. The page still goes full screen in the
  // window (logged to activation.log).
  const bool mayToggle = !activation::Background() || activation::Allow(@"toggleFullScreen: (page full screen)");
  if (fullscreen && !windowFullscreen && mayToggle) {
    enteredFullscreen_ = true;
    [window toggleFullScreen:nil];
  } else if (!fullscreen && windowFullscreen && enteredFullscreen_) {
    [window toggleFullScreen:nil];
  }
  if (!fullscreen) enteredFullscreen_ = false;
  Emit(@"fullscreen", @{@"fullscreen" : @(fullscreen)});
}

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
  // Capture ended: the next grant says what the next capture is.
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
  ApplyMute();  // also emits media
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

  // Document Picture-in-Picture (documentPictureInPicture.requestWindow; Blink
  // already required a user activation): the engine's own floating window.
  if (disposition == CEF_WOD_NEW_PICTURE_IN_PICTURE) {
    client = new PictureInPictureClient(view_);
    Emit(@"pictureInPicture", @{@"kind" : @"document", @"active" : @YES});
    return false;
  }
  // Pop-up blocker: window.open without a user gesture needs the site's permission.
  if (!user_gesture && !site::PopupsAllowed(profile_, openerURL)) {
    NSString *blockedId = site::RecordBlockedPopup(browser->GetIdentifier(), url, ToNS(target_frame_name), features);
    Emit(@"popupBlocked", @{@"id" : blockedId, @"url" : url, @"origin" : OriginOf(openerURL) ?: @""});
    return true;
  }
  // ⇧⌥-click on a target=_blank link: a split pane (it loads fresh, without an opener).
  if (user_gesture && IsSplitClick(disposition)) {
    Emit(@"openWindow", @{@"url" : url, @"disposition" : @"split", @"userGesture" : @YES});
    return true;
  }
  // A private window can't share this browser's context (or its opener).
  if (disposition == CEF_WOD_OFF_THE_RECORD) {
    Emit(@"openWindow", @{@"url" : url, @"disposition" : @"incognito", @"userGesture" : @(user_gesture)});
    return true;
  }

  // Everything else becomes a browser now (so window.opener works) parked
  // until a view adopts it: a little native window for popups, otherwise
  // whatever view the UI creates for the openWindow event.
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
  Emit(@"openWindow", @{
    @"url" : url,
    @"adoptId" : adopt,
    @"disposition" : DispositionName(disposition),
    @"userGesture" : @(user_gesture),
  });
  return false;
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
    // Nobody adopted it (the UI ignored the openWindow event): don't leak it.
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
  // Returning false would make CEF send performClose: to the hosting NSWindow
  // (the whole browser window). Tear down just this browser's view instead.
  // (A run-loop block, not GCD: it must also run inside the nested run loop
  // +[NNCef shutdown] spins, which may itself be inside a main-queue block.)
  NSView *hostView = host::ContentsView(browser);
  [NSRunLoop.mainRunLoop performBlock:^{ [hostView removeFromSuperview]; }];
  // window.close() from the page: let the UI close the tab. Closes we started
  // (closeBrowser, discard, orphaned popups, app shutdown) aren't reported.
  if (view_ && !view_.closingByRequest && !ShuttingDown() && !closingByEngine_) Emit(@"windowClose", @{});
  return true;
}

void Client::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  // Chrome closes its tabs without DoClose (window.close(), chrome.tabs.remove, the
  // Browser closing): same as there.
  if (host::IsChromeTab(browser)) {
    [host::ContentsView(browser) removeFromSuperview];
    if (view_ && !view_.closingByRequest && !ShuttingDown() && !closingByEngine_) Emit(@"windowClose", @{});
  }
  FlushEvals();
  BrowserClosed(browser);
  site::BrowserClosed(browser->GetIdentifier());
  if (!adoptId_.empty()) Popups().erase(adoptId_);
  [view_ browserClosed];
  browser_ = nullptr;
}

#if NN_TAB_STRIP
void Client::OnTabStripChanged(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) {
  // Chrome reports every tab after each change; only what moved matters to the app.
  if (tabStripIndex_ == index && tabStripActive_ == active && tabStripPinned_ == pinned) return;
  tabStripIndex_ = index;
  tabStripActive_ = active;
  tabStripPinned_ = pinned;
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
  pendingNavigation_.push_back(url.UTF8String);
  // A URL that already turned into a download isn't downloaded again by a
  // load nobody asked for: restoring the tab, recreating a discarded or
  // remounted view. (A click, or loadUrl(url, {userInitiated}), still works.)
  bool userInitiated = ConsumeUserNavigation(url) || user_gesture;
  if (!is_redirect && !userInitiated && !committedPage_ && WasNavigationDownload(url)) {
    pendingNavigation_.clear();
    Emit(@"downloadNavigation", @{@"url" : url, @"committedUrl" : URL(), @"skipped" : @YES});
    return true;
  }
  return false;
}

bool Client::OnOpenURLFromTab(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, const CefString &target_url,
                              cef_window_open_disposition_t disposition, bool user_gesture) {
  // ⌘/middle/⇧-clicks on links: background tab / tab / window, like Chrome.
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
  // IO thread.
  CefRefPtr<Client> self(this);
  if (is_navigation && frame && frame->IsMain()) {
    // A new page: restart the blocked counter (posted, so it's ordered before
    // any of the new page's blocked subresources).
    dispatch_async(dispatch_get_main_queue(), ^{
      self->blockedCount_ = 0;
      self->lastBlocked_ = nil;
      self->Emit(@"contentBlocked", @{@"count" : @0, @"url" : @""});
    });
    return nullptr;
  }
  static CefRefPtr<BlockedCounter> counter = new BlockedCounter();
  return is_download ? nullptr : counter;
}

bool Client::OnRenderProcessUnresponsive(CefRefPtr<CefBrowser> browser,
                                         CefRefPtr<CefUnresponsiveProcessCallback> callback) {
  unresponsive_ = true;
  site::SetUnresponsiveCallback(browser->GetIdentifier(), callback);
  Emit(@"unresponsive", @{});
  return true;  // keep waiting until the UI decides (see NNBrowserView -terminateUnresponsive)
}

void Client::OnRenderProcessResponsive(CefRefPtr<CefBrowser> browser) {
  site::SetUnresponsiveCallback(browser->GetIdentifier(), nullptr);
  if (!unresponsive_) return;
  unresponsive_ = false;
  Emit(@"responsive", @{});
}

void Client::OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser, TerminationStatus status, int error_code,
                                       const CefString &error_string) {
  FlushEvals();
  mediaFrames_.clear();
  nowPlaying_.clear();
  unresponsive_ = false;
  site::SetUnresponsiveCallback(browser->GetIdentifier(), nullptr);
  static NSString *const kReasons[] = {@"abnormal", @"killed", @"crashed", @"oom", @"launchFailed", @"integrity"};
  NSString *reason = status >= 0 && status < 6 ? kReasons[status] : @"unknown";
  Emit(@"crashed", @{@"status" : @(status), @"reason" : reason, @"code" : @(error_code)});
}

bool Client::OnCertificateError(CefRefPtr<CefBrowser> browser, cef_errorcode_t cert_error,
                                const CefString &request_url, CefRefPtr<CefSSLInfo> ssl_info,
                                CefRefPtr<CefCallback> callback) {
  return site::OnCertificateError(this, cert_error, ToNS(request_url), ssl_info, callback);
}

// MARK: CefDownloadHandler

bool Client::OnBeforeDownload(CefRefPtr<CefBrowser> browser, CefRefPtr<CefDownloadItem> item,
                              const CefString &suggested_name, CefRefPtr<CefBeforeDownloadCallback> callback) {
  // The tab's navigation became this download: like Chrome, the tab keeps its
  // page (nothing is committed); tell the UI so it doesn't keep the URL either.
  std::string original = item->GetOriginalUrl().ToString(), final = item->GetURL().ToString();
  bool fromNavigation = false;
  for (const std::string &u : pendingNavigation_) fromNavigation |= u == original || u == final;
  if (fromNavigation) {
    NSString *requested = @(pendingNavigation_.front().c_str());
    pendingNavigation_.clear();
    for (NSString *url in @[ requested, ToNS(item->GetOriginalUrl()), ToNS(item->GetURL()) ])
      NoteNavigationDownload(url, !Incognito());
    Emit(@"downloadNavigation", @{@"url" : requested, @"committedUrl" : committedPage_ ? URL() : @"", @"skipped" : @NO});
  }
  return nn::OnBeforeDownload(item, suggested_name, callback);
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
  return RequestMediaAccess(browser, origin, permissions, callback);
}

bool Client::OnShowPermissionPrompt(CefRefPtr<CefBrowser> browser, uint64_t prompt_id, const CefString &origin,
                                    uint32_t permissions, CefRefPtr<CefPermissionPromptCallback> callback) {
  return RequestPermission(browser, origin, permissions, callback);
}

// MARK: CefContextMenuHandler

namespace {

/// Chrome's page menu items that open Chrome UI this app doesn't show (Chrome's own split view,
/// profile windows, side panels, bubbles anchored to its hidden toolbar) or need Google services.
constexpr int kUnavailableChromeItems[] = {
    IDC_CONTENT_CONTEXT_OPENLINKINPROFILE, IDC_CONTENT_CONTEXT_OPENLINKBOOKMARKAPP, IDC_CONTENT_CONTEXT_OPENLINKWITH,
    IDC_CONTENT_CONTEXT_OPENLINK_ISOLATED, IDC_CONTENT_CONTEXT_TRANSLATE, IDC_CONTENT_CONTEXT_PARTIAL_TRANSLATE,
    IDC_CONTENT_CONTEXT_OPEN_IN_READING_MODE, IDC_CONTENT_CONTEXT_LENS_REGION_SEARCH, IDC_CONTENT_CONTEXT_LENS_OVERLAY,
    IDC_CONTENT_CONTEXT_SEARCHWEBFORIMAGE, IDC_CONTENT_CONTEXT_SEARCHWEBFORVIDEOFRAME, IDC_CONTENT_CONTEXT_GLIC,
    IDC_CONTENT_CONTEXT_GLICSHAREIMAGE, IDC_CONTENT_CONTEXT_GENERATE_QR_CODE, IDC_CONTENT_CONTEXT_SHARING_SUBMENU,
    IDC_SEND_TAB_TO_SELF,
};

/// No separator first, last or twice in a row.
void TidySeparators(CefRefPtr<CefMenuModel> model) {
  for (int i = (int)model->GetCount() - 1; i >= 0; i--) {
    bool separator = model->GetTypeAt(i) == MENUITEMTYPE_SEPARATOR;
    bool edge = i == 0 || i == (int)model->GetCount() - 1;
    if (separator && (edge || model->GetTypeAt(i - 1) == MENUITEMTYPE_SEPARATOR)) model->RemoveAt(i);
  }
}

/// DEV (NETNYAHOO_CONTEXT_MENU_LOG=<file>): each page menu is written to <file> as JSON instead of
/// shown; if <file>.pick holds an item's label, that item runs (its extension, Chrome's handler or
/// ours), then the pick file is removed. Test instances can't show a menu nobody closes.
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

}  // namespace

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
    // Chrome's order: Copy, Copy Link to Highlight, Search … for “…”.
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
  // Drop a leading/trailing/double separator left by the defaults.
  while (model->GetCount() > 0 && model->GetTypeAt(0) == MENUITEMTYPE_SEPARATOR) model->RemoveAt(0);
}

/// Chrome's own page menu (links, images, media, spelling, extensions' items, Print, Save As…,
/// View Page Source) with what differs in this app: the search engine and Inspect are ours, Copy
/// Link to Highlight makes Dia's clean quote link, Open Link in Split View opens our split, and
/// items for Chrome UI we don't show are gone.
void Client::ChromeTabContextMenu(CefRefPtr<CefFrame> frame, CefRefPtr<CefContextMenuParams> params,
                                  CefRefPtr<CefMenuModel> model) {
  // Chrome adds some twice (Open in Reading Mode on editable fields); Remove takes one at a time.
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
      // Chrome only offers it with a default search engine of its own.
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
    // Chrome's items that are ours to run.
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
  // Chrome focuses a tab it activates (host::TabShown): not the user's doing, and reporting it
  // made two split panes activate each other forever.
  if (host::ActivatingTab()) return;
  if (view_) host::TabShown(view_);
  Emit(@"focus", @{});
}

// MARK: CefKeyboardHandler

bool Client::OnPreKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event,
                           bool *is_keyboard_shortcut) {
  if (event.type != KEYEVENT_RAWKEYDOWN) return false;
  // Esc leaves page fullscreen (in Chrome the browser, not the page, owns this key).
  if (event.windows_key_code == 0x1B && fullscreen_) {
    browser->GetHost()->ExitFullscreen(true);
    return true;
  }
  NSEvent *ns = (__bridge NSEvent *)os_event;
  if (!ns || ns.type != NSEventTypeKeyDown) return false;
  if (IsReservedShortcut(ns)) return [NSApp.mainMenu performKeyEquivalent:ns];
  // Other ⌘ shortcuts go to the page first; unhandled ones come back through OnKeyEvent.
  if (ns.modifierFlags & NSEventModifierFlagCommand) *is_keyboard_shortcut = true;
  return false;
}

bool Client::OnKeyEvent(CefRefPtr<CefBrowser> browser, const CefKeyEvent &event, CefEventHandle os_event) {
  NSEvent *ns = (__bridge NSEvent *)os_event;
  if (event.type != KEYEVENT_RAWKEYDOWN || !ns || ns.type != NSEventTypeKeyDown) return false;
  // Esc the page didn't use stops a loading page (Chrome's Stop accelerator).
  if (event.windows_key_code == 0x1B && !(ns.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask & ~NSEventModifierFlagFunction) &&
      browser->IsLoading()) {
    browser->StopLoad();
    return true;
  }
  if (!(ns.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagFunction)))
    return false;
  // ⌘↩ a text field didn't use isn't Back to Pinned URL (the menu keeps it from our own fields the
  // same way): on a pinned tab it could navigate away from a half-written form.
  if (event.focus_on_editable_field && event.windows_key_code == 0x0D &&
      (ns.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask) == NSEventModifierFlagCommand)
    return false;
  // The page didn't consume it: give the menu bar its turn (⌘L, ⌘F, ⌘R, Edit menu…).
  // Then Chrome's own handling, in its Browser window (the key window): extensions'
  // chrome.commands run, and its commands for its hidden UI are refused in OnChromeCommand
  // (host::BlocksChromeCommand).
  return [NSApp.mainMenu performKeyEquivalent:ns];
}

// MARK: CefJSDialogHandler

bool Client::OnBeforeUnloadDialog(CefRefPtr<CefBrowser> browser, const CefString &message_text, bool is_reload,
                                  CefRefPtr<CefJSDialogCallback> callback) {
  // A page still in the app (reload, navigation, window.close()): Chrome's dialog, as before.
  if (view_ || is_reload || ShuttingDown()) return false;
  // The app already closed the tab (⌘W, the close button): Chrome keeps it open while it asks,
  // and a "Cancel" kept a page with no tab showing it, loaded and playing, until quit. The same
  // question here, and a cancelled close brings the page back as a tab of its window.
  NSWindow *window = host::OpenWindowOf(browser);
  if (!window) return false;
  NSAlert *alert = [[NSAlert alloc] init];
  alert.messageText = @"Leave site?";
  alert.informativeText = @"Changes you made may not be saved.";
  [alert addButtonWithTitle:@"Leave"];
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
  // Chrome's password bubble would hang off its (hidden) toolbar: ours shows instead.
  if (command_id == IDC_MANAGE_PASSWORDS_FOR_PAGE) return chromeui::ShowPasswordPrompt(this, browser);
  return host::BlocksChromeCommand(browser, command_id);
}

}  // namespace nn

@implementation NNCef (ContextMenu)

+ (NSString *)searchEngineName {
  return nn::gSearchEngineName;
}

+ (void)setSearchEngineName:(NSString *)name {
  nn::gSearchEngineName = name.length ? [name copy] : @"Google";
}

@end
