#ifndef ARCADIA_CORE_AC_NAVIGATION_HOLD_H_
#define ARCADIA_CORE_AC_NAVIGATION_HOLD_H_

#include <string>

class Profile;

namespace content {
class NavigationThrottleRegistry;
}

namespace arcadiacore {

// A profile's navigations held until an extension's declarativeNetRequest rulesets are in
// force there. Chrome reads an extension's rulesets from disk on another sequence after it loads
// the extension, and holds no request for them (UserScriptListener waits only for content
// scripts), so a profile's first pages could load before its content blocker's rules applied.

// Holds `profile`'s navigations to any document that can make a request (its off-the-record
// profiles' too) until the rulesets `extension_id` has when it loads are in force. A no-op when
// they already are, or while a hold is on. Requests that aren't a document's (a service worker's
// own, a prefetch) aren't held.
void HoldNavigationsForRulesets(Profile* profile, const std::string& extension_id);

// Ends `profile`'s hold now (the host couldn't load the extension), logged as an error with
// `reason`: its pages load without the extension's rules.
void ReleaseNavigationHold(Profile* profile, const std::string& reason);

// For CreateThrottlesForNavigation: adds the throttle that holds a navigation, only while its
// profile is held.
void MaybeAddNavigationHoldThrottle(content::NavigationThrottleRegistry& registry);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_NAVIGATION_HOLD_H_
