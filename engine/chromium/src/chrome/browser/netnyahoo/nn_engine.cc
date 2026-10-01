// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_engine.h"

#include <limits.h>
#include <stdlib.h>

#include <optional>
#include <utility>

#include "base/files/file_path.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "content/public/browser/browser_thread.h"

namespace netnyahoo {

namespace {

nn_engine_event_t g_sink = nullptr;
void* g_sink_context = nullptr;

std::string ToJSON(const base::DictValue& dict) {
  return base::WriteJson(dict).value_or("{}");
}

}  // namespace

Reply::Reply(nn_engine_reply_t reply, void* context)
    : reply_(reply), context_(context) {}

Reply::Reply(Reply&& other)
    : reply_(std::exchange(other.reply_, nullptr)),
      context_(std::exchange(other.context_, nullptr)) {}

Reply& Reply::operator=(Reply&& other) {
  if (this != &other) {
    if (reply_) {
      Error("no reply");
    }
    reply_ = std::exchange(other.reply_, nullptr);
    context_ = std::exchange(other.context_, nullptr);
  }
  return *this;
}

Reply::~Reply() {
  if (reply_) {
    Error("no reply");
  }
}

void Reply::Send(base::DictValue result) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!reply_) {
    return;
  }
  nn_engine_reply_t reply = std::exchange(reply_, nullptr);
  void* context = std::exchange(context_, nullptr);
  reply(context, ToJSON(result).c_str());
}

void Reply::Ok() {
  Send(base::DictValue().Set("ok", true));
}

void Reply::Error(std::string_view message) {
  Send(base::DictValue().Set("error", message));
}

Call::Call(const char* profile_dir,
           const char* args_json,
           nn_engine_reply_t reply,
           void* context)
    : reply_(reply, context) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (args_json && *args_json) {
    std::optional<base::Value> parsed = base::JSONReader::Read(
        args_json, base::JSON_PARSE_CHROMIUM_EXTENSIONS);
    if (!parsed || !parsed->is_dict()) {
      reply_.Error("arguments are not a JSON object");
      return;
    }
    args_ = std::move(*parsed).TakeDict();
  }
  profile_ = ProfileAt(profile_dir ? profile_dir : "");
  if (!profile_) {
    reply_.Error("profile not loaded");
  }
}

Call::~Call() = default;

std::string Call::String(std::string_view key) const {
  const std::string* value = args_.FindString(key);
  return value ? *value : std::string();
}

bool Call::Bool(std::string_view key, bool fallback) const {
  return args_.FindBool(key).value_or(fallback);
}

double Call::Double(std::string_view key, double fallback) const {
  return args_.FindDouble(key).value_or(fallback);
}

ProfileState::ProfileState(Profile* profile) : profile_(profile) {
  observation_.Observe(profile);
}

ProfileState::~ProfileState() = default;

void ProfileState::OnProfileWillBeDestroyed(Profile* profile) {
  Release();
  observation_.Reset();
}

Profile* ProfileAt(std::string_view dir) {
  ProfileManager* manager =
      g_browser_process ? g_browser_process->profile_manager() : nullptr;
  if (!manager || dir.empty()) {
    return nullptr;
  }
  if (Profile* profile = manager->GetProfileByPath(base::FilePath(dir))) {
    return profile;
  }
  // The app and Chrome may spell the data directory differently (/tmp and
  // /private/tmp): compare real paths. realpath() is one syscall per profile.
  auto real = [](const base::FilePath& path) {
    char resolved[PATH_MAX];
    return realpath(path.value().c_str(), resolved) ? std::string(resolved)
                                                    : path.value();
  };
  const std::string wanted = real(base::FilePath(dir));
  for (Profile* profile : manager->GetLoadedProfiles()) {
    if (real(profile->GetPath()) == wanted) {
      return profile;
    }
  }
  return nullptr;
}

void Emit(std::string_view topic, Profile* profile, base::DictValue payload) {
  DCHECK_CURRENTLY_ON(content::BrowserThread::UI);
  if (!g_sink) {
    return;
  }
  if (profile) {
    payload.Set("profile", profile->GetOriginalProfile()->GetPath().value());
  }
  g_sink(g_sink_context, std::string(topic).c_str(), ToJSON(payload).c_str());
}

}  // namespace netnyahoo

extern "C" NN_ENGINE_EXPORT int nn_engine_abi_version() {
  return NN_ENGINE_ABI_VERSION;
}

extern "C" NN_ENGINE_EXPORT void nn_engine_set_event_sink(
    nn_engine_event_t sink,
    void* context) {
  netnyahoo::g_sink = sink;
  netnyahoo::g_sink_context = context;
}
