#include "netnyahoo/core/nn_page_channel.h"

#import <Foundation/Foundation.h>

#include <utility>

#include "base/functional/bind.h"
#include "base/task/bind_post_task.h"
#include "base/no_destructor.h"
#include "base/strings/strcat.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/single_thread_task_runner.h"
#include "content/public/browser/navigation_controller.h"
#include "content/public/browser/navigation_entry.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/navigation_throttle.h"
#include "content/public/browser/navigation_throttle_registry.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/render_process_host.h"
#include "content/public/browser/web_contents.h"
#include "ipc/ipc_channel_proxy.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "mojo/public/cpp/bindings/callback_helpers.h"
#include "netnyahoo/core/nn_browser.h"
#import "netnyahoo/core/nncore_internal.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "url/gurl.h"
#include "url/origin.h"

namespace nncore {

namespace {

std::string& Script() {
  static base::NoDestructor<std::string> script;
  return *script;
}

mojo::AssociatedRemote<mojom::NNPage> PageOf(content::RenderFrameHost* frame) {
  mojo::AssociatedRemote<mojom::NNPage> page;
  if (frame && frame->IsRenderFrameLive()) {
    frame->GetRemoteAssociatedInterfaces()->GetInterface(&page);
  }
  return page;
}

// Web pages may not navigate to or open netnyahoo: URLs (the app's own pages, which only the
// app maps): cancelled silently. Chrome's pages (chrome:, devtools:) may ask for one in their
// main frame: cancelled too, and the host is told (tab:didRequestAppURL:userGesture:), as
// CEF's NNClient told the app.
class AppSchemeThrottle : public content::NavigationThrottle {
 public:
  explicit AppSchemeThrottle(content::NavigationThrottleRegistry& registry)
      : content::NavigationThrottle(registry) {}

  ThrottleCheckResult WillStartRequest() override { return Check(); }
  ThrottleCheckResult WillRedirectRequest() override { return Check(); }
  const char* GetNameForLogging() override { return "NNAppSchemeThrottle"; }

 private:
  ThrottleCheckResult Check() {
    content::NavigationHandle* navigation = navigation_handle();
    if (!IsAppURL(navigation->GetURL())) {
      return PROCEED;
    }
    content::WebContents* contents = navigation->GetWebContents();
    const std::optional<url::Origin>& initiator =
        navigation->GetInitiatorOrigin();
    content::NavigationEntry* committed =
        contents->GetController().GetLastCommittedEntry();
    // A new popup's first navigation is reported by the opener's delegate instead
    // (NNWebContentsDelegate), which drops the popup.
    const bool popup_start = !committed || committed->IsInitialEntry();
    if (navigation->IsInPrimaryMainFrame() && !popup_start &&
        !navigation->WasServerRedirect() && initiator &&
        IsWebUIURL(initiator->GetURL()) &&
        IsWebUIURL(contents->GetPrimaryMainFrame()->GetLastCommittedURL())) {
      base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
          FROM_HERE, base::BindOnce(
                         [](base::WeakPtr<content::WebContents> contents, GURL url,
                            bool user_gesture) {
                           if (contents) {
                             ReportAppURLRequest(contents.get(), url, user_gesture);
                           }
                         },
                         contents->GetWeakPtr(), navigation->GetURL(),
                         navigation->HasUserGesture()));
    }
    return CANCEL_AND_IGNORE;
  }
};

}  // namespace

bool IsAppURL(const GURL& url) {
  return url.SchemeIs("netnyahoo");
}

bool IsWebUIURL(const GURL& url) {
  return url.SchemeIs("chrome") || url.SchemeIs("devtools");
}

void ReportAppURLRequest(content::WebContents* contents,
                         const GURL& url,
                         bool user_gesture) {
  NNCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if ([delegate respondsToSelector:@selector(tab:didRequestAppURL:userGesture:)]) {
    [delegate tab:tab
        didRequestAppURL:base::SysUTF8ToNSString(url.spec())
             userGesture:user_gesture];
  }
}

void SetPageScript(const std::string& script) {
  Script() = script;
  for (auto it = content::RenderProcessHost::AllHostsIterator(); !it.IsAtEnd();
       it.Advance()) {
    content::RenderProcessHost* host = it.GetCurrentValue();
    if (host->IsInitializedAndNotDead()) {
      SendPageScript(host);
    }
  }
}

const std::string& GetPageScript() {
  return Script();
}

void SendPageScript(content::RenderProcessHost* host) {
  // On the process's IPC channel, so it arrives before the messages that create frames
  // (RenderProcessWillLaunch runs just after the channel is unpaused).
  IPC::ChannelProxy* channel = host->GetChannel();
  if (!channel) {
    return;
  }
  mojo::AssociatedRemote<mojom::NNRendererConfig> config;
  channel->GetRemoteAssociatedInterface(&config);
  config->SetPageScript(Script());
}

void RegisterPageChannelBinders(content::RenderFrameHost& render_frame_host,
                                blink::AssociatedInterfaceRegistry& registry) {
  registry.AddInterface<mojom::NNPageHost>(base::BindRepeating(
      [](content::RenderFrameHost* frame,
         mojo::PendingAssociatedReceiver<mojom::NNPageHost> receiver) {
        content::WebContents* contents =
            content::WebContents::FromRenderFrameHost(frame);
        if (contents) {
          PageChannel::GetOrCreate(contents)->Bind(frame, std::move(receiver));
        }
      },
      &render_frame_host));
}

