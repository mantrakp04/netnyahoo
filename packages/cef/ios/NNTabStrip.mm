#import "NNTabStrip.h"

#import "NNEngine.h"
#import "NNWindowHost.h"

#include <map>
#include <set>
#include <string>
#include <vector>

// The engine layer's own strip reports (nn_tabs, //chrome/browser/netnyahoo) are the strips: after every change to
// a Browser's TabStripModel, synchronously, its tabs (Chrome's tab ids, order, active, pinned, group), its groups,
// and whether Chrome picked the active tab because the active one left. They name the Browser, so a strip's window
// is never inferred from its tabs. CEF's own report (CefLifeSpanHandler::OnTabStripChanged) only tells this file
// which browser each Chrome tab id is.
//
// Causes: a JS command (its id), the app's own engine call (kApp), or Chrome (kChrome). Changes are held until
// their cause ends: a command or app call flushes on return, Chrome's changes at the end of the main-thread task.
// A report under another cause flushes what's held first, so a transaction never mixes causes, and a command
// flushes Chrome's pending changes before it runs, so they're never taken for its own.

namespace nn::strip {
namespace {

constexpr NSInteger kChrome = 0;
constexpr NSInteger kApp = -1;

struct Entry {
  int browser;
  bool active;
  bool pinned;
  std::string group;  // Chrome's group token, "" for none
};

struct Strip {
  NSString *profile = @"";
  int window = 0;
  NSString *appWindow = nil;
  int chromeWindow = 0;
  std::vector<Entry> tabs;
  NSArray *groups = @[];
  NSNumber *pickedOnClose = nil;  // absent from engines that don't say
  bool dirty = false;
  bool closed = false;
  NSDictionary *sent = nil;
};

// Strips by the app's id for them (the Chrome window's, NNWindowHost), and Chrome's window id → that id, learnt
// the first time the engine reports the window (when it holds the tab it was made with) and kept for its life.
std::map<int, Strip> gStrips;
std::map<int, int> gStripOfChromeWindow;
// The engine's latest report of each Chrome window not yet applied.
std::map<int, NSDictionary *> gReports;
// browser id → Chrome's tab id, and → the app's tab id (the transferKey of the view that showed it).
std::map<int, int> gTabIds;
std::map<int, std::string> gKeys;
bool gWatching = false;
NSInteger gCause = kChrome;
NSInteger gHeldCause = kChrome;
NSInteger gRev = 0;
bool gFlushQueued = false;

int StripFor(int chromeWindow, const std::vector<Entry> &tabs) {
  auto known = gStripOfChromeWindow.find(chromeWindow);
  if (known != gStripOfChromeWindow.end()) return known->second;
  std::map<int, int> votes;
  for (const Entry &e : tabs)
    if (CefRefPtr<CefBrowser> b = CefBrowserHost::GetBrowserByIdentifier(e.browser))
      if (int strip = host::StripOf(b)) votes[strip]++;
  int strip = 0;
  for (auto &[id, n] : votes)
    if (!strip || n > votes[strip]) strip = id;
  if (strip) gStripOfChromeWindow[chromeWindow] = strip;
  return strip;
}

// Applies the engine's reports: Chrome's tab ids become browsers (CEF reported them in the same change).
void ApplyReports() {
  std::map<int, int> browserOf;
  for (auto &[browser, tab] : gTabIds) browserOf[tab] = browser;
  for (auto it = gReports.begin(); it != gReports.end();) {
    NSDictionary *report = it->second;
    const int chromeWindow = it->first;
    std::vector<Entry> tabs;
    for (NSDictionary *tab in report[@"tabs"]) {
      auto b = browserOf.find([tab[@"tab"] intValue]);
      if (b == browserOf.end()) continue;
      id group = tab[@"group"];
      tabs.push_back({b->second, [tab[@"active"] boolValue], [tab[@"pinned"] boolValue],
                      [group isKindOfClass:NSString.class] ? std::string([group UTF8String]) : std::string()});
    }
    const int id = StripFor(chromeWindow, tabs);
    NSString *profile = nil, *appWindow = nil;
    int window = 0;
    if (!id || !host::StripInfo(id, &profile, &window, &appWindow)) {
      // Not one of ours (yet): an empty new window waits for its first tab.
      it = tabs.empty() ? std::next(it) : gReports.erase(it);
      continue;
    }
    Strip &s = gStrips[id];
    s.profile = profile ?: @"";
    s.window = window;
    s.appWindow = appWindow;
    s.chromeWindow = chromeWindow;
    s.tabs = std::move(tabs);
    s.groups = [report[@"groups"] isKindOfClass:NSArray.class] ? report[@"groups"] : @[];
    s.pickedOnClose = [report[@"activePickedOnClose"] isKindOfClass:NSNumber.class] ? report[@"activePickedOnClose"] : nil;
    s.closed = false;
    s.dirty = true;
    for (const Entry &e : s.tabs) host::NoteStrip(e.browser, id);
    it = gReports.erase(it);
  }
}

bool AnyDirty() {
  if (!gReports.empty()) return true;
  for (auto &[id, s] : gStrips)
    if (s.dirty) return true;
  return false;
}

NSDictionary *StateOf(int stripId, const Strip &s) {
  NSMutableArray *list = [NSMutableArray arrayWithCapacity:s.tabs.size()];
  int index = 0;
  for (const Entry &e : s.tabs) {
    auto key = gKeys.find(e.browser);
    [list addObject:@{
      @"key" : key != gKeys.end() ? (id)@(key->second.c_str()) : (id)[NSNull null],
      @"browser" : @(e.browser),
      @"index" : @(index++),
      @"active" : @(e.active),
      @"pinned" : @(e.pinned),
      @"group" : e.group.empty() ? (id)[NSNull null] : (id)@(e.group.c_str()),
    }];
  }
  NSMutableDictionary *state = [@{
    @"strip" : @(stripId),
    @"window" : @(s.window),
    @"profile" : s.profile ?: @"",
    @"tabs" : list,
    @"groups" : s.groups ?: @[],
  } mutableCopy];
  if (s.pickedOnClose) state[@"activePickedOnClose"] = s.pickedOnClose;
  if (s.appWindow) state[@"appWindow"] = s.appWindow;
  if (s.closed) state[@"closed"] = @YES;
  return state;
}

// Sends what changed under the held cause as one transaction. A JS command always gets its transaction (it's
// the command's answer), even when nothing changed.
void Flush(bool answer = false, bool rejected = false) {
  ApplyReports();
  const NSInteger cause = gHeldCause;
  NSMutableArray *strips = [NSMutableArray array];
  for (auto it = gStrips.begin(); it != gStrips.end();) {
    Strip &s = it->second;
    if (s.dirty) {
      s.dirty = false;
      NSDictionary *state = StateOf(it->first, s);
      if (![state isEqualToDictionary:s.sent]) {
        s.sent = state;
        [strips addObject:state];
      }
    }
    it = s.closed ? gStrips.erase(it) : std::next(it);
  }
  if (!strips.count && !answer) return;
  NSMutableDictionary *tx = [@{
    @"rev" : @(++gRev),
    @"cmd" : cause == kChrome ? (id)[NSNull null] : (id)@(cause),
    @"strips" : strips,
  } mutableCopy];
  if (rejected) tx[@"rejected"] = @YES;
  EmitGlobal(@"tabStrip", tx);
}

void QueueFlush() {
  if (gCause != kChrome || gFlushQueued) return;
  gFlushQueued = true;
  dispatch_async(dispatch_get_main_queue(), ^{
    gFlushQueued = false;
    if (gCause == kChrome && gHeldCause == kChrome) Flush();
  });
}

// Before recording a change: what's held under another cause goes out first.
void Hold() {
  if (gHeldCause != gCause && AnyDirty()) Flush();
  gHeldCause = gCause;
}

void EngineReport(NSDictionary *report) {
  const int chromeWindow = [report[@"window"] intValue];
  if ([report[@"closed"] boolValue]) {
    gReports.erase(chromeWindow);
    auto strip = gStripOfChromeWindow.find(chromeWindow);
    if (strip != gStripOfChromeWindow.end()) {
      WindowClosed(strip->second);
      gStripOfChromeWindow.erase(strip);
    }
    return;
  }
  Hold();
  gReports[chromeWindow] = report;
  QueueFlush();
}

void Watch() {
  if (gWatching) return;
  gWatching = true;
  engine::Observe(@"tabs.strip", ^(NSDictionary *report) { EngineReport(report); });
  engine::Call("nn_tabs_watch", @"", nil, ^(NSDictionary *) {});
}

class Scope {
 public:
  explicit Scope(NSInteger cause) : saved_(gCause) {
    if (AnyDirty()) Flush();
    gCause = gHeldCause = cause;
  }
  ~Scope() {
    Flush(answer_, rejected_);
    gCause = gHeldCause = saved_;
  }
  void Answer(bool rejected) {
    answer_ = true;
    rejected_ = rejected;
  }

