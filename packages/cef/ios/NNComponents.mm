// Chromium's component updater (Widevine CDM and friends): status and on-demand updates.
#import "NNCefInternal.h"

#include "include/cef_component_updater.h"

using namespace nn;

namespace {

NSString *StateName(cef_component_state_t state) {
  static NSString *const kNames[] = {@"new", @"checking", @"canUpdate", @"downloading", @"decompressing", @"patching",
                                     @"updating", @"updated", @"upToDate", @"updateError", @"run"};
  return state >= 0 && state <= CEF_COMPONENT_STATE_RUN ? kNames[state] : @"unknown";
}

NSString *ErrorName(cef_component_update_error_t error) {
  static NSString *const kNames[] = {nil, @"inProgress", @"canceled", @"retryLater", @"serviceError",
                                     @"updateCheckError", @"notFound", @"invalidArgument", @"badData"};
  return error > 0 && error <= CEF_COMPONENT_UPDATE_ERROR_BAD_CRX_DATA_CALLBACK ? kNames[error] : nil;
}

class UpdateDone : public CefComponentUpdateCallback {
 public:
  explicit UpdateDone(void (^block)(NSDictionary *)) : block_([block copy]) {}
  void OnComplete(const CefString &component_id, cef_component_update_error_t error) override {
    NSString *name = ErrorName(error);
    block_(@{@"id" : ToNS(component_id), @"error" : name ?: [NSNull null]});
  }

 private:
  void (^block_)(NSDictionary *);
  IMPLEMENT_REFCOUNTING(UpdateDone);
};

}  // namespace

@implementation NNCef (Components)

+ (NSArray<NSDictionary *> *)components {
  CefRefPtr<CefComponentUpdater> updater = CefComponentUpdater::GetComponentUpdater();
  if (!updater) return @[];
  std::vector<CefRefPtr<CefComponent>> components;
  updater->GetComponents(components);
  NSMutableArray *out = [NSMutableArray array];
  for (auto &c : components) {
    [out addObject:@{
      @"id" : ToNS(c->GetID()),
      @"name" : ToNS(c->GetName()),
      @"version" : ToNS(c->GetVersion()),
      @"state" : StateName(c->GetState()),
    }];
  }
  return out;
}

+ (void)updateComponent:(NSString *)componentId completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  CefRefPtr<CefComponentUpdater> updater = CefComponentUpdater::GetComponentUpdater();
  if (!updater) {
    completion(@{@"id" : componentId, @"error" : @"serviceError"});
    return;
  }
  updater->Update(ToCef(componentId), CEF_COMPONENT_UPDATE_PRIORITY_FOREGROUND, new UpdateDone(completion));
}

@end
