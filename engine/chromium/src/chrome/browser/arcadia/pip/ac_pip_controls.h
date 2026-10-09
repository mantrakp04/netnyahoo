// Copyright 2026 Arcadia. Apache-2.0.
//
// Dia's controls for the video Picture in Picture window (docs/dia-spec.md ›
// Picture in Picture), as subclasses of Chrome's, so VideoOverlayWindowViews
// keeps driving them: the corner buttons, the bare play/pause glyph, the
// progress bar and the controls' fade.

#ifndef CHROME_BROWSER_ARCADIA_PIP_AC_PIP_CONTROLS_H_
#define CHROME_BROWSER_ARCADIA_PIP_AC_PIP_CONTROLS_H_

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
inline constexpr int kArcadiaPipButtonMargin = 12;
inline constexpr int kArcadiaPipButtonSize = 28;

// Back to tab (top left): Dia's ↖, 28 × 28.
class ArcadiaBackToTabButton : public OverlayWindowBackToTabButton {
  METADATA_HEADER(ArcadiaBackToTabButton, OverlayWindowBackToTabButton)

 public:
  explicit ArcadiaBackToTabButton(PressedCallback callback);
  ArcadiaBackToTabButton(const ArcadiaBackToTabButton&) = delete;
  ArcadiaBackToTabButton& operator=(const ArcadiaBackToTabButton&) = delete;
  ~ArcadiaBackToTabButton() override;

  // Positions it for a window of `window_size`.
  void Place(const gfx::Size& window_size);

 protected:
  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

// Close (top right): Dia's ×, 1 pt wider than back to tab (29 × 28).
class ArcadiaCloseButton : public CloseImageButton {
  METADATA_HEADER(ArcadiaCloseButton, CloseImageButton)

 public:
  static constexpr int kWidth = 29;

  explicit ArcadiaCloseButton(PressedCallback callback);
  ArcadiaCloseButton(const ArcadiaCloseButton&) = delete;
  ArcadiaCloseButton& operator=(const ArcadiaCloseButton&) = delete;
  ~ArcadiaCloseButton() override;

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
class ArcadiaPlaybackButton : public PlaybackImageButton {
  METADATA_HEADER(ArcadiaPlaybackButton, PlaybackImageButton)

 public:
  explicit ArcadiaPlaybackButton(PressedCallback callback);
  ArcadiaPlaybackButton(const ArcadiaPlaybackButton&) = delete;
  ArcadiaPlaybackButton& operator=(const ArcadiaPlaybackButton&) = delete;
  ~ArcadiaPlaybackButton() override;

 protected:
  // views::View:
  void OnPaintBackground(gfx::Canvas* canvas) override;
  // views::Button:
  void PaintButtonContents(gfx::Canvas* canvas) override;
};

// Dia's progress bar: a 5 pt white capsule over a track of white at 27 %, 12 pt
// from the sides and 9 pt from the bottom. Click or drag to seek; the bar holds
// the released position until the page reports the seek.
class ArcadiaProgressBar : public views::View {
  METADATA_HEADER(ArcadiaProgressBar, views::View)

 public:
  // Hit slop around the bar, on every side.
  static constexpr int kSlopX = 4;
  static constexpr int kSlopY = 6;
  static constexpr float kBarHeight = 5;

  explicit ArcadiaProgressBar(base::RepeatingCallback<void(double)> seek);
  ArcadiaProgressBar(const ArcadiaProgressBar&) = delete;
  ArcadiaProgressBar& operator=(const ArcadiaProgressBar&) = delete;
  ~ArcadiaProgressBar() override;

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
class ArcadiaControlsFadeAnimation : public OverlayControlsFadeAnimation {
 public:
  ArcadiaControlsFadeAnimation(
      const std::vector<raw_ptr<views::View>>& controls,
      Type type);
  ArcadiaControlsFadeAnimation(const ArcadiaControlsFadeAnimation&) =
      delete;
  ArcadiaControlsFadeAnimation& operator=(
      const ArcadiaControlsFadeAnimation&) = delete;
  ~ArcadiaControlsFadeAnimation() override;

  // OverlayControlsFadeAnimation:
  void AnimateToState(double state) override;
};

#endif  // CHROME_BROWSER_ARCADIA_PIP_AC_PIP_CONTROLS_H_
