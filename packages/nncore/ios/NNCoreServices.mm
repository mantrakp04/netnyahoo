#import "NNCoreServices.h"

#import "NNCoreEngineBridge.h"
#import "NNCoreInternal.h"
#import "NNExtensionPackage.h"

#include <cmath>

namespace {

NSDictionary *Parse(NSString *json) {
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  id value = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  return [value isKindOfClass:NSDictionary.class] ? value : @{@"error" : @"bad reply from the engine"};
}

NSString *JSON(NSDictionary *value) {
  NSData *data = value ? [NSJSONSerialization dataWithJSONObject:value options:0 error:nil] : nil;
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
}

// The origin the engine keys logins by (scheme://host[:port]), as packages/cef's OriginOf.
NSString *OriginOf(NSString *url) {
  NSURLComponents *c = [NSURLComponents componentsWithString:url ?: @""];
  if (!c.scheme.length || !c.host.length) return url ?: @"";
  return c.port ? [NSString stringWithFormat:@"%@://%@:%@", c.scheme, c.host, c.port] : [NSString stringWithFormat:@"%@://%@", c.scheme, c.host];
}

NSDictionary *Login(NSString *origin, NSString *username) {
  return @{@"origin" : OriginOf(origin), @"username" : username ?: @""};
}

// The app's created/modified fields, which Chrome's settings never filled either.
NNCoreResult Dated(NSString *key, NNCoreResult completion) {
  return ^(NSDictionary *result) {
    NSArray *list = result[key];
    if (![list isKindOfClass:NSArray.class]) return completion(result);
    NSMutableArray *dated = [NSMutableArray array];
    for (NSDictionary *entry in list) {
      if (![entry isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *item = [entry mutableCopy];
      item[@"created"] = @0;
      item[@"modified"] = @0;
      [dated addObject:item];
    }
    completion(@{key : dated});
  };
}

void (^gExtensionsHandler)(NSString *, NSDictionary *);

void Changed(NSString *profile, NSString *extensionId, NSString *event) {
  if (gExtensionsHandler && extensionId.length)
    gExtensionsHandler(@"changed", @{@"profile" : nncore_host::IsIncognito(profile) ? @"" : (profile ?: @""), @"id" : extensionId, @"event" : event});
}

NSString *ProfileDirectory(NSString *profile) {
  NSString *dir = profile.length && !nncore_host::IsIncognito(profile) ? [@"Profile " stringByAppendingString:profile] : @"Default";
  return [NNCoreHost.dataDirectory stringByAppendingPathComponent:dir];
}

// Where Chrome unpacked a store extension: <profile>/Extensions/<id>/<version>_<n>.
NSString *StoreFolder(NSString *profile, NSString *extensionId, id version) {
  if (!nn::ext::IsExtensionId(extensionId) || ![version isKindOfClass:NSString.class] || ![version length]) return nil;
  NSString *dir = [[ProfileDirectory(profile) stringByAppendingPathComponent:@"Extensions"] stringByAppendingPathComponent:extensionId];
  NSString *prefix = [version stringByAppendingString:@"_"];
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil])
    if ([name hasPrefix:prefix]) return [dir stringByAppendingPathComponent:name];
  return nil;
}

}  // namespace

@implementation NNCoreServices

+ (void)call:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args completion:(NNCoreResult)completion {
  [NNCoreEngineBridge call:name profile:profile args:JSON(args) completion:^(NSString *json) { completion(Parse(json)); }];
}

// MARK: Passwords

+ (void)listPasswords:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_list" profile:profile args:nil completion:^(NSDictionary *result) {
    NSArray *list = result[@"passwords"];
    if (![list isKindOfClass:NSArray.class]) return completion(result);
    NSMutableArray *passwords = [NSMutableArray array];
    for (NSDictionary *entry in list)
      [passwords addObject:@{@"origin" : entry[@"origin"] ?: @"", @"username" : entry[@"username"] ?: @"", @"created" : @0, @"modified" : @0}];
    completion(@{@"passwords" : passwords});
  }];
}

+ (void)unlockPasswords:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_unlock" profile:profile args:nil completion:completion];
}

+ (void)password:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_reveal" profile:profile args:Login(origin, username) completion:completion];
}

+ (void)savePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username password:(NSString *)password
          completion:(NNCoreResult)completion {
  NSMutableDictionary *args = [Login(origin, username) mutableCopy];
  args[@"password"] = password ?: @"";
  [self call:@"nn_passwords_add" profile:profile args:args completion:completion];
}

