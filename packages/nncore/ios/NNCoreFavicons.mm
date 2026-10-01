// The favicons the app keeps per profile (lib/favicons.ts), stored as packages/cef's NNFavicons stores them.
// A favicon a tab already showed comes from Chrome's favicon driver (noteImage:forURL:); anything else is
// downloaded through the profile's network stack without cookies (Download).
#import "NNCoreInternal.h"

namespace {

constexpr int kFaviconSize = 32;
constexpr NSUInteger kMaxBytes = 2 * 1024 * 1024;

NSCache<NSString *, NSImage *> *Seen() {
  static NSCache *cache = [] {
    NSCache *c = [NSCache new];
    c.countLimit = 512;
    return c;
  }();
  return cache;
}

// Per profile: a private tab's icon (fetched with its cookies) never answers another profile's fetch, which the app
// would keep in that profile's favicon store.
NSString *SeenKey(NSString *profile, NSString *url) {
  return [NSString stringWithFormat:@"%@\n%@", profile ?: @"", url];
}

NSString *FaviconDirectory(NSString *profile) {
  NSString *dir = profile.length ? [@"Profile " stringByAppendingString:profile] : @"Default";
  return [[NNCoreHost.dataDirectory stringByAppendingPathComponent:dir] stringByAppendingPathComponent:@"Netnyahoo Favicons"];
}

bool SafeName(NSString *name) {
  static NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,80}$" options:0 error:nil];
  return name.length && [re firstMatchInString:name options:0 range:NSMakeRange(0, name.length)];
}

NSDictionary *Store(NSData *png, int width, int height, NSString *profile, NSString *name) {
  if (!png.length) return nil;
  if (profile && !nncore_host::IsIncognito(profile) && SafeName(name)) {
    NSString *dir = FaviconDirectory(profile);
    [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *path = [dir stringByAppendingPathComponent:[name stringByAppendingPathExtension:@"png"]];
    if (![png writeToFile:path atomically:YES]) return nil;
    NSString *uri = [NSString stringWithFormat:@"%@?v=%lld", [NSURL fileURLWithPath:path].absoluteString,
                                               (long long)(NSDate.date.timeIntervalSince1970 * 1000)];
    return @{@"uri" : uri, @"width" : @(width), @"height" : @(height)};
  }
  NSString *uri = [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
  return @{@"uri" : uri, @"width" : @(width), @"height" : @(height)};
}

// The representation closest to `pixels`, drawn square at up to that size.
NSData *PNG(NSImage *image, int pixels, int *width, int *height) {
  if (!image || image.size.width <= 0 || image.size.height <= 0) return nil;
  NSImageRep *best = nil;
  NSInteger bestSize = 0;
  for (NSImageRep *rep in image.representations) {
    NSInteger size = MAX(rep.pixelsWide, rep.pixelsHigh);
    if (size <= 0) size = NSIntegerMax;
    const bool better = !best || (bestSize < pixels ? size > bestSize : (size >= pixels && size < bestSize));
    if (better) best = rep, bestSize = size;
  }
  if (!best) return nil;
  const int side = (int)MIN((NSInteger)pixels, bestSize);
  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:side pixelsHigh:side bitsPerSample:8
                                                                samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                                                                 colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
  if (!context) return nil;
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = context;
  context.imageInterpolation = NSImageInterpolationHigh;
  NSSize size = best.size.width > 0 && best.size.height > 0 ? best.size : image.size;
  CGFloat scale = side / MAX(size.width, size.height);
  NSRect rect = NSMakeRect((side - size.width * scale) / 2, (side - size.height * scale) / 2, size.width * scale, size.height * scale);
  [best drawInRect:rect fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];
  [NSGraphicsContext restoreGraphicsState];
  *width = side;
  *height = side;
  return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}

// Through Chrome's network stack, with the profile's own loader (NNCoreProfile fetchIcon:): its proxy and cache,
// no cookies, Chrome's favicon types only. A private window's profile is used only while it is open: a fetch never
// makes one.
void Download(NSString *url, NSString *profileName, void (^done)(NSData *_Nullable data)) {
  void (^fetch)(NNCoreProfile *) = ^(NNCoreProfile *profile) {
    if (!profile || profile.destroyed || ![profile respondsToSelector:@selector(fetchIcon:maxBytes:completion:)]) return done(nil);
    [profile fetchIcon:url maxBytes:kMaxBytes completion:done];
  };
  if (nncore_host::IsIncognito(profileName)) return fetch(nncore_host::LoadedProfile(profileName));
  nncore_host::WithProfile(profileName, fetch);
}

}  // namespace

@implementation NNCoreFavicons

+ (void)noteImage:(NSImage *)image forURL:(NSString *)url profile:(NSString *)profile {
  if (image && url.length) [Seen() setObject:image forKey:SeenKey(profile, url)];
}

+ (void)fetch:(NSString *)url
       profile:(NSString *)profile
          name:(NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *))completion {
  int width = 0, height = 0;
  if (NSImage *seen = [Seen() objectForKey:SeenKey(profile, url)]) {
    return completion(Store(PNG(seen, kFaviconSize * 2, &width, &height), width, height, profile, name));
  }
  if ([url hasPrefix:@"data:image/"]) {
    NSData *data = [NSData dataWithContentsOfURL:[NSURL URLWithString:url]];
    NSImage *image = data ? [[NSImage alloc] initWithData:data] : nil;
    return completion(Store(PNG(image, kFaviconSize * 2, &width, &height), width, height, profile, name));
  }
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  if (!([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"])) return completion(nil);
  // A private profile's icon comes back as a data: URI (Store), never into the profile's folder.
  Download(url, profile, ^(NSData *body) {
    int w = 0, h = 0;
    NSImage *image = body ? [[NSImage alloc] initWithData:body] : nil;
    completion(image ? Store(PNG(image, kFaviconSize * 2, &w, &h), w, h, profile, name) : nil);
  });
}

+ (void)pruneProfile:(NSString *)profile keeping:(NSArray<NSString *> *)names {
  if (nncore_host::IsIncognito(profile)) return;
  NSString *dir = FaviconDirectory(profile);
  NSSet<NSString *> *keep = [NSSet setWithArray:names];
  for (NSString *file in [NSFileManager.defaultManager contentsOfDirectoryAtPath:dir error:nil])
    if (![keep containsObject:file.stringByDeletingPathExtension])
      [NSFileManager.defaultManager removeItemAtPath:[dir stringByAppendingPathComponent:file] error:nil];
}

@end
