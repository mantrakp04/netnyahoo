#import "NNTabStrip.h"

#import "NNWindowHost.h"

#include <algorithm>
#include <map>
#include <string>
#include <vector>

// Chrome reports a strip through CefLifeSpanHandler::OnTabStripChanged: after every change to a Chrome window's
// TabStripModel it calls it for each of the window's tabs, in strip order, in one synchronous loop
// (ChromeBrowserDelegate::NotifyTabStripChanged, cef-chrome-tabs.patch). One loop is a burst: an index that
// doesn't grow starts the next one. A burst is one strip, whole, and belongs to the Chrome window most of its tabs
// are in as far as the app knows: a tab votes for the window it was last reported in, unless that window has
// reported since without it (it left: a move between windows reports the window it left first). A tab an extension
// moved in is the odd one out, and is in that window from now on.
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
  int index;
  bool active;
  bool pinned;
};

struct Strip {
  NSString *profile = @"";
  int window = 0;
  std::vector<Entry> tabs;
  bool dirty = false;
  bool closed = false;
  NSDictionary *sent = nil;
};

std::map<int, Strip> gStrips;
// The loop being reported.
std::vector<Entry> gBurst;
// browser id → the strip that last reported it.
std::map<int, int> gReportedIn;
// browser id → the app's tab id (the transferKey of the view that showed it).
std::map<int, std::string> gKeys;
NSInteger gCause = kChrome;
NSInteger gHeldCause = kChrome;
NSInteger gRev = 0;
bool gFlushQueued = false;

// The burst is complete: it replaces its strip's tabs.
void EndBurst() {
  if (gBurst.empty()) return;
  std::vector<Entry> tabs;
  tabs.swap(gBurst);
  std::map<int, int> votes;
  for (const Entry &e : tabs) {
    CefRefPtr<CefBrowser> b = CefBrowserHost::GetBrowserByIdentifier(e.browser);
    const int cached = b ? host::StripOf(b) : 0;
    auto last = gReportedIn.find(e.browser);
    auto strip = last != gReportedIn.end() ? gStrips.find(last->second) : gStrips.end();
    const bool left = strip != gStrips.end() && strip->first == cached &&
                      std::none_of(strip->second.tabs.begin(), strip->second.tabs.end(),
                                   [&](const Entry &t) { return t.browser == e.browser; });
    if (cached && !left) votes[cached]++;
  }
  int strip = 0;
  for (auto &[id, n] : votes)
    if (!strip || n > votes[strip]) strip = id;
  NSString *profile = nil;
  int window = 0;
  if (!strip || !host::StripInfo(strip, &profile, &window)) return;
  for (auto &[id, s] : gStrips) {
    if (id == strip) continue;
    // A tab is in one strip: one that moved leaves its old strip, even when nothing is left there to report.
    auto gone = std::remove_if(s.tabs.begin(), s.tabs.end(), [&](const Entry &e) {
      return std::any_of(tabs.begin(), tabs.end(), [&](const Entry &t) { return t.browser == e.browser; });
    });
    if (gone == s.tabs.end()) continue;
    s.tabs.erase(gone, s.tabs.end());
    s.dirty = true;
  }
  for (const Entry &e : tabs) {
    host::NoteStrip(e.browser, strip);
    gReportedIn[e.browser] = strip;
  }
  Strip &s = gStrips[strip];
  s.profile = profile ?: @"";
  s.window = window;
  s.closed = false;
  s.tabs = std::move(tabs);
  s.dirty = true;
}

bool AnyDirty() {
  if (!gBurst.empty()) return true;
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
    }];
  }
  NSMutableDictionary *state =
      [@{@"strip" : @(stripId), @"window" : @(s.window), @"profile" : s.profile ?: @"", @"tabs" : list} mutableCopy];
  if (s.closed) state[@"closed"] = @YES;
  return state;
}

// Sends what changed under the held cause as one transaction. A JS command always gets its transaction (it's
// the command's answer), even when nothing changed.
void Flush(bool answer = false, bool rejected = false) {
  EndBurst();
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
  Hold();
  if (!gBurst.empty() && index <= gBurst.back().index) EndBurst();
  gBurst.push_back({browser->GetIdentifier(), index, active, pinned});
  QueueFlush();
}

void Closed(CefRefPtr<CefBrowser> browser) {
  const int b = browser->GetIdentifier();
  Hold();
  EndBurst();
  for (auto &[id, s] : gStrips) {
    auto gone = std::remove_if(s.tabs.begin(), s.tabs.end(), [&](const Entry &e) { return e.browser == b; });
    if (gone == s.tabs.end()) continue;
    s.tabs.erase(gone, s.tabs.end());
    s.dirty = true;
  }
  gKeys.erase(b);
  gReportedIn.erase(b);
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
  EndBurst();
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