+ (void)updatePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username
           newUsername:(NSString *)newUsername newPassword:(NSString *)newPassword completion:(NNCoreResult)completion {
  NSMutableDictionary *args = [Login(origin, username) mutableCopy];
  if (newUsername) args[@"newUsername"] = newUsername;
  if (newPassword) args[@"newPassword"] = newPassword;
  [self call:@"nn_passwords_update" profile:profile args:args completion:completion];
}

+ (void)deletePassword:(NSString *)profile origin:(NSString *)origin username:(NSString *)username completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_remove" profile:profile args:Login(origin, username) completion:completion];
}

+ (void)neverSaveOrigins:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_exceptions" profile:profile args:nil completion:completion];
}

+ (void)allowSaving:(NSString *)profile origin:(NSString *)origin completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_allow" profile:profile args:@{@"origin" : OriginOf(origin)} completion:completion];
}

+ (void)exportPasswords:(NSString *)profile path:(NSString *)path completion:(NNCoreResult)completion {
  [self call:@"nn_passwords_export" profile:profile args:@{@"path" : path ?: @""} completion:completion];
}

// MARK: Preferences

+ (BOOL)boolPreference:(NSString *)name profile:(NSString *)profile {
  NNCoreProfile *p = nncore_host::LoadedProfile(nncore_host::IsIncognito(profile) ? @"" : profile);
  if (![p respondsToSelector:@selector(boolPreference:)]) return YES;
  NSNumber *value = [p boolPreference:name];
  return value ? value.boolValue : YES;
}

+ (void)setBoolPreference:(NSString *)name value:(BOOL)value profile:(NSString *)profile {
  NNCoreProfile *p = nncore_host::LoadedProfile(nncore_host::IsIncognito(profile) ? @"" : profile);
  if ([p respondsToSelector:@selector(setBoolPreference:value:)]) [p setBoolPreference:name value:value];
}

// MARK: Autofill

+ (void)addresses:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_autofill_addresses" profile:profile args:nil completion:Dated(@"addresses", completion)];
}

+ (void)saveAddress:(NSDictionary *)address profile:(NSString *)profile completion:(NNCoreResult)completion {
  NSMutableDictionary *fields = [NSMutableDictionary dictionary];
  for (NSString *key in address)
    if ([address[key] isKindOfClass:NSString.class] || [address[key] isKindOfClass:NSNumber.class]) fields[key] = [address[key] description];
  [self call:@"nn_autofill_save_address" profile:profile args:@{@"address" : fields} completion:completion];
}

+ (void)cards:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_autofill_cards" profile:profile args:nil completion:Dated(@"cards", completion)];
}

+ (void)saveCard:(NSDictionary *)card number:(NSString *)number profile:(NSString *)profile completion:(NNCoreResult)completion {
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:card ?: @{} forKey:@"card"];
  if (number) args[@"number"] = number;
  [self call:@"nn_autofill_save_card" profile:profile args:args completion:completion];
}

+ (void)deleteAutofillEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_autofill_remove" profile:profile args:@{@"id" : entryId ?: @""} completion:completion];
}

+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_autofill_card_number" profile:profile args:@{@"id" : cardId ?: @""} completion:^(NSDictionary *result) {
    completion([result[@"number"] isKindOfClass:NSString.class] ? @{@"number" : result[@"number"]} : @{});
  }];
}

// MARK: Zoom

+ (void)zoomLevels:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, NSNumber *> *))completion {
  // A private window's zoom levels are its own and go with it.
  if (nncore_host::IsIncognito(profile)) return completion(@{});
  [self call:@"nn_zoom_list" profile:profile args:nil completion:^(NSDictionary *result) {
    NSMutableDictionary *levels = [NSMutableDictionary dictionary];
    NSDictionary *hosts = [result[@"levels"] isKindOfClass:NSDictionary.class] ? result[@"levels"] : @{};
    for (NSString *host in hosts) levels[host] = @(round(pow(1.2, [hosts[host] doubleValue]) * 100) / 100);
    completion(levels);
  }];
}

+ (void)setZoom:(double)zoom profile:(NSString *)profile host:(NSString *)host {
  host = host.lowercaseString;
  if (!host.length || zoom <= 0) return;
  const double level = fabs(zoom - 1) < 1e-6 ? 0 : log(zoom) / log(1.2);
  [self call:@"nn_zoom_set" profile:profile args:@{@"host" : host, @"level" : @(level)} completion:^(NSDictionary *) {}];
}

// MARK: Extensions

+ (void (^)(NSString *, NSDictionary *))extensionsHandler {
  return gExtensionsHandler;
}

+ (void)setExtensionsHandler:(void (^)(NSString *, NSDictionary *))handler {
  gExtensionsHandler = [handler copy];
}

