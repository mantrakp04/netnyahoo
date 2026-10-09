// Our hooks in Chrome's code (ac_seams.mm).

#ifndef ARCADIA_CORE_AC_SEAMS_H_
#define ARCADIA_CORE_AC_SEAMS_H_

namespace arcadiacore {

// Sets the g_arcadia_* hooks our patches add to Chrome's code. The browser process calls it
// in ACMainDelegate::PreSandboxStartup, whichever entry point started ChromeMain: before any
// Browser exists.
void InstallChromeHooks();

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_SEAMS_H_
