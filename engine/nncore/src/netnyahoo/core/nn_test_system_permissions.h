// Test runs only (--netnyahoo-test-system-media-permission=ask|ask-slow|denied): macOS's
// camera and microphone permission for the app as Chrome sees it (system_permission_settings),
// without asking macOS. A hidden run uses fake devices (--use-fake-device-for-media-stream),
// which Chrome reads as "allowed by macOS"; this makes the system say "not asked yet" (ask: a
// request is answered "allowed", as a click on macOS's Allow would; ask-slow: after 4 s) or
// "denied", so the run can walk Chrome's permission-element flow past the site's prompt (its
// "ask macOS" and "open System Settings" steps) with no macOS prompt. Other permissions stay
// macOS's.

#ifndef NETNYAHOO_CORE_NN_TEST_SYSTEM_PERMISSIONS_H_
#define NETNYAHOO_CORE_NN_TEST_SYSTEM_PERMISSIONS_H_

namespace nncore {

// Installs the stand-in if the switch is set. Call once the browser process is up.
void MaybeInstallTestSystemPermissions();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_TEST_SYSTEM_PERMISSIONS_H_
