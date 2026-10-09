#include "arcadia/core/ac_navigation_hold.h"

#import <Foundation/Foundation.h>

#include <map>
#include <memory>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/web_contents.h"
#include "extensions/browser/api/declarative_net_request/rules_monitor_service.h"
#include "extensions/browser/api/declarative_net_request/ruleset_manager.h"
#include "content/public/common/url_constants.h"
#include "extensions/common/constants.h"
#include "extensions/common/extension_id.h"
#include "url/gurl.h"
#include "url/url_constants.h"

// The hook at the end of RulesMonitorService's initial ruleset load (engine/arcadiacore/apply.sh).
extern void (*g_arcadia_dnr_rulesets_in_force)(
    content::BrowserContext* browser_context,
    const extensions::ExtensionId& extension_id,
    bool all_loaded);

namespace arcadiacore {

namespace {

// waits-for: the extension's rulesets in force in the profile (RulesMonitorService's initial load,
//            g_arcadia_dnr_rulesets_in_force), or the host's ReleaseNavigationHold
// on-timeout: logs an error and lets the profile's pages load without the extension's rules
constexpr base::TimeDelta kDeadline = base::Seconds(10);

class HoldThrottle;

// One held profile. Gone once released, or with its profile.
class Hold : public ProfileObserver {
 public:
  Hold(Profile* profile, std::string extension_id);
  ~Hold() override;

  void Defer(base::WeakPtr<HoldThrottle> throttle) {
    if (throttles_.empty()) {
      first_deferred_ = base::TimeTicks::Now();
    }
    throttles_.push_back(std::move(throttle));
  }
  const std::string& extension_id() const { return extension_id_; }

  // Resumes what it holds and goes. `in_force`: the rulesets are (all of them unless `why` says
  // which aren't); else `why` they aren't.
  void Release(bool in_force, const std::string& why);

  // ProfileObserver:
  void OnProfileWillBeDestroyed(Profile* profile) override;

 private:
  raw_ptr<Profile> profile_;
  const std::string extension_id_;
  const base::TimeTicks since_ = base::TimeTicks::Now();
  base::TimeTicks first_deferred_;
  std::vector<base::WeakPtr<HoldThrottle>> throttles_;
  base::OneShotTimer deadline_;
  base::ScopedObservation<Profile, ProfileObserver> observation_{this};
};

// Held profiles, by original profile.
std::map<Profile*, std::unique_ptr<Hold>>& Holds() {
  static base::NoDestructor<std::map<Profile*, std::unique_ptr<Hold>>> holds;
  return *holds;
}

Hold* HoldFor(content::BrowserContext* context) {
  if (Holds().empty() || !context) {
    return nullptr;
  }
  auto it = Holds().find(Profile::FromBrowserContext(context)->GetOriginalProfile());
  return it == Holds().end() ? nullptr : it->second.get();
}

// Every document that can make a request (http(s), file:, data:, blob:…). Never the browser's own
// pages: the extension's (the host drives the content blocker from one), Chrome's WebUI, about:.
bool IsHeld(const GURL& url) {
  return !url.SchemeIs(extensions::kExtensionScheme) && !url.SchemeIs(content::kChromeUIScheme) &&
         !url.SchemeIs(content::kChromeUIUntrustedScheme) &&
         !url.SchemeIs(content::kChromeDevToolsScheme) && !url.SchemeIs(url::kAboutScheme);
}

class HoldThrottle : public content::NavigationThrottle {
 public:
  explicit HoldThrottle(content::NavigationThrottleRegistry& registry)
      : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillStartRequest() override {
    Hold* hold = HoldFor(navigation_handle()->GetWebContents()->GetBrowserContext());
    if (!hold || !IsHeld(navigation_handle()->GetURL())) {
      return PROCEED;
    }
    hold->Defer(weak_factory_.GetWeakPtr());
    return DEFER;
  }
  const char* GetNameForLogging() override { return "ACNavigationHoldThrottle"; }

