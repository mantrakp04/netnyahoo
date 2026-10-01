// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_site_settings.h"

#include <optional>
#include <set>
#include <string>
#include <string_view>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/content_settings/host_content_settings_map_factory.h"
#include "components/content_settings/core/browser/content_settings_info.h"
#include "components/content_settings/core/browser/content_settings_observer.h"
#include "components/content_settings/core/browser/content_settings_registry.h"
#include "components/content_settings/core/browser/content_settings_type_set.h"
#include "components/content_settings/core/browser/host_content_settings_map.h"
#include "components/content_settings/core/common/content_settings.h"
#include "components/content_settings/core/common/content_settings_pattern.h"
#include "components/content_settings/core/common/content_settings_types.h"
#include "content/public/browser/storage_partition.h"
#include "services/network/public/mojom/cookie_manager.mojom.h"
#include "third_party/blink/public/common/storage_key/storage_key.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace netnyahoo {
namespace {

struct SettingType {
  const char* name;
  ContentSettingsType type;
};

// The JS names, as CEF maps them (NNSiteSettings.mm kTypes).
constexpr SettingType kTypes[] = {
    {"popups", ContentSettingsType::POPUPS},
    {"camera", ContentSettingsType::MEDIASTREAM_CAMERA},
    {"microphone", ContentSettingsType::MEDIASTREAM_MIC},
    {"location", ContentSettingsType::GEOLOCATION},
    {"notifications", ContentSettingsType::NOTIFICATIONS},
    {"sound", ContentSettingsType::SOUND},
    {"autoplay", ContentSettingsType::AUTOPLAY},
    {"javascript", ContentSettingsType::JAVASCRIPT},
    {"images", ContentSettingsType::IMAGES},
    {"clipboard", ContentSettingsType::CLIPBOARD_READ_WRITE},
    {"automaticDownloads", ContentSettingsType::AUTOMATIC_DOWNLOADS},
    {"cookies", ContentSettingsType::COOKIES},
    {"midi", ContentSettingsType::MIDI_SYSEX},
    {"sensors", ContentSettingsType::SENSORS},
    {"windowManagement", ContentSettingsType::WINDOW_MANAGEMENT},
    {"localFonts", ContentSettingsType::LOCAL_FONTS},
    {"idleDetection", ContentSettingsType::IDLE_DETECTION},
    {"storageAccess", ContentSettingsType::STORAGE_ACCESS},
    {"fileSystem", ContentSettingsType::FILE_SYSTEM_WRITE_GUARD},
    {"keyboardLock", ContentSettingsType::KEYBOARD_LOCK},
    {"pointerLock", ContentSettingsType::POINTER_LOCK},
    {"cameraPanTiltZoom", ContentSettingsType::CAMERA_PAN_TILT_ZOOM},
};

const SettingType* TypeNamed(std::string_view name) {
  for (const SettingType& type : kTypes) {
    if (name == type.name) {
      return &type;
    }
  }
  return nullptr;
}

const char* NameOf(ContentSettingsType type) {
  for (const SettingType& entry : kTypes) {
    if (entry.type == type) {
      return entry.name;
    }
  }
  return nullptr;
}

const char* ValueName(ContentSetting value) {
  switch (value) {
    case CONTENT_SETTING_ALLOW:
    case CONTENT_SETTING_SESSION_ONLY:
      return "allow";
    case CONTENT_SETTING_BLOCK:
      return "block";
    case CONTENT_SETTING_ASK:
      return "ask";
    default:
      return "default";
  }
}

std::optional<ContentSetting> ValueNamed(std::string_view name) {
  if (name == "allow") {
    return CONTENT_SETTING_ALLOW;
  }
  if (name == "block") {
    return CONTENT_SETTING_BLOCK;
  }
  if (name == "ask") {
    return CONTENT_SETTING_ASK;
  }
  if (name == "default") {
    return CONTENT_SETTING_DEFAULT;
  }
  return std::nullopt;
}

// The site's http(s) origin ("https://a.com", "http://b.com:8080"), or an
// invalid GURL.
GURL SiteOf(std::string_view spec) {
  GURL url(spec);
  if (!url.is_valid() || !url.SchemeIsHTTPOrHTTPS() || url.host().empty()) {
    return GURL();
  }
  return url::Origin::Create(url).GetURL();
}

std::string Serialize(const GURL& site) {
  return url::Origin::Create(site).Serialize();
}

// The one origin a user exception's primary pattern names, as CEF reads the
// exceptions pref (OriginOfPattern); "" for a wider pattern.
std::string OriginOfPattern(const ContentSettingsPattern& pattern) {
  const std::string spec = pattern.ToString();
  if (spec.find('*') != std::string::npos) {
    return std::string();
  }
  const GURL site = SiteOf(spec);
  return site.is_valid() ? Serialize(site) : std::string();
}

bool Registered(ContentSettingsType type) {
  return content_settings::ContentSettingsRegistry::GetInstance()->Get(type) !=
         nullptr;
}

HostContentSettingsMap* MapFor(Profile* profile) {
  return HostContentSettingsMapFactory::GetForProfile(profile);
}

// The origins with a user exception for |type|.
std::set<std::string> ExceptionOrigins(HostContentSettingsMap* map,
                                       ContentSettingsType type) {
  std::set<std::string> origins;
  if (!Registered(type)) {
    return origins;
  }
  for (const ContentSettingPatternSource& rule :
       map->GetSettingsForOneType(type)) {
    if (rule.source != content_settings::mojom::ProviderType::kPrefProvider ||
        rule.incognito) {
      continue;
    }
    std::string origin = OriginOfPattern(rule.primary_pattern);
    if (!origin.empty()) {
      origins.insert(std::move(origin));
    }
  }
  return origins;
}

// Tells the app about content setting changes in the profile.
class SiteSettingsState : public ProfileState,
                          public content_settings::Observer {
 public:
  explicit SiteSettingsState(Profile* profile) : ProfileState(profile) {
    observation_.Observe(MapFor(profile));
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    observation_.Reset();
  }

  void OnContentSettingChanged(
      const ContentSettingsPattern& primary_pattern,
      const ContentSettingsPattern& secondary_pattern,
      ContentSettingsTypeSet content_type_set) override {
    base::Value type;
    if (!content_type_set.ContainsAllTypes()) {
      const char* name = NameOf(content_type_set.GetType());
      if (!name) {
        return;
      }
      type = base::Value(name);
    }
    const std::string origin = OriginOfPattern(primary_pattern);
    // After Chrome's notification unwinds, so the app's handler can't
    // re-enter HostContentSettingsMap mid-notification.
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE,
        base::BindOnce(
            [](base::WeakPtr<SiteSettingsState> state,
               base::DictValue payload) {
              if (state) {
                Emit("siteSettings.changed", state->profile(),
                     std::move(payload));
              }
            },
            weak_factory_.GetWeakPtr(),
            base::DictValue()
                .Set("origin",
                     origin.empty() ? base::Value() : base::Value(origin))
                .Set("type", std::move(type))));
  }

