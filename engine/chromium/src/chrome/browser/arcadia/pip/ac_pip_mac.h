// Copyright 2026 Arcadia. Apache-2.0.
//
// The macOS side of Dia's video Picture in Picture window: where the user last
// left it, and its Core Animation fade out.

#ifndef CHROME_BROWSER_ARCADIA_PIP_AC_PIP_MAC_H_
#define CHROME_BROWSER_ARCADIA_PIP_AC_PIP_MAC_H_

#include <optional>

#include "base/time/time.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"

// The window opens where the user last left it, across sessions and restarts:
// screen DIPs in ArcadiaPictureInPicture.plist in the user data dir (a file
// rather than user defaults, so test instances with their own data dir keep
// their own).
std::optional<gfx::Rect> LoadArcadiaPictureInPictureBounds();
void SaveArcadiaPictureInPictureBounds(const gfx::Rect& bounds);

// Fades the window's content out (and drops its shadow) in Core Animation, off
// the main thread, so it stays smooth while the tab it goes back to is being
// shown; Reset puts it back before the window shows again.
void FadeOutArcadiaPictureInPicture(gfx::NativeWindow window,
                                      base::TimeDelta duration);
void ResetArcadiaPictureInPictureFade(gfx::NativeWindow window);

#endif  // CHROME_BROWSER_ARCADIA_PIP_AC_PIP_MAC_H_
