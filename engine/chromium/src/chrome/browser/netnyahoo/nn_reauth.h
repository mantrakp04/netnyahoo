// Copyright 2026 Netnyahoo. Apache-2.0.
//
// The OS reauth in front of revealing saved passwords and cards and exporting
// passwords, as Chrome's settings pages ask for it: Chrome's own
// DeviceAuthenticator (Touch ID, else the login password) from
// ChromeDeviceAuthenticatorFactory, with the caller's source, prompt and
// validity period, so a reauth here and one in Chrome's own prompts count for
// each other.
//
// A hidden test instance (NETNYAHOO_BACKGROUND=1 in the process's environment)
// never shows the prompt: each request is logged and reported as event
// "reauth.requested" {purpose, granted}, and is granted only when
// NETNYAHOO_TEST_REAUTH=granted. Nothing a caller passes can skip the prompt.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_REAUTH_H_
#define CHROME_BROWSER_NETNYAHOO_NN_REAUTH_H_

#include <string>

#include "base/functional/callback_forward.h"
#include "base/time/time.h"
#include "components/device_reauth/device_reauth_metrics_util.h"

class Profile;

namespace netnyahoo {

// Runs |done| with whether the user authenticated. A newer request for the
// profile cancels an older one (which then answers false), as Chrome's
// password page does. |done| doesn't run if the profile goes first.
void Reauth(Profile* profile,
            device_reauth::DeviceAuthSource source,
            const std::u16string& purpose,
            base::TimeDelta validity,
            base::OnceCallback<void(bool)> done);

}  // namespace netnyahoo

#endif  // CHROME_BROWSER_NETNYAHOO_NN_REAUTH_H_