  base::ScopedObservation<HostContentSettingsMap, content_settings::Observer>
      observation_{this};
  base::WeakPtrFactory<SiteSettingsState> weak_factory_{this};
};

// The call's site, or replies with an error.
GURL SiteFor(Call& call) {
  GURL site = SiteOf(call.String("origin"));
  if (!site.is_valid()) {
    call.TakeReply().Error("origin must be an http(s) origin");
  }
  return site;
}

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_site_settings_get) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::SiteSettingsState>(call.profile());
  const GURL site = netnyahoo::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  HostContentSettingsMap* map = netnyahoo::MapFor(call.profile());
  const std::string origin = netnyahoo::Serialize(site);
  base::DictValue settings;
  for (const netnyahoo::SettingType& type : netnyahoo::kTypes) {
    if (!netnyahoo::Registered(type.type)) {
      continue;
    }
    settings.Set(
        type.name,
        base::DictValue()
            .Set("value", netnyahoo::ValueName(
                              map->GetContentSetting(site, site, type.type)))
            .Set("isDefault",
                 !netnyahoo::ExceptionOrigins(map, type.type).contains(origin)));
  }
  call.TakeReply().Send(base::DictValue().Set("settings", std::move(settings)));
}

NN_ENGINE_CALL(nn_site_settings_set) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::SiteSettingsState>(call.profile());
  const GURL site = netnyahoo::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  const netnyahoo::SettingType* type =
      netnyahoo::TypeNamed(call.String("type"));
  if (!type) {
    return call.TakeReply().Error("unknown type");
  }
  const std::optional<ContentSetting> value =
      netnyahoo::ValueNamed(call.String("value"));
  if (!value) {
    return call.TakeReply().Error("unknown value");
  }
  const content_settings::ContentSettingsInfo* info =
      content_settings::ContentSettingsRegistry::GetInstance()->Get(
          type->type);
  if (!info) {
    return call.TakeReply().Error("type not available");
  }
  if (*value != CONTENT_SETTING_DEFAULT && !info->IsSettingValid(*value)) {
    return call.TakeReply().Error("value not valid for type");
  }
  netnyahoo::MapFor(call.profile())
      ->SetContentSettingDefaultScope(site, site, type->type, *value);
  call.TakeReply().Ok();
}

