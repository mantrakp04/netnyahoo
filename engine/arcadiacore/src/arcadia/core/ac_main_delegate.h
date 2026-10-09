// ArcadiaCore's ContentMainDelegate: Chrome's, for every process (ChromeMain makes this one
// instead of ChromeMainDelegate; engine/arcadiacore/apply.sh adds that hook). In the browser
// process it gives Chrome a content client whose main parts run Chromium's own message
// loop for the app, the way Chrome does, and tell the host when the engine is up.
//
// As an embedder (g_arcadia_embedder, engine/arcadiacore/apply.sh) Chrome leaves a few things
// to us, as it did for CEF: the sampling profiler, honouring --user-data-dir, the main run
// loop, the AppController that keeps the app alive with no windows, crash reporting (off:
// crashes go to macOS's own reports). We put back what we need here.

#ifndef ARCADIA_CORE_AC_MAIN_DELEGATE_H_
#define ARCADIA_CORE_AC_MAIN_DELEGATE_H_

#include <string_view>

#include "base/functional/callback.h"
#include "chrome/app/chrome_main_delegate.h"

namespace arcadiacore {

class ACMainDelegate : public ChromeMainDelegate {
 public:
  explicit ACMainDelegate(const StartupTimestamps& timestamps);
  ~ACMainDelegate() override;

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
// The keep-alive that stands in for AppController's: the loop ends once it goes (ac_lifetime).
void ReleaseAppKeepAlive();

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_MAIN_DELEGATE_H_
