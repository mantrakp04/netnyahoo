// Chrome's video Picture in Picture window, styled and handled as packages/cef's NNPictureInPicture (Dia's): rounded
// with a rim, kept on top (a remembered choice), stashed at a screen edge with a 28 pt peek, a menu with Back to Tab.
#pragma once

#import <AppKit/AppKit.h>

@class NNCoreWebView;

namespace nncore_pip {

// The page script's "pip" report for a video: the window Chrome just opened for `view`'s page (frame `frameId`).
// ⌘-scroll and pinch resize any Picture in Picture window (a video's or a document's) from now on.
void WatchZoom();

void VideoChanged(NNCoreWebView *view, NSString *host, NSString *frameId, bool active);

// `view`'s tab asked to be shown: from Chrome's Back to Tab button on its video's Picture in Picture window, the app is
// activated (a click on the window no longer does that); a page asking for itself doesn't activate it.
void TabRequestedActivation(NNCoreWebView *view);

}
