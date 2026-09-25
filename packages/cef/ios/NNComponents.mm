// Chromium's component updater (Widevine CDM and friends): their status, for Settings › Advanced.
#import "NNCefInternal.h"

#include "include/cef_component_updater.h"

using namespace nn;

namespace {

NSString *StateName(cef_component_state_t state) {
  static NSString *const kNames[] = {@"new", @"checking", @"canUpdate", @"downloading", @"decompressing", @"patching",
                                     @"updating", @"updated", @"upToDate", @"updateError", @"run"};
  return state >= 0 && state <= CEF_COMPONENT_STATE_RUN ? kNames[state] : @"unknown";
}

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

@end