NN_ENGINE_CALL(nn_site_settings_reset) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::SiteSettingsState>(call.profile());
  const GURL site = netnyahoo::SiteFor(call);
  if (!site.is_valid()) {
    return;
  }
  HostContentSettingsMap* map = netnyahoo::MapFor(call.profile());
  for (const netnyahoo::SettingType& type : netnyahoo::kTypes) {
    if (netnyahoo::Registered(type.type)) {
      map->SetContentSettingDefaultScope(site, site, type.type,
                                         CONTENT_SETTING_DEFAULT);
    }
  }
  call.TakeReply().Ok();
}

NN_ENGINE_CALL(nn_site_settings_origins) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  netnyahoo::StateFor<netnyahoo::SiteSettingsState>(call.profile());
  HostContentSettingsMap* map = netnyahoo::MapFor(call.profile());
  std::set<std::string> origins;
  for (const netnyahoo::SettingType& type : netnyahoo::kTypes) {
    origins.merge(netnyahoo::ExceptionOrigins(map, type.type));
  }
  base::ListValue list;
  for (const std::string& origin : origins) {
    list.Append(origin);
  }
  call.TakeReply().Send(base::DictValue().Set("origins", std::move(list)));
}

NN_ENGINE_CALL(nn_site_data_clear) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  const GURL site = netnyahoo::SiteOf(call.String("origin"));
  if (!site.is_valid()) {
    return call.TakeReply().Send(
        base::DictValue().Set("cookies", false).Set("storage", false));
  }
  content::StoragePartition* partition =
      call.profile()->GetDefaultStoragePartition();
  // As CEF: the host's cookies (CefCookieManager::DeleteCookies(url, "")),
  // then the origin's storage (DevTools' Storage.clearDataForOrigin "all").
  auto filter = network::mojom::CookieDeletionFilter::New();
  filter->host_name = site.host();
  partition->GetCookieManagerForBrowserProcess()->DeleteCookies(
      std::move(filter),
      base::BindOnce(
          [](netnyahoo::Reply reply, base::WeakPtr<Profile> profile, GURL site,
             uint32_t deleted) {
            if (!profile) {
              return reply.Send(base::DictValue()
                                    .Set("cookies", static_cast<int>(deleted))
                                    .Set("storage", false));
            }
            profile->GetDefaultStoragePartition()->ClearData(
                content::StoragePartition::REMOVE_DATA_MASK_ALL,
                blink::StorageKey::CreateFirstParty(url::Origin::Create(site)),
                base::Time(), base::Time::Max(),
                base::BindOnce(
                    [](netnyahoo::Reply reply, uint32_t deleted) {
                      reply.Send(base::DictValue()
                                     .Set("cookies", static_cast<int>(deleted))
                                     .Set("storage", true));
                    },
                    std::move(reply), deleted));
          },
          call.TakeReply(), call.profile()->GetWeakPtr(), site));
}
