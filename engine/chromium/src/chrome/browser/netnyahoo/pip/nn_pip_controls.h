// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Dia's controls for the video Picture in Picture window (docs/dia-spec.md ›
// Picture in Picture), as subclasses of Chrome's, so VideoOverlayWindowViews
// keeps driving them: the corner buttons, the bare play/pause glyph, the
// progress bar and the controls' fade.

#ifndef CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_CONTROLS_H_
#define CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_CONTROLS_H_

#include <optional>
#include <vector>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/timer/timer.h"
#include "chrome/browser/ui/views/overlay/back_to_tab_button.h"
#include "chrome/browser/ui/views/overlay/close_image_button.h"
#include "chrome/browser/ui/views/overlay/overlay_controls_fade_animation.h"
#include "chrome/browser/ui/views/overlay/playback_image_button.h"
#include "services/media_session/public/cpp/media_position.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/views/view.h"

namespace gfx {
class Canvas;
}  // namespace gfx

// The corner buttons are a rounded square of white at 9 % (13 % under the
// pointer) holding a 1 pt white line glyph, with no ink drop, 12 pt from the
// window's top and side.
inline constexpr int kNetnyahooPipButtonMargin = 12;
inline constexpr int kNetnyahooPipButtonSize = 28;

// Back to tab (top left): Dia's ↖, 28 × 28.
class NetnyahooBackToTabButton : public OverlayWindowBackToTabButton {
  METADATA_HEADER(NetnyahooBackToTabButton, OverlayWindowBackToTabButton)

 public:
  explicit NetnyahooBackToTabButton(PressedCallback callback);
  NetnyahooBackToTabButton(const NetnyahooBackToTabButton&) = delete;
  NetnyahooBackToTabButton& operator=(const NetnyahooBackToTabButton&) = delete;
  ~NetnyahooBackToTabButton() override;

  // Positions it for a window of `window_size`.
  void Place(const gfx::Size& window_size);

 protected:
  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

// Close (top right): Dia's ×, 1 pt wider than back to tab (29 × 28).
class NetnyahooCloseButton : public CloseImageButton {
  METADATA_HEADER(NetnyahooCloseButton, CloseImageButton)

 public:
  static constexpr int kWidth = 29;

  explicit NetnyahooCloseButton(PressedCallback callback);
  NetnyahooCloseButton(const NetnyahooCloseButton&) = delete;
  NetnyahooCloseButton& operator=(const NetnyahooCloseButton&) = delete;
  ~NetnyahooCloseButton() override;

  // Positions it for a window of `window_size`.
  void Place(const gfx::Size& window_size);

 protected:
  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

// Play/pause: no circle and no ink drop. Pause is two white 7 × 42 pt capsules
// 10 pt apart; play is a rounded triangle of the same height; replay keeps
// Chrome's icon, at 36 pt. A friend of PlaybackImageButton (hook patch) to read
// its state and resize its replay image.
class NetnyahooPlaybackButton : public PlaybackImageButton {
  METADATA_HEADER(NetnyahooPlaybackButton, PlaybackImageButton)

 public:
  explicit NetnyahooPlaybackButton(PressedCallback callback);
  NetnyahooPlaybackButton(const NetnyahooPlaybackButton&) = delete;
  NetnyahooPlaybackButton& operator=(const NetnyahooPlaybackButton&) = delete;
  ~NetnyahooPlaybackButton() override;

 protected:
  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

// Dia's progress bar: a 5 pt white capsule over a track of white at 27 %, 12 pt
// from the sides and 9 pt from the bottom. Click or drag to seek; the bar holds
// the released position until the page reports the seek.
class NetnyahooProgressBar : public views::View {
  METADATA_HEADER(NetnyahooProgressBar, views::View)

 public:
  // Hit slop around the bar, on every side.
  static constexpr int kSlopX = 4;
  static constexpr int kSlopY = 6;
  static constexpr float kBarHeight = 5;

  explicit NetnyahooProgressBar(base::RepeatingCallback<void(double)> seek);
  NetnyahooProgressBar(const NetnyahooProgressBar&) = delete;
  NetnyahooProgressBar& operator=(const NetnyahooProgressBar&) = delete;
  ~NetnyahooProgressBar() override;

  void SetMediaPosition(const media_session::MediaPosition& position);

  // Positions it for a window of `window_size`.
  void Place(const gfx::Size& window_size);

  // views::View:
  void OnPaint(gfx::Canvas* canvas) override;
  bool OnMousePressed(const ui::MouseEvent& event) override;
  bool OnMouseDragged(const ui::MouseEvent& event) override;
  void OnMouseReleased(const ui::MouseEvent& event) override;
  void OnMouseCaptureLost() override;
  ui::Cursor GetCursor(const ui::MouseEvent& event) override;

 private:
  double FractionAt(int x) const;
  void RepaintIfDrawn();

  base::RepeatingCallback<void(double)> seek_;
  media_session::MediaPosition position_;
  std::optional<double> drag_fraction_;
  bool dragging_ = false;
  base::RepeatingTimer timer_;
};

// The controls fade in and out over 200 ms with an ease-in-out curve (Chrome:
// 250 ms, linear).
class NetnyahooControlsFadeAnimation : public OverlayControlsFadeAnimation {
 public:
  NetnyahooControlsFadeAnimation(
      const std::vector<raw_ptr<views::View>>& controls,
      Type type);
  NetnyahooControlsFadeAnimation(const NetnyahooControlsFadeAnimation&) =
      delete;
  NetnyahooControlsFadeAnimation& operator=(
      const NetnyahooControlsFadeAnimation&) = delete;
  ~NetnyahooControlsFadeAnimation() override;

  // OverlayControlsFadeAnimation:
  void AnimateToState(double state) override;
};

#endif  // CHROME_BROWSER_NETNYAHOO_PIP_NN_PIP_CONTROLS_H_
