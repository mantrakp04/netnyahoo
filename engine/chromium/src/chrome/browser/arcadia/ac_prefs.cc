// Copyright 2026 Arcadia. Apache-2.0.

#include "chrome/browser/arcadia/ac_prefs.h"

#include <cmath>
#include <optional>
#include <string>
#include <string_view>

#include "components/prefs/pref_service.h"

namespace arcadia {
namespace {

constexpr struct {
  const char* name;
  base::Value::Type type;
} kAllowed[] = {
    {"credentials_enable_service", base::Value::Type::BOOLEAN},
    {"autofill.profile_enabled", base::Value::Type::BOOLEAN},
    {"autofill.credit_card_enabled", base::Value::Type::BOOLEAN},
    {"session.restore_on_startup", base::Value::Type::INTEGER},
    {"download_bubble.partial_view_enabled", base::Value::Type::BOOLEAN},
    {"download.prompt_for_download", base::Value::Type::BOOLEAN},
};

// The allowed, registered pref the call names, or replies with an error.
const PrefService::Preference* PrefFor(Call& call) {
  const std::string name = call.String("name");
  for (const auto& allowed : kAllowed) {
    if (name != allowed.name) {
      continue;
    }
    const PrefService::Preference* pref =
        call.profile()->GetPrefs()->FindPreference(name);
    if (!pref || pref->GetType() != allowed.type) {
      call.TakeReply().Error("not registered");
      return nullptr;
    }
    return pref;
  }
  call.TakeReply().Error("not allowed");
  return nullptr;
}

}  // namespace
}  // namespace arcadia

AC_ENGINE_CALL(ac_prefs_get) {
  arcadia::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  if (const PrefService::Preference* pref = arcadia::PrefFor(call)) {
    call.TakeReply().Send(base::DictValue()
                              .Set("value", pref->GetValue()->Clone())
                              .Set("managed", pref->IsManaged()));
  }
}

AC_ENGINE_CALL(ac_prefs_set) {
  arcadia::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  const PrefService::Preference* pref = arcadia::PrefFor(call);
  if (!pref) {
    return;
  }
  const base::Value* value = call.args().Find("value");
  if (!value) {
    return call.TakeReply().Error("value required");
  }
  if (!pref->IsUserModifiable()) {
    return call.TakeReply().Error("managed");
  }
  PrefService* prefs = call.profile()->GetPrefs();
  if (pref->GetType() == base::Value::Type::INTEGER) {
    // JSON numbers may arrive as doubles.
    const std::optional<double> number = value->GetIfDouble();
    if (!number || !std::isfinite(*number) || *number != std::trunc(*number)) {
      return call.TakeReply().Error("value must be an integer");
    }
    prefs->SetInteger(pref->name(), static_cast<int>(*number));
  } else if (value->is_bool()) {
    prefs->SetBoolean(pref->name(), value->GetBool());
  } else {
    return call.TakeReply().Error("value must be a boolean");
  }
  call.TakeReply().Ok();
}
