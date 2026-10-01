// The browser side of NNCore's page channel (mojom/nncore.mojom): the page script sent to
// every renderer, page messages from a tab's frames, and calls into its main frame. Also the
// netnyahoo: scheme rule CEF enforced in packages/cef/ios/NNClient.mm.

#ifndef NETNYAHOO_CORE_NN_PAGE_CHANNEL_H_
#define NETNYAHOO_CORE_NN_PAGE_CHANNEL_H_

#include <memory>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "content/public/browser/render_frame_host_receiver_set.h"
#include "content/public/browser/web_contents_user_data.h"
#include "content/public/browser/global_routing_id.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_receiver.h"
#include "url/gurl.h"
#include "netnyahoo/core/mojom/nncore.mojom.h"

namespace blink {
class AssociatedInterfaceRegistry;
}

namespace content {
class NavigationThrottleRegistry;
class RenderFrameHost;
class RenderProcessHost;
class WebContents;
}  // namespace content

namespace nncore {

// The page script: every renderer gets it at launch (before any frame); changing it
// reaches the renderers already running (their next documents).
void SetPageScript(const std::string& script);
const std::string& GetPageScript();
void SendPageScript(content::RenderProcessHost* host);

// From NNContentBrowserClient.
void RegisterPageChannelBinders(content::RenderFrameHost& render_frame_host,
                                blink::AssociatedInterfaceRegistry& registry);
void AddAppSchemeThrottle(content::NavigationThrottleRegistry& registry);
// netnyahoo: URLs: nothing navigates to or opens them. A page of Chrome's (chrome:,
// devtools:) asking for one, in its main frame or a new tab, is reported to the host instead
// (tab:didRequestAppURL:userGesture:), which routes it; web pages' are dropped silently.
bool IsAppURL(const GURL& url);
bool IsWebUIURL(const GURL& url);
void ReportAppURLRequest(content::WebContents* contents,
                         const GURL& url,
                         bool user_gesture);

class PageChannel : public content::WebContentsUserData<PageChannel>,
                    public mojom::NNPageHost {
 public:
  ~PageChannel() override;

  static PageChannel* GetOrCreate(content::WebContents* contents);

  void Bind(content::RenderFrameHost* frame,
            mojo::PendingAssociatedReceiver<mojom::NNPageHost> receiver);

  // The main frame's page script / main world.
  void CallPage(const std::string& kind, const std::string& json);
  // A frame by its id (FrameId below).
  void CallFrame(const std::string& frame_id,
                 const std::string& kind,
                 const std::string& json);
  void Execute(const std::string& code);
  void ExecuteInFrame(const std::string& frame_id, const std::string& code);
  void Evaluate(const std::string& code,
                base::OnceCallback<void(const std::optional<std::string>&)> callback);

  static std::string FrameId(content::RenderFrameHost* frame);

  // mojom::NNPageHost:
  void Post(const std::string& kind, const std::string& json) override;

 private:
  friend class content::WebContentsUserData<PageChannel>;
  explicit PageChannel(content::WebContents* contents);

  mojom::NNPage* MainPage();
  content::RenderFrameHost* FindFrame(const std::string& frame_id);

  content::RenderFrameHostReceiverSet<mojom::NNPageHost> receivers_;
  mojo::AssociatedRemote<mojom::NNPage> main_page_;
  content::GlobalRenderFrameHostId main_page_frame_;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_PAGE_CHANNEL_H_
