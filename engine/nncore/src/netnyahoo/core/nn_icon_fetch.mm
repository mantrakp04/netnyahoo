// -[NNCoreProfile fetchIcon:maxBytes:completion:]: an icon the host wants without a tab (a
// restored or unloaded tab's, a bookmark's, a history row's), fetched through the profile's own
// network stack as Chrome's ImageDataFetcher fetches icons (components/image_fetcher): its proxy,
// its cache (an off-the-record profile's in memory), no cookies or credentials, a 200 only, a
// size cap and a time-out. Only what Chrome would decode as a favicon comes back.

#import "netnyahoo/core/public/NNCore.h"

#include <algorithm>
#include <cstdint>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "base/functional/bind.h"
#include "base/scoped_observation.h"
#include "base/strings/sys_string_conversions.h"
#include "base/time/time.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "content/public/browser/storage_partition.h"
#include "net/base/mime_sniffer.h"
#include "net/base/net_errors.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "netnyahoo/core/nncore_internal.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/shared_url_loader_factory.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/url_response_head.mojom.h"
#include "third_party/blink/public/common/mime_util/mime_util.h"
#include "url/gurl.h"

namespace {

// ImageDataFetcher's kDownloadTimeoutSeconds.
constexpr base::TimeDelta kTimeout = base::Seconds(30);

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("netnyahoo_icon_fetch", R"(
      semantics {
        sender: "Netnyahoo favicons"
        description:
          "Downloads the favicon of a page the browser shows without a live "
          "tab (a restored or unloaded tab, a bookmark, a history entry)."
        trigger: "The sidebar, bookmarks or history list a page with no icon."
        data: "None: no cookies or credentials are sent."
        destination: WEBSITE
      }
      policy {
        cookies_allowed: NO
        setting: "None."
        policy_exception_justification: "Not implemented."
      })");

// An ISO-BMFF File Type Box naming AVIF among its brands (blink's
// AVIFImageDecoder::MatchesAVIFSignature; net's sniffer calls any "ftyp" video/mp4).
bool IsAvif(std::string_view body) {
  if (body.size() < 16 || body.substr(4, 4) != "ftyp") {
    return false;
  }
  const size_t box = std::min<size_t>(
      body.size(), (size_t{static_cast<uint8_t>(body[0])} << 24) |
                       (size_t{static_cast<uint8_t>(body[1])} << 16) |
                       (size_t{static_cast<uint8_t>(body[2])} << 8) |
                       size_t{static_cast<uint8_t>(body[3])});
  // The major brand, then (past the minor version) the compatible ones.
  for (size_t at = 8; at + 4 <= box; at += at == 8 ? 8 : 4) {
    const std::string_view brand = body.substr(at, 4);
    if (brand == "avif" || brand == "avis") {
      return true;
    }
  }
  return false;
}

// What Chrome decodes as a favicon (blink's ImageDecoder::SniffMimeType): a raster format
// sniffed from the bytes, whatever the server calls it (.ico served as text/plain works), or
// SVG when the response says image/svg+xml (blink's ImageDownloaderImpl). Anything else (a
// PDF, a TIFF, an HTML error page) never reaches the host's decoder.
bool IsIconBody(std::string_view body, const std::string& mime_type) {
  if (body.empty()) {
    return false;
  }
  if (mime_type == "image/svg+xml") {
    return true;
  }
  if (IsAvif(body)) {
    return blink::IsSupportedImageMimeType("image/avif");
  }
  // A cursor (blink decodes .cur as ICO); net's sniffer only knows the icon signature.
  if (body.starts_with(std::string_view("\x00\x00\x02\x00", 4))) {
    return true;
  }
  std::string sniffed;
  return net::SniffMimeTypeFromLocalData(body, &sniffed) &&
         (sniffed == "image/png" || sniffed == "image/jpeg" ||
          sniffed == "image/gif" || sniffed == "image/webp" ||
          sniffed == "image/x-icon" || sniffed == "image/bmp");
}

// One fetch. Owns itself: deleted when it finishes, or when its profile goes first (that
// cancels the request; the host hears nil). The host's block always runs later on the main
// thread, never inside a Chrome callback or the profile's teardown; at shutdown the run loop
// may stop first, and then it never runs.
class IconFetch : public ProfileObserver {
 public:
  static void Start(Profile* profile,
                    const GURL& url,
                    size_t max_bytes,
                    void (^completion)(NSData* _Nullable)) {
    (new IconFetch(profile, completion))->Load(profile, url, max_bytes);
  }

  IconFetch(const IconFetch&) = delete;
  IconFetch& operator=(const IconFetch&) = delete;

 private:
  IconFetch(Profile* profile, void (^completion)(NSData* _Nullable))
      : completion_(completion) {
    observation_.Observe(profile);
  }
  ~IconFetch() override = default;

  void Load(Profile* profile, const GURL& url, size_t max_bytes) {
    auto request = std::make_unique<network::ResourceRequest>();
    request->url = url;
    request->method = "GET";
    request->credentials_mode = network::mojom::CredentialsMode::kOmit;
    request->destination = network::mojom::RequestDestination::kImage;
    loader_ = network::SimpleURLLoader::Create(std::move(request),
                                               kTrafficAnnotation);
    loader_->SetTimeoutDuration(kTimeout);
    // Unretained: loader_ is ours, and deleting it cancels the callback.
    loader_->DownloadToString(
        profile->GetDefaultStoragePartition()
            ->GetURLLoaderFactoryForBrowserProcess()
            .get(),
        base::BindOnce(&IconFetch::OnLoaded, base::Unretained(this)),
        max_bytes);
  }

  void OnLoaded(std::optional<std::string> body) {
    const network::mojom::URLResponseHead* head = loader_->ResponseInfo();
    const bool ok = loader_->NetError() == net::OK && body && head &&
                    head->headers && head->headers->response_code() == 200 &&
                    IsIconBody(*body, head->mime_type);
    Finish(ok ? [NSData dataWithBytes:body->data() length:body->size()] : nil);
  }

  void OnProfileWillBeDestroyed(Profile* profile) override { Finish(nil); }

  void Finish(NSData* _Nullable data) {
    void (^completion)(NSData* _Nullable) = completion_;
    delete this;
    dispatch_async(dispatch_get_main_queue(), ^{
      completion(data);
    });
  }

  void (^completion_)(NSData* _Nullable);
  std::unique_ptr<network::SimpleURLLoader> loader_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

}  // namespace

@implementation NNCoreProfile (Icons)

- (void)fetchIcon:(NSString*)url
         maxBytes:(NSUInteger)maxBytes
       completion:(void (^)(NSData* _Nullable body))completion {
  const GURL target(base::SysNSStringToUTF8(url ?: @""));
  Profile* profile = self.chromeProfile;
  if (!profile || nncore::IsProfileDying(profile) ||
      !target.SchemeIsHTTPOrHTTPS() || maxBytes == 0) {
    dispatch_async(dispatch_get_main_queue(), ^{
      completion(nil);
    });
    return;
  }
  IconFetch::Start(
      profile, target,
      std::min<size_t>(maxBytes,
                       network::SimpleURLLoader::kMaxBoundedStringDownloadSize),
      completion);
}

@end
