// Copyright 2026 Netnyahoo. Apache-2.0.
//
// The macOS side of Dia's video Picture in Picture window: where the user last
// left it, and its Core Animation fade out.

#ifndef CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_MAC_H_
#define CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_MAC_H_

#include <optional>

#include "base/time/time.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

// The window opens where the user last left it, across sessions and restarts:
// screen DIPs in NetnyahooPictureInPicture.plist in the user data dir (a file
// rather than user defaults, so test instances with their own data dir keep
// their own).
std::optional<gfx::Rect> LoadNetnyahooPictureInPictureBounds();
void SaveNetnyahooPictureInPictureBounds(const gfx::Rect& bounds);

// Fades the window's content out (and drops its shadow) in Core Animation, off
// the main thread, so it stays smooth while the tab it goes back to is being
// shown; Reset puts it back before the window shows again.
void FadeOutNetnyahooPictureInPicture(gfx::NativeWindow window,
                                      base::TimeDelta duration);
void ResetNetnyahooPictureInPictureFade(gfx::NativeWindow window);

#endif  // CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_MAC_H_
