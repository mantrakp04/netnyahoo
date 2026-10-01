#import "NNEngine.h"

#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

using namespace nn;

namespace {

// //chrome/browser/netnyahoo/nn_passwords.h, answered as the JS API expects (errors as {error}).
void Run(const char *name, NSString *profile, NSDictionary *args, NNResultCompletion completion) {
  engine::Call(name, profile, args, completion);
}

NSDictionary *Login(NSString *origin, NSString *username) { return @{@"origin" : OriginOf(origin) ?: origin, @"username" : username ?: @""}; }

CefRefPtr<CefRequestContext> Context(NSString *profile) { return ContextForProfile(DataProfile(profile)); }

}

@implementation NNPasswords

+ (BOOL)autofillEnabledForProfile:(NSString *)profile {
  CefRefPtr<CefValue> value = Context(profile)->GetPreference("credentials_enable_service");
  return !value || value->GetType() != VTYPE_BOOL || value->GetBool();
}

+ (void)setAutofillEnabled:(BOOL)enabled profile:(NSString *)profile {
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetBool(enabled);
  CefString error;
  if (!Context(profile)->SetPreference("credentials_enable_service", value, error))
    NSLog(@"[passwords] credentials_enable_service: %@", ToNS(error));
}

+ (void)listForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  Run("nn_passwords_list", profile, nil, ^(NSDictionary *result) {
    NSArray *list = result[@"passwords"];
    if (![list isKindOfClass:NSArray.class]) return completion(result);
    NSMutableArray *passwords = [NSMutableArray array];
    for (NSDictionary *entry in list)
      [passwords addObject:@{@"origin" : entry[@"origin"] ?: @"", @"username" : entry[@"username"] ?: @"", @"created" : @0, @"modified" : @0}];
    completion(@{@"passwords" : passwords});
  });
}

+ (void)unlockForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  Run("nn_passwords_unlock", profile, nil, completion);
}

+ (void)passwordForProfile:(NSString *)profile
                    origin:(NSString *)origin
                  username:(NSString *)username
                completion:(NNResultCompletion)completion {
  Run("nn_passwords_reveal", profile, Login(origin, username), completion);
}

+ (void)saveForProfile:(NSString *)profile
                origin:(NSString *)origin
              username:(NSString *)username
              password:(NSString *)password
            completion:(NNResultCompletion)completion {
  NSMutableDictionary *args = [Login(origin, username) mutableCopy];
  args[@"password"] = password ?: @"";
  Run("nn_passwords_add", profile, args, completion);
}

+ (void)updateForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
             newUsername:(NSString *)newUsername
             newPassword:(NSString *)newPassword
              completion:(NNResultCompletion)completion {
  NSMutableDictionary *args = [Login(origin, username) mutableCopy];
  if (newUsername) args[@"newUsername"] = newUsername;
  if (newPassword) args[@"newPassword"] = newPassword;
  Run("nn_passwords_update", profile, args, completion);
}

+ (void)deleteForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
              completion:(NNResultCompletion)completion {
  Run("nn_passwords_remove", profile, Login(origin, username), completion);
}

+ (void)neverSaveOriginsForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  Run("nn_passwords_exceptions", profile, nil, completion);
}

+ (void)allowSavingForProfile:(NSString *)profile origin:(NSString *)origin completion:(NNResultCompletion)completion {
  Run("nn_passwords_allow", profile, @{@"origin" : OriginOf(origin) ?: origin}, completion);
}

// Chrome's export: where to save first, then the OS reauth (every time) and Chrome's exporter.
+ (void)exportForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.nameFieldStringValue = @"Netnyahoo Passwords.csv";
  panel.allowedContentTypes = @[ UTTypeCommaSeparatedText ];
  panel.canCreateDirectories = YES;
  panel.message = @"Anyone who can open this file can read your passwords.";
  [panel beginWithCompletionHandler:^(NSModalResponse response) {
    NSString *path = response == NSModalResponseOK ? panel.URL.path : nil;
    if (!path) return completion(@{@"status" : @"cancelled"});
    Run("nn_passwords_export", profile, @{@"path" : path}, ^(NSDictionary *result) {
      NSMutableDictionary *answer = [result mutableCopy];
      if ([result[@"status"] isEqual:@"succeeded"]) answer[@"path"] = path;
      completion(answer);
    });
  }];
}

@end
