// Copyright 2026 Netnyahoo. Apache-2.0.

#include "netnyahoo/core/nn_picture_in_picture.h"

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "content/public/browser/web_contents.h"
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
}

}  // namespace nncore
