// NNCore's ContentMainDelegate: Chrome's, for every process (ChromeMain makes this one
// instead of ChromeMainDelegate; engine/nncore/apply.sh adds that hook). In the browser
// process it gives Chrome a content client whose main parts run Chromium's own message
// loop for the app, the way Chrome does, and tell the host when the engine is up.
//
// As an embedder (g_netnyahoo_embedder, engine/nncore/apply.sh) Chrome leaves a few things
// to us, as it did for CEF: the sampling profiler, honouring --user-data-dir, the main run
// loop, the AppController that keeps the app alive with no windows, crash reporting (off:
// crashes go to macOS's own reports). We put back what we need here.

#ifndef NETNYAHOO_CORE_NN_MAIN_DELEGATE_H_
#define NETNYAHOO_CORE_NN_MAIN_DELEGATE_H_

#include <string_view>

#include "base/functional/callback.h"
#include "chrome/app/chrome_main_delegate.h"

namespace nncore {

class NNMainDelegate : public ChromeMainDelegate {
 public:
  explicit NNMainDelegate(const StartupTimestamps& timestamps);
  ~NNMainDelegate() override;

 protected:
  // ChromeMainDelegate:
  void PreSandboxStartup() override;
  void CreateThreadPool(std::string_view name) override;
  content::ContentBrowserClient* CreateContentBrowserClient() override;
  content::ContentRendererClient* CreateContentRendererClient() override;
};

// The browser process's lifetime, for the ObjC API.
struct EngineCallbacks {
  base::OnceClosure started;        // in the run loop, profiles and services ready
  base::OnceClosure shutting_down;  // the run loop ended
};
void SetEngineCallbacks(EngineCallbacks callbacks);
// The keep-alive that stands in for AppController's: the loop ends once it goes (nn_lifetime).
void ReleaseAppKeepAlive();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_MAIN_DELEGATE_H_
