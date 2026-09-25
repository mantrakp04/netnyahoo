#import "NNExtensionPackage.h"

#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>

#include <vector>

namespace nn::ext {

namespace {

// MARK: - Protocol buffers (just enough for the CRX3 header)

struct Field {
  uint64_t number = 0;
  NSData *bytes = nil;  // length-delimited fields only
};

bool ReadVarint(const uint8_t *&p, const uint8_t *end, uint64_t &out) {
  out = 0;
  for (int shift = 0; p < end && shift < 64; shift += 7) {
    uint8_t b = *p++;
    out |= (uint64_t)(b & 0x7f) << shift;
    if (!(b & 0x80)) return true;
  }
  return false;
}

/// The length-delimited fields of a message; false if it's malformed.
bool ParseMessage(NSData *data, std::vector<Field> &fields) {
  const uint8_t *p = (const uint8_t *)data.bytes, *end = p + data.length;
  while (p < end) {
    uint64_t key, value;
    if (!ReadVarint(p, end, key)) return false;
    switch (key & 7) {
      case 0:
        if (!ReadVarint(p, end, value)) return false;
        break;
      case 1:
        if (end - p < 8) return false;
        p += 8;
        break;
      case 5:
        if (end - p < 4) return false;
        p += 4;
        break;
      case 2: {
        if (!ReadVarint(p, end, value) || value > (uint64_t)(end - p)) return false;
        fields.push_back({key >> 3, [NSData dataWithBytes:p length:(NSUInteger)value]});
        p += value;
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

// MARK: - Keys and signatures

NSData *SHA256(NSData *data) {
  NSMutableData *out = [NSMutableData dataWithLength:CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, (unsigned char *)out.mutableBytes);
  return out;
}

/// Chrome's id alphabet: each hex digit of the first 16 bytes of SHA-256(key) as a–p.
NSString *IdForKeyData(NSData *key) {
  NSData *hash = SHA256(key);
  const uint8_t *b = (const uint8_t *)hash.bytes;
  NSMutableString *id = [NSMutableString stringWithCapacity:32];
  for (int i = 0; i < 16; i++) [id appendFormat:@"%c%c", 'a' + (b[i] >> 4), 'a' + (b[i] & 15)];
  return id;
}

bool DerRead(const uint8_t *&p, const uint8_t *end, uint8_t &tag, const uint8_t *&content, size_t &length) {
  if (end - p < 2) return false;
  tag = *p++;
  size_t len = *p++;
  if (len & 0x80) {
    int n = len & 0x7f;
    if (n < 1 || n > 4 || end - p < n) return false;
    len = 0;
    while (n--) len = (len << 8) | *p++;
  }
  if (len > (size_t)(end - p)) return false;
  content = p;
  length = len;
  p += len;
  return true;
}

/// The subjectPublicKey bits of a SubjectPublicKeyInfo: PKCS#1 RSAPublicKey for
/// RSA, the X9.63 point for EC — the forms SecKeyCreateWithData takes.
NSData *KeyFromSPKI(NSData *spki) {
  const uint8_t *p = (const uint8_t *)spki.bytes, *end = p + spki.length, *c;
  size_t len;
  uint8_t tag;
  if (!DerRead(p, end, tag, c, len) || tag != 0x30) return nil;
  const uint8_t *q = c, *qend = c + len;
  if (!DerRead(q, qend, tag, c, len) || tag != 0x30) return nil;  // AlgorithmIdentifier
  if (!DerRead(q, qend, tag, c, len) || tag != 0x03 || len < 2 || c[0] != 0) return nil;  // BIT STRING
  return [NSData dataWithBytes:c + 1 length:len - 1];
}

/// RSA PKCS#1 v1.5 or ECDSA P-256 (DER signature), both over SHA-256.
bool VerifySignature(NSData *spki, NSData *signature, NSData *message, bool ecdsa) {
  NSData *raw = KeyFromSPKI(spki);
  if (!raw) return false;
  NSDictionary *attributes = @{
    (__bridge id)kSecAttrKeyType : ecdsa ? (__bridge id)kSecAttrKeyTypeECSECPrimeRandom : (__bridge id)kSecAttrKeyTypeRSA,
    (__bridge id)kSecAttrKeyClass : (__bridge id)kSecAttrKeyClassPublic,
  };
  SecKeyRef key = SecKeyCreateWithData((__bridge CFDataRef)raw, (__bridge CFDictionaryRef)attributes, nullptr);
  if (!key) return false;
  SecKeyAlgorithm algorithm = ecdsa ? kSecKeyAlgorithmECDSASignatureMessageX962SHA256 : kSecKeyAlgorithmRSASignatureMessagePKCS1v15SHA256;
  bool ok = SecKeyVerifySignature(key, algorithm, (__bridge CFDataRef)message, (__bridge CFDataRef)signature, nullptr);
  CFRelease(key);
  return ok;
}

/// SHA-256 of the Chrome Web Store's publisher key (components/crx_file/crx_verifier.cc).
const uint8_t kPublisherKeyHash[] = {0x61, 0xf7, 0xf2, 0xa6, 0xbf, 0xcf, 0x74, 0xcd, 0x0b, 0xc1, 0xfe,
                                     0x24, 0x97, 0xcc, 0x9b, 0x04, 0x25, 0x4c, 0x65, 0x8f, 0x79, 0xf2,
                                     0x14, 0x53, 0x92, 0x86, 0x7e, 0xa8, 0x36, 0x63, 0x67, 0xcf};

struct Crx {
  NSString *extensionId;
  NSData *publicKey;  // the developer key (SPKI)
  NSData *archive;    // zip
};

/// Parses and verifies a CRX3 file: the developer's signature over the header
/// and archive must match the id, and the store must have signed it too.
NSString *VerifyCrx(NSData *file, NSString *expectedId, Crx &out) {
  const uint8_t *b = (const uint8_t *)file.bytes;
  if (file.length < 12 || memcmp(b, "Cr24", 4)) return @"Not an extension package";
  uint32_t version, headerSize;
  memcpy(&version, b + 4, 4);
  memcpy(&headerSize, b + 8, 4);
  if (version != 3) return [NSString stringWithFormat:@"Unsupported package version %u", version];
  if ((uint64_t)headerSize + 12 > file.length) return @"Damaged package";
  NSData *header = [file subdataWithRange:NSMakeRange(12, headerSize)];
  NSData *archive = [file subdataWithRange:NSMakeRange(12 + headerSize, file.length - 12 - headerSize)];

  std::vector<Field> fields;
  if (!ParseMessage(header, fields)) return @"Damaged package header";
  NSData *signedData = nil;
  struct Proof {
    NSData *key, *signature;
    bool ecdsa;
  };
  std::vector<Proof> proofs;  // field 2: sha256_with_rsa, 3: sha256_with_ecdsa
  for (const Field &f : fields) {
    if (f.number == 10000) signedData = f.bytes;
    if (f.number != 2 && f.number != 3) continue;
    std::vector<Field> proof;
    if (!ParseMessage(f.bytes, proof)) return @"Damaged package signature";
    NSData *key = nil, *signature = nil;
    for (const Field &pf : proof) {
      if (pf.number == 1) key = pf.bytes;
      if (pf.number == 2) signature = pf.bytes;
    }
    if (key && signature) proofs.push_back({key, signature, f.number == 3});
  }
  std::vector<Field> signedFields;
  if (!signedData || !ParseMessage(signedData, signedFields)) return @"Package isn't signed";
  NSData *crxId = nil;
  for (const Field &f : signedFields)
    if (f.number == 1) crxId = f.bytes;
  if (crxId.length != 16) return @"Package isn't signed";

  NSMutableData *message = [NSMutableData dataWithBytes:"CRX3 SignedData\x00" length:16];
  uint32_t signedSize = (uint32_t)signedData.length;
  [message appendBytes:&signedSize length:4];
  [message appendData:signedData];
  [message appendData:archive];

  NSData *developerKey = nil;
  bool publisherSigned = false;
  for (const auto &[key, signature, ecdsa] : proofs) {
    NSData *hash = SHA256(key);
    bool isDeveloper = !ecdsa && [[hash subdataWithRange:NSMakeRange(0, 16)] isEqualToData:crxId];
    bool isPublisher = hash.length == sizeof(kPublisherKeyHash) && !memcmp(hash.bytes, kPublisherKeyHash, hash.length);
    if (!isDeveloper && !isPublisher) continue;
    if (!VerifySignature(key, signature, message, ecdsa)) return @"Package signature is invalid";
    if (isDeveloper) developerKey = key;
    if (isPublisher) publisherSigned = true;
  }
  if (!developerKey) return @"Package signature is missing";
  if (!publisherSigned) return @"Package isn't signed by the Chrome Web Store";
  out.extensionId = IdForKeyData(developerKey);
  if (expectedId && ![out.extensionId isEqualToString:expectedId]) return @"Package id doesn't match";
  out.publicKey = developerKey;
  out.archive = archive;
  return nil;
}

// MARK: - Unpacking

NSString *Unzip(NSData *archive, NSString *folder) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *zip = [folder stringByAppendingPathExtension:@"zip"];
  if (![archive writeToFile:zip atomically:NO]) return @"Couldn't save the download";
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:@"/usr/bin/ditto"];
  task.arguments = @[ @"-x", @"-k", zip, folder ];
  task.standardOutput = NSFileHandle.fileHandleWithNullDevice;
  task.standardError = NSFileHandle.fileHandleWithNullDevice;
  NSError *error = nil;
  BOOL launched = [task launchAndReturnError:&error];
  if (launched) [task waitUntilExit];
  [fm removeItemAtPath:zip error:nil];
  if (!launched || task.terminationStatus != 0) return @"Couldn't unpack the extension";
  return nil;
}

/// Chrome refuses unpacked folders with reserved "_" names (the store's
/// _metadata signatures); keeps _locales.
void RemoveReservedEntries(NSString *folder) {
  for (NSString *name in [NSFileManager.defaultManager contentsOfDirectoryAtPath:folder error:nil]) {
    if ([name hasPrefix:@"_"] && ![name isEqualToString:@"_locales"])
      [NSFileManager.defaultManager removeItemAtPath:[folder stringByAppendingPathComponent:name] error:nil];
  }
}

/// Adds `"key": …` so Chrome derives the store id for the unpacked copy.
NSString *InsertKey(NSString *folder, NSData *publicKey) {
  NSString *path = [folder stringByAppendingPathComponent:@"manifest.json"];
  NSMutableString *text = [NSMutableString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  if (!text) return @"The extension has no manifest";
  NSDictionary *manifest = [NSJSONSerialization JSONObjectWithData:[text dataUsingEncoding:NSUTF8StringEncoding]
                                                           options:NSJSONReadingJSON5Allowed
                                                             error:nil];
  if (![manifest isKindOfClass:NSDictionary.class]) return @"The extension's manifest is invalid";
  if (manifest[@"key"]) return nil;
  NSRange brace = [text rangeOfString:@"{"];
  NSString *entry = [NSString stringWithFormat:@"\n  \"key\": \"%@\",", [publicKey base64EncodedStringWithOptions:0]];
  [text insertString:entry atIndex:NSMaxRange(brace)];
  return [text writeToFile:path atomically:YES encoding:NSUTF8StringEncoding error:nil] ? nil : @"Couldn't save the manifest";
}

// MARK: - Manifest

NSDictionary *LoadJSON(NSString *path) {
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return nil;
  // Manifests and message catalogs may carry comments / trailing commas.
  id object = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingJSON5Allowed error:nil];
  return [object isKindOfClass:NSDictionary.class] ? object : nil;
}

/// __MSG_name__ strings, resolved against the best locale's messages.json.
NSString *Localize(id value, NSDictionary *messages) {
  if (![value isKindOfClass:NSString.class]) return nil;
  NSString *s = value;
  if (![s hasPrefix:@"__MSG_"] || ![s hasSuffix:@"__"] || s.length <= 8) return s;
  NSString *key = [[s substringWithRange:NSMakeRange(6, s.length - 8)] lowercaseString];
  for (NSString *k in messages) {
    if ([k.lowercaseString isEqualToString:key]) {
      NSString *message = messages[k][@"message"];
      if ([message isKindOfClass:NSString.class]) return message;
    }
  }
  return s;
}

NSDictionary *Messages(NSString *folder, NSDictionary *manifest) {
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
    if (messages) return messages;
  }
  return @{};
}

/// The icon path closest to `size` (preferring larger) from {"16": path, …} or a plain path.
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

}  // namespace

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
  if (![path hasPrefix:folder.stringByStandardizingPath]) return nil;
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
  NSDictionary *messages = Messages(folder, m);
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
  out[@"manifestVersion"] = m[@"manifest_version"] ?: @2;
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
  out[@"homepageUrl"] = [m[@"homepage_url"] isKindOfClass:NSString.class] ? m[@"homepage_url"] : nil;
  out[@"id"] = [m[@"key"] isKindOfClass:NSString.class] ? IdForKey(m[@"key"]) : nil;
  return out;
}

void DownloadFromWebStore(NSString *extensionId, NSString *chromiumVersion, NSString *stagingRoot,
                          void (^completion)(NSString *folder, NSString *error)) {
  void (^finish)(NSString *, NSString *) = [completion copy];
  auto fail = ^(NSString *error) {
    dispatch_async(dispatch_get_main_queue(), ^{ finish(nil, error); });
  };
  if (!IsExtensionId(extensionId)) return fail(@"Not a Chrome Web Store extension id");
  NSString *x = [NSString stringWithFormat:@"id=%@&installsource=ondemand&uc", extensionId];
  NSURLComponents *url = [NSURLComponents componentsWithString:@"https://clients2.google.com/service/update2/crx"];
  url.queryItems = @[
    [NSURLQueryItem queryItemWithName:@"response" value:@"redirect"],
    [NSURLQueryItem queryItemWithName:@"prodversion" value:chromiumVersion],
    [NSURLQueryItem queryItemWithName:@"acceptformat" value:@"crx3"],
    [NSURLQueryItem queryItemWithName:@"os" value:@"mac"],
    [NSURLQueryItem queryItemWithName:@"arch" value:@"arm64"],
    [NSURLQueryItem queryItemWithName:@"x" value:x],
  ];
  // "&" and "=" inside x must stay encoded.
  url.percentEncodedQuery = [url.percentEncodedQuery stringByReplacingOccurrencesOfString:x
                                                                               withString:[x stringByAddingPercentEncodingWithAllowedCharacters:NSCharacterSet.alphanumericCharacterSet]];
  NSURLSessionDataTask *task = [NSURLSession.sharedSession
        dataTaskWithURL:url.URL
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger status = [response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
        if (error) return fail(error.localizedDescription);
        if (status != 200 || data.length < 16) return fail(@"This extension isn't available from the Chrome Web Store");
        Crx crx;
        if (NSString *problem = VerifyCrx(data, extensionId, crx)) return fail(problem);
        NSString *folder = [stagingRoot stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
        [NSFileManager.defaultManager createDirectoryAtPath:folder withIntermediateDirectories:YES attributes:nil error:nil];
        NSString *problem = Unzip(crx.archive, folder);
        if (!problem) {
          RemoveReservedEntries(folder);
          problem = InsertKey(folder, crx.publicKey);
        }
        if (problem) {
          [NSFileManager.defaultManager removeItemAtPath:folder error:nil];
          return fail(problem);
        }
        dispatch_async(dispatch_get_main_queue(), ^{ finish(folder, nil); });
      }];
  [task resume];
}

}  // namespace nn::ext
