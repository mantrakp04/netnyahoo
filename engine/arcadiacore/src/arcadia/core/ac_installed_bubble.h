// Chrome's post-install UI ("<name> has been added") for the host's windows: shown over a
// window the app shows for the extension's profile, never one of its hidden ones, and later
// when the app shows none yet (Chrome would make a Browser for it).

#ifndef ARCADIA_CORE_AC_INSTALLED_BUBBLE_H_
#define ARCADIA_CORE_AC_INSTALLED_BUBBLE_H_

namespace arcadiacore {

// Sets the hook in Chrome's ExtensionInstallUIDesktop (engine/arcadiacore/apply.sh).
void InstallExtensionInstalledHook();

// The app may now show a window for a profile with a bubble waiting (a tab of one came
// forward): shows the waiting ones it can.
void ShowWaitingInstalledBubbles();

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_INSTALLED_BUBBLE_H_
