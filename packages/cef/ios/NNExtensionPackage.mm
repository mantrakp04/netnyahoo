#import "NNExtensionPackage.h"

#import <CommonCrypto/CommonDigest.h>

namespace nn::ext {

namespace {

// MARK: - Keys

NSData *SHA256(NSData *data) {
  NSMutableData *out = [NSMutableData dataWithLength:CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, (unsigned char *)out.mutableBytes);
  return out;
}

NSString *IdForKeyData(NSData *key) {
  NSData *hash = SHA256(key);
  const uint8_t *b = (const uint8_t *)hash.bytes;
  NSMutableString *id = [NSMutableString stringWithCapacity:32];
  for (int i = 0; i < 16; i++) [id appendFormat:@"%c%c", 'a' + (b[i] >> 4), 'a' + (b[i] & 15)];
  return id;
}

// MARK: - Manifest

NSDictionary *LoadJSON(NSString *path) {
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return nil;
  id object = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingJSON5Allowed error:nil];
  return [object isKindOfClass:NSDictionary.class] ? object : nil;
}

// Messages() has checked that every entry is { "message": "…" }.
NSString *Localize(id value, NSDictionary<NSString *, NSDictionary *> *messages) {
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *s = value;
  if (![s hasPrefix:@"__MSG_"] || ![s hasSuffix:@"__"] || s.length <= 8) return s;
  NSString *key = [[s substringWithRange:NSMakeRange(6, s.length - 8)] lowercaseString];
  for (NSString *k in messages)
    if ([k.lowercaseString isEqualToString:key]) return messages[k][@"message"];
  return s;
}

// Chromium refuses a messages file with any entry that isn't { "message": string }, and so do we.
bool ValidMessages(NSDictionary *messages) {
  for (id key in messages) {
    NSDictionary *entry = messages[key];
    if (![key isKindOfClass:NSString.class] || ![entry isKindOfClass:NSDictionary.class] ||
        ![entry[@"message"] isKindOfClass:NSString.class])
      return false;
  }
  return true;
}

// The messages of the first locale that has any, or nil with |error| set if that file is malformed.
NSDictionary *Messages(NSString *folder, NSDictionary *manifest, NSString **error) {
  NSString *locales = [folder stringByAppendingPathComponent:@"_locales"];
  NSMutableArray<NSString *> *candidates = [NSMutableArray array];
  for (NSString *lang in NSLocale.preferredLanguages) {
    NSString *l = [lang stringByReplacingOccurrencesOfString:@"-" withString:@"_"];
    [candidates addObject:l];
    NSRange sep = [l rangeOfString:@"_"];
    if (sep.location != NSNotFound) [candidates addObject:[l substringToIndex:sep.location]];
  }
  if ([manifest[@"default_locale"] isKindOfClass:NSString.class]) [candidates addObject:manifest[@"default_locale"]];
  [candidates addObjectsFromArray:@[ @"en", @"en_US" ]];
  for (NSString *locale in candidates) {
    NSDictionary *messages = LoadJSON([[locales stringByAppendingPathComponent:locale] stringByAppendingPathComponent:@"messages.json"]);
    if (!messages) continue;
    if (ValidMessages(messages)) return messages;
    *error = [NSString stringWithFormat:@"The localization file _locales/%@/messages.json is invalid", locale];
    return nil;
  }
  return @{};
}

NSString *IconPath(id icons, int size) {
  if ([icons isKindOfClass:NSString.class]) return icons;
  if (![icons isKindOfClass:NSDictionary.class]) return nil;
  NSString *best = nil;
  int bestSize = 0;
  for (NSString *key in icons) {
    int s = key.intValue;
    if (![icons[key] isKindOfClass:NSString.class] || s <= 0) continue;
    bool better = !best || (bestSize < size ? s > bestSize : (s >= size && s < bestSize));
    if (better) {
      best = icons[key];
      bestSize = s;
    }
  }
  return best;
}

NSArray<NSString *> *Strings(id list) {
  NSMutableArray *out = [NSMutableArray array];
  if ([list isKindOfClass:NSArray.class])
    for (id item in list)
      if ([item isKindOfClass:NSString.class]) [out addObject:item];
  return out;
}

bool IsHostPattern(NSString *s) { return [s isEqualToString:@"<all_urls>"] || [s containsString:@"://"]; }

}

bool IsExtensionId(NSString *s) {
  if (s.length != 32) return false;
  for (NSUInteger i = 0; i < 32; i++) {
    unichar c = [s characterAtIndex:i];
    if (c < 'a' || c > 'p') return false;
  }
  return true;
}

NSString *IdForKey(NSString *base64Key) {
  NSData *key = base64Key.length ? [[NSData alloc] initWithBase64EncodedString:base64Key options:NSDataBase64DecodingIgnoreUnknownCharacters] : nil;
  return key.length ? IdForKeyData(key) : nil;
}

