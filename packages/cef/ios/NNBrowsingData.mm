// Browsing data the app manages itself, per profile.
//
// Favicons for the app's UI, fetched through the engine: a tab's icon is
// downloaded by its own browser (Chromium's image downloader: its request
// context, no cookies, ICO/SVG decoded); icons of pages without a live tab go
// through the profile's request context. Persistent profiles keep PNGs in
// "<profile dir>/Netnyahoo Favicons"; incognito ones only ever get a data: URI
// back, so nothing of theirs reaches the disk.
//
// Ranged cookie deletion for Clear Browsing Data (the engine only deletes by
// URL/name): cookies created since a time.

#import "NNCefInternal.h"

#import <AppKit/AppKit.h>

#include "include/cef_cookie.h"
#include "include/cef_image.h"
#include "include/cef_urlrequest.h"

using namespace nn;

namespace {

/// DIP size asked of the engine; 2x representations come along (32 px tabs, 64 px on Retina).
constexpr int kFaviconSize = 32;
/// Pages' icons can be huge (apple-touch-icon, SVG): the fetch path stops reading past this.
constexpr size_t kMaxBytes = 2 * 1024 * 1024;

NSString *FaviconDirectory(NSString *profile) {
  return [ProfileDirectory(profile) stringByAppendingPathComponent:@"Netnyahoo Favicons"];
}

/// JS names files by a hash; anything else could escape the directory.
bool SafeName(NSString *name) {
  static NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"^[A-Za-z0-9_-]{1,80}$" options:0 error:nil];
  return name.length && [re firstMatchInString:name options:0 range:NSMakeRange(0, name.length)];
}

