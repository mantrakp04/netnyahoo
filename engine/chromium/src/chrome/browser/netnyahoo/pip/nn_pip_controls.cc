// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/pip/nn_pip_controls.h"

#include <algorithm>
#include <utility>

#include "base/functional/bind.h"
#include "cc/paint/paint_flags.h"
#include "chrome/browser/ui/views/overlay/video_overlay_window_views.h"
#include "third_party/skia/include/core/SkPath.h"
#include "third_party/skia/include/core/SkPathBuilder.h"
#include "ui/base/cursor/cursor.h"
#include "ui/base/cursor/mojom/cursor_type.mojom-shared.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/models/image_model.h"
#include "ui/events/event.h"
#include "ui/gfx/animation/tween.h"
#include "ui/gfx/canvas.h"
#include "ui/gfx/geometry/point_f.h"
#include "ui/gfx/geometry/rect_f.h"
#include "ui/views/animation/ink_drop.h"

namespace {

// The rounded square behind a corner button.
void PaintCornerButtonBackground(const views::Button& button,
                                 gfx::Canvas* canvas) {
  const bool active = button.GetState() == views::Button::STATE_HOVERED ||
                      button.GetState() == views::Button::STATE_PRESSED;
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SkColorSetA(SK_ColorWHITE, active ? 0x21 : 0x17));
  canvas->DrawRoundRect(gfx::RectF(button.GetLocalBounds()), 6, flags);
}

// A corner button's 1 pt white line glyph.
cc::PaintFlags GlyphFlags() {
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SK_ColorWHITE);
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(1);
  return flags;
}

void TurnOffInkDrop(views::Button* button) {
  views::InkDrop::Get(button)->SetMode(views::InkDropHost::InkDropMode::OFF);
}

}  // namespace

// NetnyahooBackToTabButton ----------------------------------------------------

NetnyahooBackToTabButton::NetnyahooBackToTabButton(PressedCallback callback)
    : OverlayWindowBackToTabButton(std::move(callback)) {
  SetSize(gfx::Size(kNetnyahooPipButtonSize, kNetnyahooPipButtonSize));
  TurnOffInkDrop(this);
}

NetnyahooBackToTabButton::~NetnyahooBackToTabButton() = default;

void NetnyahooBackToTabButton::Place(const gfx::Size& window_size) {
  views::View::SetPosition(
      gfx::Point(kNetnyahooPipButtonMargin, kNetnyahooPipButtonMargin));
}

void NetnyahooBackToTabButton::OnPaintBackground(gfx::Canvas* canvas) {
  PaintCornerButtonBackground(*this, canvas);
}

// Dia's ↖: an 8 pt corner with its diagonal, drawn from line centers.
void NetnyahooBackToTabButton::PaintButtonContents(gfx::Canvas* canvas) {
  const cc::PaintFlags flags = GlyphFlags();
  const gfx::PointF corner(11, 11);
  canvas->DrawLine(gfx::PointF(10.5f, 11), gfx::PointF(18.3f, 11), flags);
  canvas->DrawLine(gfx::PointF(11, 10.5f), gfx::PointF(11, 18.3f), flags);
  canvas->DrawLine(corner, gfx::PointF(18.3f, 18.3f), flags);
}

BEGIN_METADATA(NetnyahooBackToTabButton)
END_METADATA

// NetnyahooCloseButton --------------------------------------------------------

NetnyahooCloseButton::NetnyahooCloseButton(PressedCallback callback)
    : CloseImageButton(std::move(callback)) {
  SetSize(gfx::Size(kWidth, kNetnyahooPipButtonSize));
  TurnOffInkDrop(this);
}

NetnyahooCloseButton::~NetnyahooCloseButton() = default;

void NetnyahooCloseButton::Place(const gfx::Size& window_size) {
  views::View::SetPosition(
      gfx::Point(window_size.width() - kWidth - kNetnyahooPipButtonMargin,
                 kNetnyahooPipButtonMargin));
}

void NetnyahooCloseButton::OnPaintBackground(gfx::Canvas* canvas) {
  PaintCornerButtonBackground(*this, canvas);
}

// Dia's ×: two 1 pt diagonals filling a 9.5 pt square, 9.5 pt in.
void NetnyahooCloseButton::PaintButtonContents(gfx::Canvas* canvas) {
  const cc::PaintFlags flags = GlyphFlags();
  canvas->DrawLine(gfx::PointF(9.85f, 9.85f), gfx::PointF(18.65f, 18.65f),
                   flags);
  canvas->DrawLine(gfx::PointF(18.65f, 9.85f), gfx::PointF(9.85f, 18.65f),
                   flags);
}

BEGIN_METADATA(NetnyahooCloseButton)
END_METADATA

// NetnyahooPlaybackButton -----------------------------------------------------

NetnyahooPlaybackButton::NetnyahooPlaybackButton(PressedCallback callback)
    : PlaybackImageButton(std::move(callback)) {
  TurnOffInkDrop(this);
  // Chrome's replay icon, drawn at 36 pt instead of 24.
  const ui::VectorIconModel replay = replay_image_.GetVectorIcon();
  replay_image_ = ui::ImageModel::FromVectorIcon(*replay.vector_icon(),
                                                 replay.color(), 36);
  UpdateImageAndText();
}

NetnyahooPlaybackButton::~NetnyahooPlaybackButton() = default;

// Chrome's circles behind play and pause aren't drawn.
void NetnyahooPlaybackButton::OnPaintBackground(gfx::Canvas* canvas) {}

