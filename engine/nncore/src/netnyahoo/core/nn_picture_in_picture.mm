// Copyright 2026 Netnyahoo. Apache-2.0.

#include "netnyahoo/core/nn_picture_in_picture.h"

#import <AppKit/AppKit.h>

#include <stdlib.h>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/ui/browser_window/public/browser_collection_observer.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "chrome/browser/ui/views/overlay/video_overlay_window_views.h"
#include "content/public/browser/picture_in_picture_window_controller.h"
#include "content/public/browser/video_picture_in_picture_window_controller.h"
#include "content/public/browser/web_contents.h"
#include "ui/base/base_window.h"
#include "ui/gfx/native_ui_types.h"
#include "netnyahoo/core/nn_browser.h"
#import "netnyahoo/core/nncore_internal.h"

namespace nncore {

namespace {

// Not from inside Chrome's picture-in-picture code: the host may close the tab.
void Report(base::WeakPtr<content::WebContents> contents, bool active, NSString* kind) {
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents, bool active,
                        NSString* kind) {
                       if (!contents) {
                         return;
                       }
                       NNCoreTab* tab = TabBridge::GetOrCreate(contents.get())->tab();
                       id<NNCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector
                                     (tab:didChangePictureInPicture:)]) {
                         [delegate tab:tab
                             didChangePictureInPicture:@{
                               @"active" : @(active),
                               @"kind" : kind,
                             }];
                       }
                     },
                     contents, active, kind));
}

// Background (test) instances: Chrome's picture-in-picture windows, video or document, are
// there for the page (they keep rendering, the session stays) but invisible and
// click-through, so a hidden run never floats a window over the owner's. Done before they
// first show.
bool Background() {
  return getenv("NETNYAHOO_BACKGROUND") != nullptr;
}

void MakeInvisible(NSWindow* window) {
  window.alphaValue = 0;
  window.ignoresMouseEvents = YES;
}

// The video overlay: the observer runs in the task that shows it, after its widget exists.
void HideVideoOverlay(content::WebContents* opener) {
  // (Chrome's only accessor for the overlay; the controller exists while it shows.)
  auto* overlay = static_cast<VideoOverlayWindowViews*>(
      content::PictureInPictureWindowController::GetOrCreateVideoPictureInPictureController(
          opener)
          ->GetWindowForTesting());
  if (overlay) {
    MakeInvisible(overlay->GetNativeWindow().GetNativeNSWindow());
  }
}

// Document picture-in-picture: Chrome makes its Browser after telling the manager, then
// shows it once the page is inserted; the Browser is added (OnBrowserCreated) in between.
class DocumentPipBrowsers : public BrowserCollectionObserver {
 public:
  DocumentPipBrowsers() { observation_.Observe(GlobalBrowserCollection::GetInstance()); }

  void OnBrowserCreated(BrowserWindowInterface* browser) override {
    // (Only Chrome's own window: never an app window NNCore hosts the Browser in.)
    if (browser->GetType() != BrowserWindowInterface::TYPE_PICTURE_IN_PICTURE ||
        WindowHost::ForBrowser(browser) || !browser->GetWindow()) {
      return;
    }
    MakeInvisible(browser->GetWindow()->GetNativeWindow().GetNativeNSWindow());
  }

 private:
  base::ScopedObservation<GlobalBrowserCollection, BrowserCollectionObserver> observation_{
      this};
};

class PictureInPictureObserver : public PictureInPictureWindowManager::Observer {
 public:
  void OnEnterPictureInPicture() override {
    PictureInPictureWindowManager* manager = PictureInPictureWindowManager::GetInstance();
    content::WebContents* opener = manager->GetWebContents();
    // One window at a time: a new one replaces the last (Chrome closes it first).
    if (opener_ && opener_.get() != opener) {
      Report(opener_, false, kind_);
    }
    opener_ = opener ? opener->GetWeakPtr() : nullptr;
    if (Background() && opener && !manager->GetChildWebContents()) {
      HideVideoOverlay(opener);
    }
    if (!opener) {
      return;
    }
    kind_ = manager->GetChildWebContents() ? @"document" : @"video";
    Report(opener_, true, kind_);
  }

  void OnExitPictureInPicture() override {
    if (!opener_) {
      return;
    }
    Report(opener_, false, kind_);
    opener_ = nullptr;
  }

 private:
  base::WeakPtr<content::WebContents> opener_;
  NSString* __strong kind_ = @"video";
};

}  // namespace

void StartPictureInPictureObserver() {
  static base::NoDestructor<PictureInPictureObserver> observer;
  PictureInPictureWindowManager::GetInstance()->AddObserver(observer.get());
  if (Background()) {
    static base::NoDestructor<DocumentPipBrowsers> documents;
  }
}

}  // namespace nncore