/// {uri, width, height}: a file for persistent profiles when `name` is given, else a data: URI.
NSDictionary *Store(NSData *png, int width, int height, NSString *profile, NSString *name) {
  if (!png.length) return nil;
  if (profile && !IsIncognito(profile) && SafeName(name)) {
    NSString *dir = FaviconDirectory(profile);
    [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *path = [dir stringByAppendingPathComponent:[name stringByAppendingPathExtension:@"png"]];
    if (![png writeToFile:path atomically:YES]) return nil;
    // The name stays the same when an icon changes: the query busts RN's image cache.
    NSString *uri = [NSString stringWithFormat:@"%@?v=%lld", [NSURL fileURLWithPath:path].absoluteString,
                                               (long long)(NSDate.date.timeIntervalSince1970 * 1000)];
    return @{@"uri" : uri, @"width" : @(width), @"height" : @(height)};
  }
  NSString *uri = [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
  return @{@"uri" : uri, @"width" : @(width), @"height" : @(height)};
}

/// Decodes any image format AppKit reads (ICO with several sizes, PNG, SVG…) and
/// renders the representation closest to `pixels` as a square PNG at most that big.
NSData *PNGFromData(NSData *data, int pixels, int *width, int *height) {
  NSImage *image = data.length ? [[NSImage alloc] initWithData:data] : nil;
  if (!image || image.size.width <= 0 || image.size.height <= 0) return nil;
  NSImageRep *best = nil;
  NSInteger bestSize = 0;
  for (NSImageRep *rep in image.representations) {
    NSInteger size = MAX(rep.pixelsWide, rep.pixelsHigh);
    if (size <= 0) size = NSIntegerMax;  // vector: scales to anything
    // The smallest one that's big enough, else the biggest.
    bool better = !best || (bestSize < pixels ? size > bestSize : (size >= pixels && size < bestSize));
    if (better) best = rep, bestSize = size;
  }
  if (!best) return nil;
  int side = (int)MIN((NSInteger)pixels, bestSize);
  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:side pixelsHigh:side
                                                                  bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
                                                                 colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
  NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
  if (!context) return nil;
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = context;
  context.imageInterpolation = NSImageInterpolationHigh;
  // Keep the aspect ratio, centered.
  NSSize size = best.size.width > 0 && best.size.height > 0 ? best.size : image.size;
  CGFloat scale = side / MAX(size.width, size.height);
  NSRect rect = NSMakeRect((side - size.width * scale) / 2, (side - size.height * scale) / 2, size.width * scale, size.height * scale);
  [best drawInRect:rect fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1 respectFlipped:YES hints:nil];
  [NSGraphicsContext restoreGraphicsState];
  *width = side;
  *height = side;
  return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}

class DownloadCallback : public CefDownloadImageCallback {
 public:
  DownloadCallback(NSString *profile, NSString *name, void (^completion)(NSDictionary *))
      : profile_([profile copy]), name_([name copy]), completion_([completion copy]) {}
  void OnDownloadImageFinished(const CefString &image_url, int http_status_code, CefRefPtr<CefImage> image) override {
    NSDictionary *result = nil;
    if (image && !image->IsEmpty()) {
      int width = 0, height = 0;
      CefRefPtr<CefBinaryValue> png = image->GetAsPNG(2, true, width, height);
      if (png && png->GetSize()) {
        NSMutableData *data = [NSMutableData dataWithLength:png->GetSize()];
        png->GetData(data.mutableBytes, data.length, 0);
        result = Store(data, width, height, profile_, name_);
      }
    }
    completion_(result);
  }

 private:
  NSString *profile_;
  NSString *name_;
  void (^completion_)(NSDictionary *);
  IMPLEMENT_REFCOUNTING(DownloadCallback);
};

class FetchClient : public CefURLRequestClient {
 public:
  FetchClient(NSString *profile, NSString *name, void (^completion)(NSDictionary *))
      : profile_([profile copy]), name_([name copy]), completion_([completion copy]), data_([NSMutableData data]) {}
  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    NSDictionary *result = nil;
    CefRefPtr<CefResponse> response = request->GetResponse();
    int status = response ? response->GetStatus() : 0;
    if (request->GetRequestStatus() == UR_SUCCESS && status >= 200 && status < 300 && !truncated_) {
      int width = 0, height = 0;
      NSData *png = PNGFromData(data_, kFaviconSize * 2, &width, &height);
      result = Store(png, width, height, profile_, name_);
    }
    completion_(result);
  }
  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadData(CefRefPtr<CefURLRequest> request, const void *data, size_t length) override {
    if (data_.length + length > kMaxBytes) {
      truncated_ = true;
      request->Cancel();
      return;
    }
    [data_ appendBytes:data length:length];
  }
  bool GetAuthCredentials(bool, const CefString &, int, const CefString &, const CefString &,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  NSString *profile_;
  NSString *name_;
  void (^completion_)(NSDictionary *);
  NSMutableData *data_;
  bool truncated_ = false;
  IMPLEMENT_REFCOUNTING(FetchClient);
};

/// Deletes the cookies created at or after `cutoff`; counts them, reports when the visit ends.
class RecentCookiesVisitor : public CefCookieVisitor {
 public:
  RecentCookiesVisitor(int64_t cutoff, void (^completion)(NSInteger)) : cutoff_(cutoff), completion_([completion copy]) {}
  ~RecentCookiesVisitor() override {
    NSInteger deleted = deleted_;
    auto completion = completion_;
    dispatch_async(dispatch_get_main_queue(), ^{ completion(deleted); });
  }
  bool Visit(const CefCookie &cookie, int count, int total, bool &deleteCookie) override {
    if (cookie.creation.val >= cutoff_) {
      deleteCookie = true;
      deleted_++;
    }
    return true;
  }

 private:
  int64_t cutoff_;
  NSInteger deleted_ = 0;
  void (^completion_)(NSInteger);
  IMPLEMENT_REFCOUNTING(RecentCookiesVisitor);
};

class CacheCleared : public CefCompletionCallback {
 public:
  explicit CacheCleared(void (^block)(void)) : block_([block copy]) {}
  void OnComplete() override { dispatch_async(dispatch_get_main_queue(), block_); }

 private:
  void (^block_)(void);
  IMPLEMENT_REFCOUNTING(CacheCleared);
};

}  // namespace

namespace nn {

void DownloadFavicon(CefRefPtr<CefBrowser> browser, NSString *url, NSString *name, void (^completion)(NSDictionary *)) {
  if (!browser || !url.length) return completion(nil);
  // The browser's own context decides where the icon may go: an unknown one counts as incognito.
  NSString *profile = ProfileForContext(browser->GetHost()->GetRequestContext()) ?: @"incognito:unknown";
  browser->GetHost()->DownloadImage(ToCef(url), true, kFaviconSize, false, new DownloadCallback(profile, name, completion));
}

void DownloadImage(CefRefPtr<CefBrowser> browser, NSString *url, int maxPixels, void (^completion)(NSDictionary *)) {
  if (!browser || !url.length) return completion(nil);
  // No name: Store() returns a data: URI and writes nothing.
  browser->GetHost()->DownloadImage(ToCef(url), true, MAX(16, MIN(maxPixels, 1024)), false, new DownloadCallback(nil, nil, completion));
}

}  // namespace nn

@implementation NNFavicons

+ (void)fetch:(NSString *)url profile:(NSString *)profile name:(NSString *)name
    completion:(void (^)(NSDictionary<NSString *, id> *_Nullable))completion {
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  // Only persistent profiles, and only the web: never file: or other local schemes.
  if (IsIncognito(profile) || !([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"])) return completion(nil);
  CefRefPtr<CefRequest> request = CefRequest::Create();
  request->SetURL(ToCef(url));
  request->SetMethod("GET");
  // No UR_FLAG_ALLOW_STORED_CREDENTIALS: no cookies either way, like the image downloader's favicon mode.
  request->SetFlags(UR_FLAG_NONE);
  CefURLRequest::Create(request, new FetchClient(profile, name, completion), ContextForProfile(profile));
}

+ (void)pruneProfile:(NSString *)profile keeping:(NSArray<NSString *> *)names {
  if (IsIncognito(profile)) return;
  NSString *dir = FaviconDirectory(profile);
  NSSet<NSString *> *keep = [NSSet setWithArray:names];
  for (NSString *file in [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil]) {
    if (![keep containsObject:file.stringByDeletingPathExtension])
      [[NSFileManager defaultManager] removeItemAtPath:[dir stringByAppendingPathComponent:file] error:nil];
  }
}

@end

@implementation NNBrowsingData

+ (void)deleteCookiesForProfile:(NSString *)profile since:(double)sinceMs completion:(void (^)(NSInteger))completion {
  CefRefPtr<CefCookieManager> cookies = ContextForProfile(profile)->GetCookieManager(nullptr);
  double ageMs = MAX(0, NSDate.date.timeIntervalSince1970 * 1000 - sinceMs);
  // Cookie times are the engine's base time (µs); count back from its "now".
  int64_t cutoff = cef_basetime_now().val - (int64_t)(ageMs * 1000);
  __block BOOL done = NO;
  void (^finish)(NSInteger) = ^(NSInteger deleted) {
    if (done) return;
    done = YES;
    cookies->FlushStore(nullptr);
    completion(deleted);
  };
  if (!cookies || !cookies->VisitAllCookies(new RecentCookiesVisitor(cutoff, finish))) finish(0);
}

+ (void)clearCacheForProfile:(NSString *)profile completion:(void (^)(void))completion {
  ContextForProfile(profile)->ClearHttpCache(new CacheCleared(completion));
}

@end
