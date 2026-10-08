// CEF's seams in Chrome's code that NNCore still has to fill: while CEF's own patches are in
// the Chromium tree, every Browser asks cef::BrowserDelegate::Create for a delegate, and
// //chrome calls a few more cef:: functions that libcef would define (nn_cef_seams.mm).
// NNCore keeps its per-Browser record in that delegate.
//
// This file and nn_cef_seams.mm are the only NNCore code that includes CEF's headers. They
// go at the Chromium bump, with CEF's patches: the record moves to a Browser user data of our
// own, and the seams NNCore uses become our own hooks (docs/nncore-spike.md).

#ifndef NETNYAHOO_CORE_NN_CEF_SEAMS_H_
#define NETNYAHOO_CORE_NN_CEF_SEAMS_H_

#include <memory>
#include <string>
#include <vector>

#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "cef/libcef/browser/chrome/browser_delegate.h"

class Browser;
class BrowserWindowInterface;
struct BrowserWindowCreateParams;

namespace nncore {

class WindowHost;

// Passed to Browser::Create through BrowserWindowCreateParams::cef_params: marks the
// Browser as one of ours and names its window.
class NNCreateParams : public cef::BrowserDelegate::CreateParams {
 public:
  explicit NNCreateParams(base::WeakPtr<WindowHost> host)
      : host(std::move(host)) {}
  base::WeakPtr<WindowHost> host;

 private:
  ~NNCreateParams() override = default;
};

// Every Browser gets one (Chrome's hooks call cef::BrowserDelegate::Create for each).
// Browsers Chrome makes on its own (an undocked DevTools window, chrome.windows.create)
// have no host and keep Chrome's behaviour.
class NNBrowserDelegate : public cef::BrowserDelegate {
 public:
  NNBrowserDelegate(Browser* browser, base::WeakPtr<WindowHost> host);
  ~NNBrowserDelegate() override;

  WindowHost* host() const { return host_.get(); }
  bool is_ours() const { return is_ours_; }
  // A Browser Chrome made itself that the host took into one of its windows (before
  // Chrome sets up the Browser's WebContentsDelegate).
  void AdoptIntoHost(base::WeakPtr<WindowHost> host) {
    host_ = std::move(host);
    is_ours_ = true;
  }

  // cef::BrowserDelegate:
  std::unique_ptr<content::WebContents> AddWebContents(
      std::unique_ptr<content::WebContents> new_contents) override;
  void OnWebContentsCreated(content::WebContents* new_contents) override {}
  void OnPopupWebContentsCreated(
      content::WebContents* source_contents,
      const content::GlobalRenderFrameHostId& opener_id,
      const std::string& frame_name,
      const GURL& target_url,
      content::WebContents* new_contents) override {}
  void SetAsDelegate(content::WebContents* web_contents,
                     bool set_delegate) override {}
  void UpdateDraggableRegions(
      const std::vector<blink::mojom::DraggableRegionPtr>& regions,
      content::WebContents* contents) override {}

 private:
  raw_ptr<Browser> browser_;
  base::WeakPtr<WindowHost> host_;
  bool is_ours_;
};

NNBrowserDelegate* DelegateFor(const BrowserWindowInterface* browser);

// The Browser `params` creates is one of `host`'s (it gets an NNBrowserDelegate with it).
void SetHostOfNewBrowser(BrowserWindowCreateParams& params,
                         base::WeakPtr<WindowHost> host);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_CEF_SEAMS_H_
