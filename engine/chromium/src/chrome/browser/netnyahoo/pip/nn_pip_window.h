// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Dia's video Picture in Picture window (docs/dia-spec.md › Picture in
// Picture) on Chrome's VideoOverlayWindowViews:
//
// - At rest only the video; the origin shows only with the controls.
// - On hover a 35 % black scrim, back to tab (top left) and close (top right)
//   as 28 pt rounded squares with 1 pt line glyphs, the origin centred in
//   13 pt, a bare play/pause glyph and a 5 pt progress bar that seeks; no skip,
//   time, mute, captions or minimize controls (the keyboard shortcuts stay).
//   Controls fade in 200 ms, ease-in-out.
// - The window shows at once and fades out in Core Animation (100 ms from the
//   close button, 70 ms otherwise); a new window opens where the last one was
//   left, sized to the new video and kept on screen.
//
// Chrome makes it through the hook in chromium-pip-overlay-window.patch, which
// also makes the methods overridden below virtual and this class a friend.

#ifndef CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_WINDOW_H_
#define CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_WINDOW_H_

#include <memory>

#include "base/memory/raw_ptr.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/views/overlay/video_overlay_window_views.h"

class NetnyahooProgressBar;

namespace content {
class VideoPictureInPictureWindowController;
}  // namespace content

class NetnyahooVideoOverlayWindow : public VideoOverlayWindowViews {
 public:
  explicit NetnyahooVideoOverlayWindow(
      content::VideoPictureInPictureWindowController* controller);
  NetnyahooVideoOverlayWindow(const NetnyahooVideoOverlayWindow&) = delete;
  NetnyahooVideoOverlayWindow& operator=(const NetnyahooVideoOverlayWindow&) =
      delete;
  ~NetnyahooVideoOverlayWindow() override;

  // VideoOverlayWindowViews:
  void ShowInactive() override;
  void Hide() override;
  void SetMediaPosition(const media_session::MediaPosition& position) override;
  void OnNativeWidgetMove() override;
  void OnNativeWidgetSizeChanged(const gfx::Size& new_size) override;
  void OnUpdateControlsBounds() override;
  void UpdateControlsVisibility(bool is_visible, bool should_animate) override;
  gfx::Rect GetProgressViewBounds() override;

 private:
  // VideoOverlayWindowViews:
  gfx::Rect CalculateAndUpdateWindowBounds() override;
  void SetUpViews() override;

  void OnCloseButtonPressed();
  // Remembers where the user left the window.
  void MaybeSaveBounds();
  // Hides the window once its fade out has run.
  void FinishHide();

  // Dia's progress bar (Chrome's stays hidden).
  raw_ptr<NetnyahooProgressBar> nn_progress_bar_ = nullptr;
  // The fade that hides the window, for the next Hide() only.
  base::TimeDelta nn_hide_fade_;
  base::OneShotTimer nn_hide_timer_;
};

// Called by VideoOverlayWindowViews::Create (the hook).
std::unique_ptr<VideoOverlayWindowViews> NewNetnyahooVideoOverlayWindow(
    content::VideoPictureInPictureWindowController* controller);

#endif  // CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_WINDOW_H_