void NetnyahooPlaybackButton::PaintButtonContents(gfx::Canvas* canvas) {
  if (playback_state_ == VideoOverlayWindowViews::kEndOfVideo) {
    views::ImageButton::PaintButtonContents(canvas);
    return;
  }
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SK_ColorWHITE);
  const gfx::PointF center = gfx::RectF(GetLocalBounds()).CenterPoint();
  if (playback_state_ == VideoOverlayWindowViews::kPlaying) {
    for (float x : {center.x() - 12, center.x() + 5}) {
      canvas->DrawRoundRect(gfx::RectF(x, center.y() - 21, 7, 42), 3.5f,
                            flags);
    }
    return;
  }
  const float left = center.x() - 12, top = center.y() - 18.5f;
  const SkPath triangle = SkPathBuilder()
                              .moveTo(left, top)
                              .lineTo(left + 31, center.y())
                              .lineTo(left, top + 37)
                              .close()
                              .detach();
  canvas->DrawPath(triangle, flags);
  // A round-joined outline rounds the corners.
  flags.setStyle(cc::PaintFlags::kStroke_Style);
  flags.setStrokeWidth(5);
  flags.setStrokeJoin(cc::PaintFlags::kRound_Join);
  canvas->DrawPath(triangle, flags);
}

BEGIN_METADATA(NetnyahooPlaybackButton)
END_METADATA

// NetnyahooProgressBar --------------------------------------------------------

NetnyahooProgressBar::NetnyahooProgressBar(
    base::RepeatingCallback<void(double)> seek)
    : seek_(std::move(seek)) {}

NetnyahooProgressBar::~NetnyahooProgressBar() = default;

void NetnyahooProgressBar::SetMediaPosition(
    const media_session::MediaPosition& position) {
  position_ = position;
  if (!dragging_) {
    drag_fraction_.reset();
  }
  SchedulePaint();
  if (position_.playback_rate() == 0 || position_.duration().is_zero()) {
    timer_.Stop();
  } else if (!timer_.IsRunning()) {
    timer_.Start(FROM_HERE, base::Milliseconds(100),
                 base::BindRepeating(&NetnyahooProgressBar::RepaintIfDrawn,
                                     base::Unretained(this)));
  }
}

void NetnyahooProgressBar::Place(const gfx::Size& window_size) {
  constexpr int kBottomMargin = 9;
  constexpr int kInset = kNetnyahooPipButtonMargin - kSlopX;
  constexpr int kHeight = static_cast<int>(kBarHeight);
  SetBoundsRect({kInset, window_size.height() - kBottomMargin - kHeight - kSlopY,
                 std::max(0, window_size.width() - 2 * kInset),
                 kHeight + 2 * kSlopY});
}

void NetnyahooProgressBar::RepaintIfDrawn() {
  if (IsDrawn()) {
    SchedulePaint();
  }
}

void NetnyahooProgressBar::OnPaint(gfx::Canvas* canvas) {
  const base::TimeDelta duration = position_.duration();
  if (!duration.is_positive() || duration.is_max()) {
    return;
  }
  const gfx::RectF track(kSlopX, kSlopY, width() - 2 * kSlopX, kBarHeight);
  cc::PaintFlags flags;
  flags.setAntiAlias(true);
  flags.setColor(SkColorSetA(SK_ColorWHITE, 0x44));
  canvas->DrawRoundRect(track, kBarHeight / 2, flags);
  const double fraction = std::clamp(
      drag_fraction_.value_or(position_.GetPosition() / duration), 0.0, 1.0);
  if (fraction <= 0) {
    return;
  }
  gfx::RectF played = track;
  played.set_width(
      std::max(kBarHeight, static_cast<float>(track.width() * fraction)));
  flags.setColor(SK_ColorWHITE);
  canvas->DrawRoundRect(played, kBarHeight / 2, flags);
}

bool NetnyahooProgressBar::OnMousePressed(const ui::MouseEvent& event) {
  if (!event.IsOnlyLeftMouseButton()) {
    return false;
  }
  dragging_ = true;
  drag_fraction_ = FractionAt(event.x());
  SchedulePaint();
  return true;
}

bool NetnyahooProgressBar::OnMouseDragged(const ui::MouseEvent& event) {
  drag_fraction_ = FractionAt(event.x());
  SchedulePaint();
  return true;
}

void NetnyahooProgressBar::OnMouseReleased(const ui::MouseEvent& event) {
  dragging_ = false;
  if (drag_fraction_) {
    seek_.Run(*drag_fraction_);
  }
}

void NetnyahooProgressBar::OnMouseCaptureLost() {
  dragging_ = false;
  drag_fraction_.reset();
  SchedulePaint();
}

ui::Cursor NetnyahooProgressBar::GetCursor(const ui::MouseEvent& event) {
  return ui::mojom::CursorType::kHand;
}

double NetnyahooProgressBar::FractionAt(int x) const {
  return std::clamp((x - kSlopX) / std::max(1.0, width() - 2.0 * kSlopX), 0.0,
                    1.0);
}

BEGIN_METADATA(NetnyahooProgressBar)
END_METADATA

// NetnyahooControlsFadeAnimation ----------------------------------------------

NetnyahooControlsFadeAnimation::NetnyahooControlsFadeAnimation(
    const std::vector<raw_ptr<views::View>>& controls,
    Type type)
    : OverlayControlsFadeAnimation(controls, type) {
  SetDuration(base::Milliseconds(200));
}

NetnyahooControlsFadeAnimation::~NetnyahooControlsFadeAnimation() = default;

void NetnyahooControlsFadeAnimation::AnimateToState(double state) {
  OverlayControlsFadeAnimation::AnimateToState(
      gfx::Tween::CalculateValue(gfx::Tween::EASE_IN_OUT, state));
}
