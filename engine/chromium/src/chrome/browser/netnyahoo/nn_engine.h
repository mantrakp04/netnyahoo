// Copyright 2026 Netnyahoo. Apache-2.0.
//
// What every nn_<domain>.cc shares: the export macro, profile lookup, JSON
// arguments, the reply and the event sink (public/nn_engine.h has the rules).

#ifndef CHROME_BROWSER_NETNYAHOO_NN_ENGINE_H_
#define CHROME_BROWSER_NETNYAHOO_NN_ENGINE_H_

#include <memory>
#include <string>
#include <string_view>

#include "base/memory/raw_ptr.h"
#include "base/scoped_observation.h"
#include "base/supports_user_data.h"
#include "base/values.h"
#include "chrome/browser/netnyahoo/public/nn_engine.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"

// Defines an exported call: NN_ENGINE_CALL(nn_zoom_list) { ... } with
// |profile_dir|, |args_json|, |reply| and |context| in scope.
#define NN_ENGINE_CALL(name)                                            \
  extern "C" NN_ENGINE_EXPORT void name(                                \
      const char* profile_dir, const char* args_json,                   \
      nn_engine_reply_t reply, void* context)

namespace netnyahoo {

// A call's reply. Move-only; sends once. One dropped unsent replies
// {"error": "no reply"}, so the app's completion always runs.
class Reply {
 public:
  Reply(nn_engine_reply_t reply, void* context);
  Reply(Reply&& other);
  Reply& operator=(Reply&& other);
  Reply(const Reply&) = delete;
  Reply& operator=(const Reply&) = delete;
  ~Reply();

  void Send(base::DictValue result);
  void Ok();  // {"ok": true}
  void Error(std::string_view message);

 private:
  nn_engine_reply_t reply_;
  void* context_;
};

// One call's inputs. Replies with an error at construction when the profile
// isn't loaded or the arguments aren't a JSON object; check it before use.
class Call {
 public:
  Call(const char* profile_dir,
       const char* args_json,
       nn_engine_reply_t reply,
       void* context);
  Call(const Call&) = delete;
  Call& operator=(const Call&) = delete;
  ~Call();

  explicit operator bool() const { return profile_ != nullptr; }
  Profile* profile() const { return profile_; }
  const base::DictValue& args() const { return args_; }
  // Arguments by key, with defaults for a missing or mistyped key.
  std::string String(std::string_view key) const;
  bool Bool(std::string_view key, bool fallback = false) const;
  double Double(std::string_view key, double fallback = 0) const;

  Reply TakeReply() { return std::move(reply_); }

 private:
  Profile* profile_ = nullptr;
  base::DictValue args_;
  Reply reply_;
};

// The loaded profile at |dir| (symlinks resolved), or nullptr.
Profile* ProfileAt(std::string_view dir);

// A domain's state for one profile (observers, held services), created on
// first use and kept for the profile's life. Release() runs before the
// profile's services shut down: drop everything that points into them there.
class ProfileState : public base::SupportsUserData::Data,
                     public ProfileObserver {
 public:
  explicit ProfileState(Profile* profile);
  ~ProfileState() override;

  Profile* profile() const { return profile_; }

 protected:
  virtual void Release() {}

 private:
  void OnProfileWillBeDestroyed(Profile* profile) override;

  raw_ptr<Profile> profile_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

// StateFor<T>(profile): the profile's T (a ProfileState with a T(Profile*)
// constructor), made on first use.
template <typename T>
T& StateFor(Profile* profile) {
  static const int kKey = 0;
  auto* state = static_cast<T*>(profile->GetUserData(&kKey));
  if (!state) {
    auto owned = std::make_unique<T>(profile);
    state = owned.get();
    profile->SetUserData(&kKey, std::move(owned));
  }
  return *state;
}

// Sends an event to the app's sink, if any. Adds "profile": the original
// (on-disk) profile's directory.
void Emit(std::string_view topic, Profile* profile, base::DictValue payload);

}  // namespace netnyahoo

#endif  // CHROME_BROWSER_NETNYAHOO_NN_ENGINE_H_
