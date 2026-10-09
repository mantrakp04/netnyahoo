// Copyright 2026 Arcadia. Apache-2.0.
//
// Favicons: Chrome's FaviconService is the one store. Chrome saves a page's
// icon itself when the page shows it (ContentFaviconDriver), and drops it with
// the page's history; the app asks for icons by page and keeps only an
// in-memory cache.
//
//   ac_favicons_get({pages: [url…], icons: [url…], size})
//     -> {pages: {url: {png, icon}}, icons: {url: {png}}}: base64 PNGs at about
//        |size| pixels. A page with no icon of its own falls back to its host's
//        (Chrome's fallback_to_host); one with none at all is left out. |icons|
//        asks by icon URL (the app's light/dark pick).
//   ac_favicons_set({page, icon, png}) -> {ok}: an icon fetched for a page that
//        was never visited (an imported bookmark), stored as Chrome stores
//        on-demand icons: only if the page has none, and expiring unless used.

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "base/barrier_closure.h"
#include "base/base64.h"
#include "base/memory/ref_counted_memory.h"
#include "base/no_destructor.h"
#include "base/task/cancelable_task_tracker.h"
#include "chrome/browser/favicon/favicon_service_factory.h"
#include "chrome/browser/arcadia/ac_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "components/favicon/core/favicon_service.h"
#include "components/favicon_base/favicon_types.h"
#include "components/keyed_service/core/service_access_type.h"
#include "ui/gfx/image/image.h"
#include "url/gurl.h"

namespace arcadia {

namespace {

const base::ListValue& EmptyList() {
  static base::NoDestructor<base::ListValue> empty;
  return *empty;
}

constexpr int kDefaultSize = 32;
constexpr size_t kMaxPerCall = 500;

base::CancelableTaskTracker& Tracker() {
  static base::NoDestructor<base::CancelableTaskTracker> tracker;
  return *tracker;
}

favicon::FaviconService* FaviconsFor(Profile* profile) {
  return profile && !profile->IsOffTheRecord()
             ? FaviconServiceFactory::GetForProfile(
                   profile, ServiceAccessType::EXPLICIT_ACCESS)
             : nullptr;
}

std::vector<std::string> Strings(const base::ListValue* list) {
  std::vector<std::string> out;
  for (const base::Value& value : list ? *list : EmptyList()) {
    if (value.is_string() && out.size() < kMaxPerCall) {
      out.push_back(value.GetString());
    }
  }
  return out;
}

// The results of one call, filled by its lookups; replies when the last ends.
struct Results {
  explicit Results(Reply reply) : reply(std::move(reply)) {}
  Reply reply;
  base::DictValue pages;
  base::DictValue icons;
};

std::string Png(const favicon_base::FaviconRawBitmapResult& result) {
  return base::Base64Encode(*result.bitmap_data);
}

}  // namespace

}  // namespace arcadia

using arcadia::Call;
using arcadia::Reply;

AC_ENGINE_CALL(ac_favicons_get) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  favicon::FaviconService* service = arcadia::FaviconsFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no favicons");
  }
  const int size = static_cast<int>(call.Double("size", arcadia::kDefaultSize));
  std::vector<std::string> pages = arcadia::Strings(call.args().FindList("pages"));
  std::vector<std::string> icons = arcadia::Strings(call.args().FindList("icons"));
  auto results = std::make_shared<arcadia::Results>(call.TakeReply());
  base::RepeatingClosure done = base::BarrierClosure(
      pages.size() + icons.size(), base::BindOnce(
                                       [](std::shared_ptr<arcadia::Results> r) {
                                         r->reply.Send(
                                             base::DictValue()
                                                 .Set("pages", std::move(r->pages))
                                                 .Set("icons", std::move(r->icons)));
                                       },
                                       results));
  for (const std::string& page : pages) {
    service->GetRawFaviconForPageURL(
        GURL(page), {favicon_base::IconType::kFavicon}, size,
        /*fallback_to_host=*/true,
        base::BindOnce(
            [](std::shared_ptr<arcadia::Results> r, std::string page,
               base::RepeatingClosure done,
               const favicon_base::FaviconRawBitmapResult& result) {
              if (result.is_valid()) {
                r->pages.Set(page, base::DictValue()
                                       .Set("png", arcadia::Png(result))
                                       .Set("icon", result.icon_url.spec()));
              }
              done.Run();
            },
            results, page, done),
        &arcadia::Tracker());
  }
  for (const std::string& icon : icons) {
    service->GetRawFavicon(
        GURL(icon), favicon_base::IconType::kFavicon, size,
        base::BindOnce(
            [](std::shared_ptr<arcadia::Results> r, std::string icon,
               base::RepeatingClosure done,
               const favicon_base::FaviconRawBitmapResult& result) {
              if (result.is_valid()) {
                r->icons.Set(icon, base::DictValue().Set(
                                       "png", arcadia::Png(result)));
              }
              done.Run();
            },
            results, icon, done),
        &arcadia::Tracker());
  }
}

AC_ENGINE_CALL(ac_favicons_set) {
  Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  favicon::FaviconService* service = arcadia::FaviconsFor(call.profile());
  if (!service) {
    return call.TakeReply().Error("no favicons");
  }
  GURL page(call.String("page"));
  GURL icon(call.String("icon"));
  std::optional<std::vector<uint8_t>> png = base::Base64Decode(call.String("png"));
  if (!page.is_valid() || !icon.is_valid() || !png || png->empty()) {
    return call.TakeReply().Error("bad arguments");
  }
  gfx::Image image = gfx::Image::CreateFrom1xPNGBytes(*png);
  if (image.IsEmpty()) {
    return call.TakeReply().Error("not a PNG");
  }
  service->SetOnDemandFavicons(
      page, icon, favicon_base::IconType::kFavicon, image,
      base::BindOnce(
          [](Reply reply, bool stored) {
            reply.Send(base::DictValue().Set("stored", stored));
          },
          call.TakeReply()));
}
