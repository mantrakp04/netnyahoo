// ArcadiaCore's renderer side (what CEF's renderer process handler gave packages/cef): Chrome's
// renderer client, plus the page script in every frame's main world and the page channel
// (arcadia/core/mojom/arcadiacore.mojom).

#ifndef ARCADIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_
#define ARCADIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_

#include <memory>

#include "chrome/renderer/chrome_content_renderer_client.h"

namespace arcadiacore {

class ACRenderThreadObserver;

class ACContentRendererClient : public ChromeContentRendererClient {
 public:
  ACContentRendererClient();
  ~ACContentRendererClient() override;

  // ChromeContentRendererClient:
  void RenderThreadStarted() override;
  void RenderFrameCreated(content::RenderFrame* render_frame) override;

 private:
  std::unique_ptr<ACRenderThreadObserver> observer_;
};

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_RENDERER_AC_CONTENT_RENDERER_CLIENT_H_