NSString *DataURL(NSString *folder, NSString *relativePath) {
  if (!relativePath.length) return nil;
  NSString *rel = [relativePath hasPrefix:@"/"] ? [relativePath substringFromIndex:1] : relativePath;
  NSString *path = [[folder stringByAppendingPathComponent:rel] stringByStandardizingPath];
  NSArray *root = folder.stringByStandardizingPath.pathComponents;
  NSArray *parts = path.pathComponents;
  if (parts.count <= root.count || ![[parts subarrayWithRange:NSMakeRange(0, root.count)] isEqualToArray:root]) return nil;
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data.length) return nil;
  NSDictionary *types = @{@"png" : @"image/png", @"jpg" : @"image/jpeg", @"jpeg" : @"image/jpeg", @"gif" : @"image/gif",
                          @"svg" : @"image/svg+xml", @"webp" : @"image/webp", @"ico" : @"image/x-icon", @"bmp" : @"image/bmp"};
  NSString *type = types[path.pathExtension.lowercaseString];
  if (!type) return nil;
  return [NSString stringWithFormat:@"data:%@;base64,%@", type, [data base64EncodedStringWithOptions:0]];
}

NSDictionary *ReadManifest(NSString *folder) {
  NSDictionary *m = LoadJSON([folder stringByAppendingPathComponent:@"manifest.json"]);
  if (!m) return @{@"error" : @"Manifest file is missing or unreadable"};
  NSString *localeError = nil;
  NSDictionary *messages = Messages(folder, m, &localeError);
  if (!messages) return @{@"error" : localeError};
  NSDictionary *action = [m[@"action"] isKindOfClass:NSDictionary.class]           ? m[@"action"]
                         : [m[@"browser_action"] isKindOfClass:NSDictionary.class] ? m[@"browser_action"]
                         : [m[@"page_action"] isKindOfClass:NSDictionary.class]    ? m[@"page_action"]
                                                                                   : nil;
  NSMutableOrderedSet<NSString *> *hosts = [NSMutableOrderedSet orderedSet];
  NSMutableArray<NSString *> *permissions = [NSMutableArray array];
  for (NSString *p in Strings(m[@"permissions"])) {
    if (IsHostPattern(p)) [hosts addObject:p];
    else [permissions addObject:p];
  }
  [hosts addObjectsFromArray:Strings(m[@"host_permissions"])];
  if ([m[@"content_scripts"] isKindOfClass:NSArray.class])
    for (NSDictionary *cs in m[@"content_scripts"])
      if ([cs isKindOfClass:NSDictionary.class]) [hosts addObjectsFromArray:Strings(cs[@"matches"])];

  NSMutableDictionary *out = [NSMutableDictionary dictionary];
  out[@"name"] = Localize(m[@"name"], messages) ?: @"";
  out[@"shortName"] = Localize(m[@"short_name"], messages);
  out[@"version"] = [m[@"version"] isKindOfClass:NSString.class] ? m[@"version"] : @"";
  out[@"description"] = Localize(m[@"description"], messages) ?: @"";
  out[@"manifestVersion"] = [m[@"manifest_version"] isKindOfClass:NSNumber.class] ? m[@"manifest_version"] : @2;
  out[@"icon"] = DataURL(folder, IconPath(m[@"icons"], 128));
  out[@"permissions"] = permissions;
  out[@"optionalPermissions"] = Strings(m[@"optional_permissions"]);
  out[@"hostPermissions"] = hosts.array;
  out[@"hasAction"] = @(action != nil);
  out[@"popup"] = [action[@"default_popup"] isKindOfClass:NSString.class] && [action[@"default_popup"] length] ? action[@"default_popup"] : nil;
  out[@"actionTitle"] = Localize(action[@"default_title"], messages);
  out[@"actionIcon"] = DataURL(folder, IconPath(action[@"default_icon"], 32) ?: IconPath(m[@"icons"], 32));
  NSString *options = [m[@"options_ui"] isKindOfClass:NSDictionary.class] ? m[@"options_ui"][@"page"] : m[@"options_page"];
  out[@"optionsPage"] = [options isKindOfClass:NSString.class] ? options : nil;
  NSString *panel = [m[@"side_panel"] isKindOfClass:NSDictionary.class] ? m[@"side_panel"][@"default_path"] : nil;
  out[@"sidePanel"] = [panel isKindOfClass:NSString.class] ? panel : nil;
  out[@"incognitoSplit"] = @([m[@"incognito"] isEqual:@"split"]);
  out[@"homepageUrl"] = [m[@"homepage_url"] isKindOfClass:NSString.class] ? m[@"homepage_url"] : nil;
  out[@"id"] = [m[@"key"] isKindOfClass:NSString.class] ? IdForKey(m[@"key"]) : nil;
  return out;
}

}
