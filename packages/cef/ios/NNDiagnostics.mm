// Engine diagnostics: performance traces (Help › Record Performance Issue) and
// Chromium's task manager (Window › Task Manager).
#import "NNCefInternal.h"

#include "include/cef_task_manager.h"
#include "include/cef_trace.h"

using namespace nn;

namespace {

class TracingStarted : public CefCompletionCallback {
 public:
  explicit TracingStarted(void (^block)(void)) : block_([block copy]) {}
  void OnComplete() override { block_(); }

 private:
  void (^block_)(void);
  IMPLEMENT_REFCOUNTING(TracingStarted);
};

class TracingEnded : public CefEndTracingCallback {
 public:
  explicit TracingEnded(void (^block)(NSString *)) : block_([block copy]) {}
  void OnEndTracingComplete(const CefString &tracing_file) override {
    NSString *path = ToNS(tracing_file);
    auto block = block_;
    dispatch_async(dispatch_get_main_queue(), ^{ block(path); });
  }

 private:
  void (^block_)(NSString *);
  IMPLEMENT_REFCOUNTING(TracingEnded);
};

bool gTracing = false;

NSString *DownloadsFolder() {
  if (const char *dir = getenv("NETNYAHOO_DOWNLOADS_DIR")) return @(dir);
  return [NSFileManager.defaultManager URLsForDirectory:NSDownloadsDirectory inDomains:NSUserDomainMask].firstObject.path;
}

NSString *TaskTypeName(cef_task_type_t type) {
  switch (type) {
    case CEF_TASK_TYPE_BROWSER: return @"browser";
    case CEF_TASK_TYPE_GPU: return @"gpu";
    case CEF_TASK_TYPE_ZYGOTE: return @"zygote";
    case CEF_TASK_TYPE_UTILITY: return @"utility";
    case CEF_TASK_TYPE_RENDERER: return @"renderer";
    case CEF_TASK_TYPE_EXTENSION: return @"extension";
    case CEF_TASK_TYPE_GUEST: return @"guest";
    case CEF_TASK_TYPE_PLUGIN_DEPRECATED: return @"plugin";
    case CEF_TASK_TYPE_SANDBOX_HELPER: return @"sandboxHelper";
    case CEF_TASK_TYPE_DEDICATED_WORKER: return @"dedicatedWorker";
    case CEF_TASK_TYPE_SHARED_WORKER: return @"sharedWorker";
    case CEF_TASK_TYPE_SERVICE_WORKER: return @"serviceWorker";
    default: return @"unknown";
  }
}

// Each CefTaskManager handle observes Chromium's task manager while it lives:
// dropping it resets task ids and samples. Keep one while someone polls, and
// let it go (sampling costs CPU) after a quiet period.
CefRefPtr<CefTaskManager> gTaskManager;
NSTimer *gTaskManagerIdle;

CefRefPtr<CefTaskManager> TaskManager() {
  if (!gTaskManager) gTaskManager = CefTaskManager::GetTaskManager();
  [gTaskManagerIdle invalidate];
  gTaskManagerIdle = [NSTimer scheduledTimerWithTimeInterval:15
                                                     repeats:NO
                                                       block:^(NSTimer *) {
                                                         gTaskManager = nullptr;
                                                         gTaskManagerIdle = nil;
                                                       }];
  return gTaskManager;
}

}  // namespace

void nn::ReleaseDiagnostics() {
  [gTaskManagerIdle invalidate];
  gTaskManagerIdle = nil;
  gTaskManager = nullptr;
}

@implementation NNCef (Diagnostics)

+ (void)beginTracing:(void (^)(BOOL))completion {
  if (gTracing) {
    completion(NO);
    return;
  }
  // Chrome's default categories (what chrome://tracing records) plus our own.
  bool ok = CefBeginTracing("", new TracingStarted(^{
                              dispatch_async(dispatch_get_main_queue(), ^{ completion(YES); });
                            }));
  gTracing = ok;
  if (!ok) completion(NO);
}

+ (void)endTracing:(BOOL)keep completion:(void (^)(NSString *))completion {
  if (!gTracing) {
    completion(nil);
    return;
  }
  gTracing = false;
  NSDateFormatter *f = [NSDateFormatter new];
  f.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  f.dateFormat = @"yyyy-MM-dd 'at' HH.mm.ss";
  NSString *folder = keep ? DownloadsFolder() : NSTemporaryDirectory();
  [NSFileManager.defaultManager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *path = [folder stringByAppendingPathComponent:[NSString stringWithFormat:@"Netnyahoo Trace %@.json",
                                                                                     [f stringFromDate:NSDate.date]]];
  // Tracing can't be stopped without writing: discarding writes to a temp file and deletes it.
  bool ok = CefEndTracing(ToCef(path), new TracingEnded(^(NSString *written) {
                            if (keep) {
                              completion(written.length ? written : nil);
                            } else {
                              [NSFileManager.defaultManager removeItemAtPath:written error:nil];
                              completion(nil);
                            }
                          }));
  if (!ok) completion(nil);
}

+ (BOOL)isTracing {
  return gTracing;
}

+ (NSArray<NSDictionary *> *)tasks {
  CefRefPtr<CefTaskManager> manager = TaskManager();
  if (!manager) return @[];
  // Browser id for each task that hosts one of our browsers (a renderer shared
  // by several tabs lists them all).
  NSMutableDictionary<NSNumber *, NSMutableArray *> *browsersByTask = [NSMutableDictionary dictionary];
  for (NNBrowserView *view in LiveViews()) {
    int bid = view.browserId;
    int64_t task = bid ? manager->GetTaskIdForBrowserId(bid) : -1;
    if (task < 0) continue;
    NSMutableArray *ids = browsersByTask[@(task)] ?: (browsersByTask[@(task)] = [NSMutableArray array]);
    [ids addObject:@(bid)];
  }
  CefTaskManager::TaskIdList ids;
  if (!manager->GetTaskIdsList(ids)) return @[];
  NSMutableArray *out = [NSMutableArray arrayWithCapacity:ids.size()];
  for (int64_t tid : ids) {
    CefTaskInfo info;
    if (!manager->GetTaskInfo(tid, info)) continue;
    [out addObject:@{
      @"id" : @(tid),
      @"type" : TaskTypeName(info.type),
      @"title" : ToNS(CefString(&info.title)),
      @"killable" : @(info.is_killable != 0),
      // Percent of one core (Chrome's task manager column), or -1 before the first sample.
      @"cpu" : @(info.cpu_usage),
      @"processors" : @(info.number_of_processors),
      @"memory" : @(info.memory),
      @"gpuMemory" : @(info.gpu_memory),
      @"browserIds" : browsersByTask[@(tid)] ?: @[],
    }];
  }
  return out;
}

+ (BOOL)killTask:(int64_t)taskId {
  CefRefPtr<CefTaskManager> manager = TaskManager();
  return manager && manager->KillTask(taskId);
}

@end
