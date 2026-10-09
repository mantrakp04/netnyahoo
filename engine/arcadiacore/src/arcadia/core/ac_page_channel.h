// The browser side of ArcadiaCore's page channel (mojom/arcadiacore.mojom): the page script sent to
// every renderer, page messages from a tab's frames, and calls into its main frame. Also the
// arcadia: scheme rule CEF enforced in packages/cef/ios/ACClient.mm.

#ifndef ARCADIA_CORE_AC_PAGE_CHANNEL_H_
#define ARCADIA_CORE_AC_PAGE_CHANNEL_H_

#include <memory>
#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "content/public/browser/render_frame_host_receiver_set.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "content/public/browser/global_routing_id.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/pending_associated_receiver.h"
#include "url/gurl.h"
#include "arcadia/core/mojom/arcadiacore.mojom.h"

namespace blink {
class AssociatedInterfaceRegistry;
}

namespace content {
class NavigationThrottleRegistry;
class RenderFrameHost;
class RenderProcessHost;
class WebContents;
}  // namespace content

namespace arcadiacore {

// The page script: every renderer gets it at launch (before any frame); changing it
// reaches the renderers already running (their next documents).
void SetPageScript(const std::string& script);
const std::string& GetPageScript();
void SendPageScript(content::RenderProcessHost* host);

// From ACContentBrowserClient.
void RegisterPageChannelBinders(content::RenderFrameHost& render_frame_host,
                                blink::AssociatedInterfaceRegistry& registry);
void AddAppSchemeThrottle(content::NavigationThrottleRegistry& registry);
// arcadia: URLs: nothing navigates to or opens them. A page of Chrome's (chrome:,
// devtools:) asking for one, in its main frame or a new tab, is reported to the host instead
// (tab:didRequestAppURL:userGesture:), which routes it; web pages' are dropped silently.
bool IsAppURL(const GURL& url);
bool IsWebUIURL(const GURL& url);
void ReportAppURLRequest(content::WebContents* contents,
                         const GURL& url,
                         bool user_gesture);

class PageChannel : public content::WebContentsObserver,
                    public content::WebContentsUserData<PageChannel>,
                    public mojom::ACPageHost {
 public:
  ~PageChannel() override;

  static PageChannel* GetOrCreate(content::WebContents* contents);

  void Bind(content::RenderFrameHost* frame,
            mojo::PendingAssociatedReceiver<mojom::ACPageHost> receiver);

  // The main frame's page script / main world.
  void CallPage(const std::string& kind, const std::string& json);
  // A frame by its id (FrameId below).
  void CallFrame(const std::string& frame_id,
                 const std::string& kind,
                 const std::string& json);
  void Execute(const std::string& code, bool user_gesture = false);
  void ExecuteInFrame(const std::string& frame_id, const std::string& code);
  void Evaluate(const std::string& code,
                bool user_gesture,
                base::OnceCallback<void(const std::optional<std::string>&)> callback);

  static std::string FrameId(content::RenderFrameHost* frame);

  // mojom::ACPageHost:
  void Post(const std::string& kind, const std::string& json) override;

  // content::WebContentsObserver:
  void PrimaryPageChanged(content::Page& page) override;

 private:
  friend class content::WebContentsUserData<PageChannel>;
  explicit PageChannel(content::WebContents* contents);

  mojom::ACPage* MainPage();
  content::RenderFrameHost* FindFrame(const std::string& frame_id);

  content::RenderFrameHostReceiverSet<mojom::ACPageHost> receivers_;
  mojo::AssociatedRemote<mojom::ACPage> main_page_;
  content::GlobalRenderFrameHostId main_page_frame_;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_PAGE_CHANNEL_H_