void AddAppSchemeThrottle(content::NavigationThrottleRegistry& registry) {
  registry.AddThrottle(std::make_unique<AppSchemeThrottle>(registry));
}

// --- PageChannel --------------------------------------------------------------------------

PageChannel::PageChannel(content::WebContents* contents)
    : content::WebContentsObserver(contents),
      content::WebContentsUserData<PageChannel>(*contents),
      receivers_(contents, this) {}

void PageChannel::PrimaryPageChanged(content::Page& page) {
  // The old document's pending evaluations get no answer (it may sit in the back/forward
  // cache, timers frozen, and answer much later otherwise).
  main_page_.reset();
}

PageChannel::~PageChannel() = default;

// static
PageChannel* PageChannel::GetOrCreate(content::WebContents* contents) {
  CreateForWebContents(contents);
  return FromWebContents(contents);
}

// static
std::string PageChannel::FrameId(content::RenderFrameHost* frame) {
  const content::GlobalRenderFrameHostId id = frame->GetGlobalId();
  return base::StrCat({base::NumberToString(id.child_id.GetUnsafeValue()), ":",
                       base::NumberToString(id.frame_routing_id)});
}

void PageChannel::Bind(content::RenderFrameHost* frame,
                       mojo::PendingAssociatedReceiver<mojom::NNPageHost> receiver) {
  receivers_.Bind(frame, std::move(receiver));
}

void PageChannel::Post(const std::string& kind, const std::string& json) {
  content::RenderFrameHost& frame = receivers_.CurrentTargetFrame();
  const bool main = frame.IsInPrimaryMainFrame();
  NNCoreTab* tab = TabBridge::GetOrCreate(&GetWebContents())->tab();
  id<NNCoreTabDelegate> delegate = tab.delegate;
  NSString* ns_kind = base::SysUTF8ToNSString(kind);
  NSString* ns_json = base::SysUTF8ToNSString(json);
  if ([delegate respondsToSelector:@selector
                (tab:didReceivePageMessage:json:frame:main:)]) {
    [delegate tab:tab
        didReceivePageMessage:ns_kind
                         json:ns_json
                        frame:base::SysUTF8ToNSString(FrameId(&frame))
                         main:main];
  } else if (main && [delegate respondsToSelector:@selector
                               (tab:didReceivePageMessage:json:)]) {
    [delegate tab:tab didReceivePageMessage:ns_kind json:ns_json];
  }
}

mojom::NNPage* PageChannel::MainPage() {
  content::RenderFrameHost* frame = GetWebContents().GetPrimaryMainFrame();
  if (!frame->IsRenderFrameLive()) {
    return nullptr;
  }
  if (!main_page_.is_bound() || !main_page_.is_connected() ||
      main_page_frame_ != frame->GetGlobalId()) {
    // A new document's calls go to its frame (an evaluation pending on the old one gets
    // no answer).
    main_page_.reset();
    frame->GetRemoteAssociatedInterfaces()->GetInterface(&main_page_);
    main_page_frame_ = frame->GetGlobalId();
  }
  return main_page_.get();
}

void PageChannel::CallPage(const std::string& kind, const std::string& json) {
  if (mojom::NNPage* page = MainPage()) {
    page->CallPage(kind, json);
  }
}

content::RenderFrameHost* PageChannel::FindFrame(const std::string& frame_id) {
  content::RenderFrameHost* target = nullptr;
  GetWebContents().GetPrimaryMainFrame()->ForEachRenderFrameHost(
      [&](content::RenderFrameHost* frame) {
        if (!target && FrameId(frame) == frame_id) {
          target = frame;
        }
      });
  return target;
}

void PageChannel::ExecuteInFrame(const std::string& frame_id,
                                 const std::string& code) {
  content::RenderFrameHost* target = FindFrame(frame_id);
  if (!target) {
    return;
  }
  if (target->IsInPrimaryMainFrame()) {
    Execute(code);
  } else if (auto page = PageOf(target)) {
    page->Execute(code);
  }
}

void PageChannel::CallFrame(const std::string& frame_id,
                            const std::string& kind,
                            const std::string& json) {
  content::RenderFrameHost* target = FindFrame(frame_id);
  if (!target) {
    return;
  }
  if (target->IsInPrimaryMainFrame()) {
    CallPage(kind, json);
  } else if (auto page = PageOf(target)) {
    page->CallPage(kind, json);
  }
}

void PageChannel::Execute(const std::string& code) {
  if (mojom::NNPage* page = MainPage()) {
    page->Execute(code);
  }
}

void PageChannel::Evaluate(
    const std::string& code,
    base::OnceCallback<void(const std::optional<std::string>&)> callback) {
  // No answer when the frame (or the renderer) goes before it answers.
  // Always on a later turn: the default answer runs when the remote goes, which can be in
  // the middle of this object's work (and the host may close the tab from its completion).
  auto answer = mojo::WrapCallbackWithDefaultInvokeIfNotRun(
      base::BindPostTaskToCurrentDefault(std::move(callback)), std::nullopt);
  mojom::NNPage* page = MainPage();
  if (!page) {
    std::move(answer).Run(std::nullopt);
    return;
  }
  page->Evaluate(code, std::move(answer));
}

WEB_CONTENTS_USER_DATA_KEY_IMPL(PageChannel);

}  // namespace nncore
