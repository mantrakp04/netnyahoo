// Our hooks in Chrome's code (nn_seams.mm).

#ifndef NETNYAHOO_CORE_NN_SEAMS_H_
#define NETNYAHOO_CORE_NN_SEAMS_H_

namespace nncore {

// Sets the g_netnyahoo_* hooks our patches add to Chrome's code. The browser process calls it
// in NNMainDelegate::PreSandboxStartup, whichever entry point started ChromeMain: before any
// Browser exists.
void InstallChromeHooks();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_SEAMS_H_
