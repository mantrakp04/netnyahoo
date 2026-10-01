// NNCore's renderer side (what CEF's renderer process handler gave packages/cef): Chrome's
// renderer client, plus the page script in every frame's main world and the page channel
// (netnyahoo/core/mojom/nncore.mojom).

#ifndef NETNYAHOO_CORE_RENDERER_NN_CONTENT_RENDERER_CLIENT_H_
#define NETNYAHOO_CORE_RENDERER_NN_CONTENT_RENDERER_CLIENT_H_

#include <memory>

#include "chrome/renderer/chrome_content_renderer_client.h"

namespace nncore {

class NNRenderThreadObserver;

class NNContentRendererClient : public ChromeContentRendererClient {
 public:
  NNContentRendererClient();
  ~NNContentRendererClient() override;

  // ChromeContentRendererClient:
  void RenderThreadStarted() override;
  void RenderFrameCreated(content::RenderFrame* render_frame) override;

 private:
  std::unique_ptr<NNRenderThreadObserver> observer_;
};

}  // namespace nncore

#endif  // NETNYAHOO_CORE_RENDERER_NN_CONTENT_RENDERER_CLIENT_H_
