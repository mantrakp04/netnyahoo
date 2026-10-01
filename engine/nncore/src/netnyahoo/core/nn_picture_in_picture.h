// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Picture-in-picture windows (a video's, or a page's documentPictureInPicture) per tab.

#ifndef NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_
#define NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_

namespace nncore {

// Reports tab:didChangePictureInPicture: {active, kind: "video" | "document"} to the tab
// whose page opened the window, as Chrome's PictureInPictureWindowManager opens and
// closes it (once, at engine start).
void StartPictureInPictureObserver();

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_PICTURE_IN_PICTURE_H_