  void ResumeHeld() { Resume(); }

 private:
  base::WeakPtrFactory<HoldThrottle> weak_factory_{this};
};

Hold::Hold(Profile* profile, std::string extension_id)
    : profile_(profile), extension_id_(std::move(extension_id)) {
  observation_.Observe(profile);
  deadline_.Start(FROM_HERE, kDeadline,
                  base::BindOnce(&Hold::Release, base::Unretained(this), false,
                                 std::string("timed out")));
}

Hold::~Hold() = default;

void Hold::Release(bool in_force, const std::string& why) {
  auto it = Holds().find(profile_);
  CHECK(it != Holds().end() && it->second.get() == this);
  std::unique_ptr<Hold> self = std::move(it->second);
  Holds().erase(it);
  const int64_t ms = (base::TimeTicks::Now() - since_).InMilliseconds();
  if (!in_force) {
    LOG(ERROR) << "ArcadiaCore: navigation hold for " << extension_id_
               << "'s rulesets ended without them (" << why << ") after " << ms
               << " ms; " << throttles_.size()
               << " held navigations go ahead without its rules";
  } else if (!why.empty()) {
    LOG(ERROR) << "ArcadiaCore: " << extension_id_ << "'s rulesets in force after " << ms
               << " ms, but " << why << "; " << throttles_.size()
               << " held navigations go ahead without those rules";
  } else if (throttles_.empty()) {
    // What the hold cost (LOG(INFO) never reaches the host's log): here nothing.
    NSLog(@"[arcadiacore] %s's rulesets in force %lld ms after the hold began; no navigation waited",
          extension_id_.c_str(), ms);
  } else {
    // Here how long the first page waited.
    NSLog(@"[arcadiacore] held %zu navigations for %s's rulesets, the first %lld ms (in force %lld ms "
          @"after the hold began)",
          throttles_.size(), extension_id_.c_str(),
          (base::TimeTicks::Now() - first_deferred_).InMilliseconds(), ms);
  }
  // Each resumes in its own task: never inside RulesMonitorService's load, or this release.
  for (base::WeakPtr<HoldThrottle>& throttle : throttles_) {
    base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&HoldThrottle::ResumeHeld, std::move(throttle)));
  }
}

void Hold::OnProfileWillBeDestroyed(Profile* profile) {
  // Its navigations go with it.
  Holds().erase(profile_);
}

void OnRulesetsInForce(content::BrowserContext* context,
                       const extensions::ExtensionId& extension_id,
                       bool all_loaded) {
  Hold* hold = HoldFor(context);
  if (hold && hold->extension_id() == extension_id) {
    hold->Release(true, all_loaded ? "" : "some failed to load or went over the rule limit");
  }
}

}  // namespace

void HoldNavigationsForRulesets(Profile* profile, const std::string& extension_id) {
  g_arcadia_dnr_rulesets_in_force = &OnRulesetsInForce;
  Profile* original = profile->GetOriginalProfile();
  if (Holds().contains(original)) {
    return;
  }
  auto* rules =
      extensions::declarative_net_request::RulesMonitorService::Get(original);
  if (!rules) {
    return;  // A profile without extensions.
  }
  if (rules->ruleset_manager()->GetMatcherForExtension(extension_id)) {
    return;  // In force already.
  }
  Holds()[original] = std::make_unique<Hold>(original, extension_id);
}

void ReleaseNavigationHold(Profile* profile, const std::string& reason) {
  if (Hold* hold = HoldFor(profile)) {
    hold->Release(false, reason);
  }
}

void MaybeAddNavigationHoldThrottle(content::NavigationThrottleRegistry& registry) {
  content::WebContents* contents = registry.GetNavigationHandle().GetWebContents();
  if (contents && HoldFor(contents->GetBrowserContext())) {
    registry.AddThrottle(std::make_unique<HoldThrottle>(registry));
  }
}

}  // namespace arcadiacore
