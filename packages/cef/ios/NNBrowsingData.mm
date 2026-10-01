// Favicons are data URIs held in memory by the app; Chrome's FaviconService is where they're kept
// (packages/cef/src/favicons.ts). Nothing here writes them to disk.

#import "NNCefInternal.h"

#import <AppKit/AppKit.h>

#include "include/cef_cookie.h"
#include "include/cef_image.h"
#include "include/cef_urlrequest.h"

using namespace nn;

namespace {

constexpr int kFaviconSize = 32;
constexpr size_t kMaxBytes = 2 * 1024 * 1024;

NSDictionary *Store(NSData *png, int width, int height) {
  if (!png.length) return nil;
  NSString *uri = [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
  return @{@"uri" : uri, @"width" : @(width), @"height" : @(height)};
}

NSData *PNGFromData(NSData *data, int pixels, int *width, int *height) {
  NSImage *image = data.length ? [[NSImage alloc] initWithData:data] : nil;
  if (!image || image.size.width <= 0 || image.size.height <= 0) return nil;
  NSImageRep *best = nil;
  NSInteger bestSize = 0;
  for (NSImageRep *rep in image.representations) {
    NSInteger size = MAX(rep.pixelsWide, rep.pixelsHigh);
    if (size <= 0) size = NSIntegerMax;
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
  explicit DownloadCallback(void (^completion)(NSDictionary *)) : completion_([completion copy]) {}
  void OnDownloadImageFinished(const CefString &image_url, int http_status_code, CefRefPtr<CefImage> image) override {
    NSDictionary *result = nil;
    if (image && !image->IsEmpty()) {
      int width = 0, height = 0;
      CefRefPtr<CefBinaryValue> png = image->GetAsPNG(2, true, width, height);
      if (png && png->GetSize()) {
        NSMutableData *data = [NSMutableData dataWithLength:png->GetSize()];
        png->GetData(data.mutableBytes, data.length, 0);
        result = Store(data, width, height);
      }
    }
    completion_(result);
  }

 private:
  void (^completion_)(NSDictionary *);
  IMPLEMENT_REFCOUNTING(DownloadCallback);
};

class FetchClient : public CefURLRequestClient {
 public:
  explicit FetchClient(void (^completion)(NSDictionary *)) : completion_([completion copy]), data_([NSMutableData data]) {}
  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    NSDictionary *result = nil;
    CefRefPtr<CefResponse> response = request->GetResponse();
    int status = response ? response->GetStatus() : 0;
    if (request->GetRequestStatus() == UR_SUCCESS && status >= 200 && status < 300 && !truncated_) {
      int width = 0, height = 0;
      NSData *png = PNGFromData(data_, kFaviconSize * 2, &width, &height);
      result = Store(png, width, height);
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
  void (^completion_)(NSDictionary *);
  NSMutableData *data_;
  bool truncated_ = false;
  IMPLEMENT_REFCOUNTING(FetchClient);
};

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

}

namespace nn {

void DownloadFavicon(CefRefPtr<CefBrowser> browser, NSString *url, void (^completion)(NSDictionary *)) {
  if (!browser || !url.length) return completion(nil);
  browser->GetHost()->DownloadImage(ToCef(url), true, kFaviconSize, false, new DownloadCallback(completion));
}

void DownloadImage(CefRefPtr<CefBrowser> browser, NSString *url, int maxPixels, void (^completion)(NSDictionary *)) {
  if (!browser || !url.length) return completion(nil);
  browser->GetHost()->DownloadImage(ToCef(url), true, MAX(16, MIN(maxPixels, 1024)), false, new DownloadCallback(completion));
}

}

@implementation NNFavicons

+ (void)fetch:(NSString *)url profile:(NSString *)profile completion:(void (^)(NSDictionary<NSString *, id> *_Nullable))completion {
  NSString *scheme = [NSURL URLWithString:url].scheme.lowercaseString;
  if (IsIncognito(profile) || !([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"])) return completion(nil);
  CefRefPtr<CefRequest> request = CefRequest::Create();
  request->SetURL(ToCef(url));
  request->SetMethod("GET");
// Favicon requests must omit cookies.
  request->SetFlags(UR_FLAG_NONE);
  CefURLRequest::Create(request, new FetchClient(completion), ContextForProfile(profile));
}

// Before Chrome's FaviconService held them, icons were PNG files in each profile's "Netnyahoo Favicons".
+ (void)removeLegacyFilesForProfile:(NSString *)profile {
  if (IsIncognito(profile)) return;
  [[NSFileManager defaultManager] removeItemAtPath:[ProfileDirectory(profile) stringByAppendingPathComponent:@"Netnyahoo Favicons"] error:nil];
}

@end

@implementation NNBrowsingData

+ (void)deleteCookiesForProfile:(NSString *)profile since:(double)sinceMs completion:(void (^)(NSInteger))completion {
  CefRefPtr<CefCookieManager> cookies = ContextForProfile(profile)->GetCookieManager(nullptr);
  double ageMs = MAX(0, NSDate.date.timeIntervalSince1970 * 1000 - sinceMs);
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
