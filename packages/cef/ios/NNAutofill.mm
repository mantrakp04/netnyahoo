#import "NNEngine.h"

using namespace nn;

namespace {

CefRefPtr<CefRequestContext> Context(NSString *profile) { return ContextForProfile(DataProfile(profile)); }

bool BoolPreference(NSString *profile, const char *name) {
  CefRefPtr<CefValue> value = Context(profile)->GetPreference(name);
  return !value || value->GetType() != VTYPE_BOOL || value->GetBool();
}

void SetBoolPreference(NSString *profile, const char *name, bool on) {
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetBool(on);
  CefString error;
  if (!Context(profile)->SetPreference(name, value, error)) NSLog(@"[autofill] %s: %@", name, ToNS(error));
}

// The app's created/modified fields, which Chrome's settings never filled either.
NNResultCompletion Dated(NSString *key, NNResultCompletion completion) {
  return ^(NSDictionary *result) {
    NSArray *list = result[key];
    if (![list isKindOfClass:NSArray.class]) return completion(result);
    NSMutableArray *dated = [NSMutableArray array];
    for (NSDictionary *entry in list) {
      NSMutableDictionary *item = [entry mutableCopy];
      item[@"created"] = @0;
      item[@"modified"] = @0;
      [dated addObject:item];
    }
    completion(@{key : dated});
  };
}

}

@implementation NNAutofill

+ (NSDictionary<NSString *, NSNumber *> *)settingsForProfile:(NSString *)profile {
  return @{
    @"addresses" : @(BoolPreference(profile, "autofill.profile_enabled")),
    @"cards" : @(BoolPreference(profile, "autofill.credit_card_enabled")),
  };
}

+ (void)setSettings:(NSDictionary<NSString *, NSNumber *> *)settings profile:(NSString *)profile {
  if (settings[@"addresses"]) SetBoolPreference(profile, "autofill.profile_enabled", settings[@"addresses"].boolValue);
  if (settings[@"cards"]) SetBoolPreference(profile, "autofill.credit_card_enabled", settings[@"cards"].boolValue);
}

+ (void)addressesForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  engine::Call("nn_autofill_addresses", profile, nil, Dated(@"addresses", completion));
}

+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSMutableDictionary *fields = [NSMutableDictionary dictionary];
  for (NSString *key in address)
    if ([address[key] isKindOfClass:NSString.class] || [address[key] isKindOfClass:NSNumber.class])
      fields[key] = [address[key] description];
  engine::Call("nn_autofill_save_address", profile, @{@"address" : fields}, completion);
}

+ (void)cardsForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  engine::Call("nn_autofill_cards", profile, nil, Dated(@"cards", completion));
}

+ (void)saveCard:(NSDictionary<NSString *, id> *)card
          number:(NSString *)number
         profile:(NSString *)profile
      completion:(NNResultCompletion)completion {
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:card ?: @{} forKey:@"card"];
  if (number) args[@"number"] = number;
  engine::Call("nn_autofill_save_card", profile, args, completion);
}

+ (void)deleteEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNResultCompletion)completion {
  engine::Call("nn_autofill_remove", profile, @{@"id" : entryId ?: @""}, completion);
}

// The engine asks for Chrome's OS reauth first (logged, not shown, in a hidden test instance).
+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNResultCompletion)completion {
  engine::Call("nn_autofill_card_number", profile, @{@"id" : cardId ?: @""}, ^(NSDictionary *result) {
    completion([result[@"number"] isKindOfClass:NSString.class] ? @{@"number" : result[@"number"]} : @{});
  });
}

+ (void)clearFormDataAndSiteSettingsForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  engine::Call("nn_browsing_data_clear", profile, @{@"types" : @[ @"formData", @"siteSettings" ]}, completion);
}

@end