+ (void)listExtensions:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_extensions_list" profile:profile args:nil completion:^(NSDictionary *result) {
    if (result[@"error"]) return completion(result);
    NSArray *infos = result[@"extensions"];
    if (![infos isKindOfClass:NSArray.class]) return completion(@{@"error" : @"Unexpected extension list"});
    NSMutableArray *list = [NSMutableArray array];
    for (NSDictionary *info in infos) {
      if (![info isKindOfClass:NSDictionary.class]) continue;
      NSMutableDictionary *item = [info mutableCopy];
      for (NSString *key in item.allKeys)
        if (item[key] == NSNull.null) item[key] = nil;
      NSString *path = [info[@"path"] isKindOfClass:NSString.class] ? info[@"path"] : nil;
      NSString *folder = path ?: StoreFolder(profile, info[@"id"], info[@"version"]);
      NSDictionary *manifest = folder ? nn::ext::ReadManifest(folder) : nil;
      for (NSString *key in @[ @"popup", @"actionTitle", @"actionIcon", @"sidePanel", @"hasAction" ])
        if (manifest[key]) item[key] = manifest[key];
      item[@"incognitoSplit"] = @([manifest[@"incognitoSplit"] boolValue]);
      for (NSString *key in @[ @"siteAccess", @"optionsUrl", @"path", @"homepageUrl" ])
        if (!item[key]) item[key] = NSNull.null;
      const BOOL fromStore = [info[@"location"] isEqual:@"FROM_STORE"];
      item[@"fromWebStore"] = @(fromStore);
      item[@"webStoreUrl"] = fromStore ? [@"https://chromewebstore.google.com/detail/" stringByAppendingString:info[@"id"]] : NSNull.null;
      [list addObject:item];
    }
    completion(@{@"extensions" : list});
  }];
}

+ (NSDictionary *)inspectUnpacked:(NSString *)path {
  NSMutableDictionary *info = [nn::ext::ReadManifest(path) mutableCopy];
  if (!info[@"error"]) info[@"path"] = path;
  return info;
}

+ (void)run:(NSString *)name profile:(NSString *)profile args:(NSDictionary *)args event:(NSString *)event completion:(NNCoreResult)completion {
  NSString *extensionId = args[@"id"];
  [self call:name profile:profile args:args completion:^(NSDictionary *result) {
    if (event && !result[@"error"]) Changed(profile, extensionId, event);
    completion(result);
  }];
}

+ (void)installExtension:(NSString *)path profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_extensions_install" profile:profile args:@{@"path" : path ?: @""} completion:^(NSDictionary *result) {
    if ([result[@"id"] isKindOfClass:NSString.class]) Changed(profile, result[@"id"], @"installed");
    completion(result);
  }];
}

+ (void)setExtension:(NSString *)extensionId enabled:(BOOL)enabled profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self run:@"nn_extensions_set_enabled" profile:profile args:@{@"id" : extensionId, @"enabled" : @(enabled)}
      event:enabled ? @"enabled" : @"disabled" completion:completion];
}

+ (void)uninstallExtension:(NSString *)extensionId profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self run:@"nn_extensions_uninstall" profile:profile args:@{@"id" : extensionId} event:@"uninstalled" completion:completion];
}

+ (void)reloadExtension:(NSString *)extensionId profile:(NSString *)profile completion:(NNCoreResult)completion {
  [self run:@"nn_extensions_reload" profile:profile args:@{@"id" : extensionId} event:@"reloaded" completion:completion];
}

+ (void)configureExtension:(NSString *)extensionId profile:(NSString *)profile options:(NSDictionary *)options completion:(NNCoreResult)completion {
  NSMutableDictionary *args = [NSMutableDictionary dictionaryWithObject:extensionId forKey:@"id"];
  for (NSString *key in @[ @"pinned", @"incognito", @"fileAccess", @"siteAccess" ])
    if (options[key]) args[key] = options[key];
  [self run:@"nn_extensions_configure" profile:profile args:args event:@"configured" completion:completion];
}

+ (void)searchEngineList:(NSString *)profile completion:(NNCoreResult)completion {
  [self call:@"nn_search_engines_list" profile:profile args:nil completion:^(NSDictionary *result) {
    if (result[@"error"]) return completion(result);
    completion(@{@"list" : @{@"engines" : result[@"engines"] ?: @[]}});
  }];
}

// MARK: Browsing data

+ (void)clearBrowsingData:(NSString *)profile types:(NSArray<NSString *> *)types since:(double)sinceMs completion:(void (^)(void))completion {
  NNCoreProfile *p = nncore_host::LoadedProfile(profile);
  if ([p respondsToSelector:@selector(clearBrowsingData:since:completion:)]) {
    [p clearBrowsingData:types since:[NSDate dateWithTimeIntervalSince1970:sinceMs / 1000] completion:completion];
    return;
  }
  completion();
}

@end