 private:
  NSInteger saved_;
  bool answer_ = false;
  bool rejected_ = false;
};

CefRefPtr<CefBrowser> BrowserFor(NSString *key, int strip) {
  if (!key.length) return nullptr;
  ApplyReports();
  const std::string k = key.UTF8String;
  auto s = gStrips.find(strip);
  if (s == gStrips.end()) return nullptr;
  for (const Entry &e : s->second.tabs) {
    auto bound = gKeys.find(e.browser);
    if (bound != gKeys.end() && bound->second == k) return CefBrowserHost::GetBrowserByIdentifier(e.browser);
  }
  return nullptr;
}

}

void Report(CefRefPtr<CefBrowser> browser, int index, bool active, bool pinned) {
  if (!host::StripOf(browser)) return;
  if (!gTabIds.count(browser->GetIdentifier())) gTabIds[browser->GetIdentifier()] = host::TabId(browser);
  Watch();
}

void Closed(CefRefPtr<CefBrowser> browser) {
  const int b = browser->GetIdentifier();
  Hold();
  ApplyReports();
  for (auto &[id, s] : gStrips) {
    const size_t before = s.tabs.size();
    std::erase_if(s.tabs, [&](const Entry &e) { return e.browser == b; });
    if (s.tabs.size() != before) s.dirty = true;
  }
  gKeys.erase(b);
  gTabIds.erase(b);
  QueueFlush();
}

void Bind(CefRefPtr<CefBrowser> browser, NSString *key) {
  if (!browser || !key.length) return;
  const int b = browser->GetIdentifier();
  const std::string k = key.UTF8String;
  auto it = gKeys.find(b);
  if (it != gKeys.end() && it->second == k) return;
  Hold();
  gKeys[b] = k;
  for (auto &[id, s] : gStrips)
    for (const Entry &e : s.tabs)
      if (e.browser == b) s.dirty = true;
  QueueFlush();
}

void WindowClosed(int strip) {
  auto it = gStrips.find(strip);
  if (it == gStrips.end()) return;
  Hold();
  it->second.tabs.clear();
  it->second.closed = true;
  it->second.dirty = true;
  QueueFlush();
}

void AsApp(void (^block)(void)) {
  if (gCause != kChrome) return block();
  Scope scope(kApp);
  block();
}

bool InCommand() { return gCause != kChrome; }

void RunCommand(NSInteger cmd, NSDictionary *command) {
  Scope scope(cmd);
  NSString *op = command[@"op"];
  const int strip = [command[@"strip"] intValue];
  if ([op isEqualToString:@"activate"]) {
    CefRefPtr<CefBrowser> browser = BrowserFor(command[@"key"], strip);
    if (browser) browser->GetHost()->ActivateTab();
    return scope.Answer(!browser);
  }
  if ([op isEqualToString:@"arrange"]) {
    NSArray<NSString *> *keys = command[@"keys"];
    const NSInteger pinned = [command[@"pinned"] integerValue];
    // Only the listed tabs still in that strip: one an extension took to another window meanwhile stays there.
    std::vector<std::pair<CefRefPtr<CefBrowser>, bool>> tabs;
    for (NSUInteger i = 0; i < keys.count; i++)
      if (CefRefPtr<CefBrowser> b = BrowserFor(keys[i], strip)) tabs.push_back({b, (NSInteger)i < pinned});
    for (auto &[b, pin] : tabs) b->GetHost()->SetTabPinned(pin);
    for (size_t i = 0; i < tabs.size(); i++) tabs[i].first->GetHost()->SetTabIndex((int)i);
    return scope.Answer(tabs.empty());
  }
  if ([op isEqualToString:@"group"]) {
    // Into a group of Chrome's ("new" makes one; null takes the tabs out of theirs), with its look when given.
    auto s = gStrips.find(strip);
    NSMutableArray *tabs = [NSMutableArray array];
    for (NSString *key in command[@"keys"])
      if (CefRefPtr<CefBrowser> b = BrowserFor(key, strip)) [tabs addObject:@(host::TabId(b))];
    if (s == gStrips.end() || !s->second.chromeWindow || !tabs.count) return scope.Answer(true);
    NSMutableDictionary *args = [@{@"window" : @(s->second.chromeWindow), @"tabs" : tabs} mutableCopy];
    id group = command[@"group"];
    args[@"group"] = [group isKindOfClass:NSString.class] ? group : @"";
    for (NSString *field in @[ @"title", @"color", @"collapsed" ])
      if (command[field] && command[field] != NSNull.null) args[field] = command[field];
    __block bool done = false;
    engine::Call("nn_tabs_group", s->second.profile, args, ^(NSDictionary *result) { done = !result[@"error"]; });
    return scope.Answer(!done);
  }
  scope.Answer(true);
}

NSDictionary *Snapshot() {
  if (AnyDirty() && gCause == kChrome) Flush();
  NSMutableArray *strips = [NSMutableArray array];
  for (auto &[id, s] : gStrips) [strips addObject:StateOf(id, s)];
  return @{@"rev" : @(gRev), @"cmd" : [NSNull null], @"strips" : strips};
}

}

@implementation NNCef (TabStrip)

+ (void)tabStripCommand:(NSInteger)cmd command:(NSDictionary *)command {
  if (cmd > 0) nn::strip::RunCommand(cmd, command);
}

+ (NSDictionary *)tabStrips {
  return nn::strip::Snapshot();
}

@end
