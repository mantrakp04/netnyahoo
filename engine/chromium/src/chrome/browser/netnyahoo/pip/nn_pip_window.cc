// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/pip/nn_pip_window.h"

#include <algorithm>
#include <optional>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "chrome/browser/netnyahoo/pip/nn_pip_controls.h"
#include "chrome/browser/netnyahoo/pip/nn_pip_mac.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_widget_fade_animator.h"
#include "chrome/browser/picture_in_picture/picture_in_picture_window_manager.h"
#include "chrome/browser/ui/color/chrome_color_id.h"
#include "chrome/browser/ui/views/overlay/constants.h"
#include "chrome/browser/ui/views/overlay/minimize_button.h"
#include "chrome/browser/ui/views/overlay/overlay_window_live_caption_button.h"
#include "chrome/browser/ui/views/overlay/simple_overlay_window_image_button.h"
#include "chrome/browser/ui/views/overlay/toggle_mute_button.h"
#include "ui/display/display.h"
#include "ui/display/screen.h"
#include "ui/gfx/font_list.h"
#include "ui/gfx/geometry/resize_utils.h"
#include "ui/gfx/text_constants.h"
#include "ui/views/background.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/label.h"

namespace {

// How long the window takes to fade out when the close button hides it, and
// when anything else does (back to tab, the page leaving picture in picture).
// Measured on Dia at 60 fps.
constexpr base::TimeDelta kCloseFade = base::Milliseconds(100);
constexpr base::TimeDelta kHideFade = base::Milliseconds(70);

// Puts `replacement` where `view` is in its parent and deletes `view`.
template <typename T, typename U>
T* ReplaceView(raw_ptr<U>& view, std::unique_ptr<T> replacement) {
  U* old_view = std::exchange(view, nullptr);
  views::View* parent = old_view->parent();
  const size_t index = parent->GetIndexOf(old_view).value();
  parent->RemoveChildViewT(old_view);
  return parent->AddChildViewAt(std::move(replacement), index);
}

}  // namespace

NetnyahooVideoOverlayWindow::NetnyahooVideoOverlayWindow(
    content::VideoPictureInPictureWindowController* controller)
    : VideoOverlayWindowViews(controller), nn_hide_fade_(kHideFade) {}

NetnyahooVideoOverlayWindow::~NetnyahooVideoOverlayWindow() = default;

void NetnyahooVideoOverlayWindow::SetUpViews() {
  VideoOverlayWindowViews::SetUpViews();

  // Dia dims the whole video to 65 % under its controls, with no gradients.
  controls_scrim_view_->SetBackground(
      views::CreateSolidBackground(SkColorSetA(SK_ColorBLACK, 0x5A)));
  controls_top_scrim_view_->SetBackground(nullptr);
  controls_bottom_scrim_view_->SetBackground(nullptr);

  // Dia's origin: 13 pt regular white, centred between the corner buttons
  // (no favicon; see OnUpdateControlsBounds).
  origin_->SetFontList(gfx::FontList().DeriveWithSizeDelta(
      13 - gfx::FontList().GetFontSize()));
  origin_->SetEnabledColor(kColorPipWindowForeground);
  origin_->SetHorizontalAlignment(gfx::ALIGN_CENTER);

  // Our buttons in place of Chrome's, with Chrome's callbacks; the close
  // button also picks the longer fade.
  back_to_tab_button_ = ReplaceView(
      back_to_tab_button_,
      std::make_unique<NetnyahooBackToTabButton>(base::BindRepeating([] {
        PictureInPictureWindowManager::GetInstance()
            ->ExitPictureInPictureViaWindowUi(
                PictureInPictureWindowManager::UiBehavior::
                    kCloseWindowAndFocusOpener);
      })));
  close_controls_view_ = ReplaceView(
      close_controls_view_,
      std::make_unique<NetnyahooCloseButton>(base::BindRepeating(
          &NetnyahooVideoOverlayWindow::OnCloseButtonPressed,
          base::Unretained(this))));
  auto play_pause = std::make_unique<NetnyahooPlaybackButton>(
      base::BindRepeating(&VideoOverlayWindowViews::TogglePlayPause,
                          base::Unretained(this)));
  play_pause->SetSize({kCenterButtonSize, kCenterButtonSize});
  play_pause_controls_view_ =
      ReplaceView(play_pause_controls_view_, std::move(play_pause));

  // Dia's progress bar, right after Chrome's (hidden) one in the tree.
  nn_progress_bar_ = playback_controls_container_view_->AddChildViewAt(
      std::make_unique<NetnyahooProgressBar>(base::BindRepeating(
          &VideoOverlayWindowViews::SeekForProgressBarInteraction,
          base::Unretained(this))),
      playback_controls_container_view_->GetIndexOf(progress_view_).value() +
          1);
}

void NetnyahooVideoOverlayWindow::OnUpdateControlsBounds() {
  VideoOverlayWindowViews::OnUpdateControlsBounds();

  const gfx::Size size = GetBounds().size();
  constexpr int kMargin = kNetnyahooPipButtonMargin;
  constexpr int kButton = kNetnyahooPipButtonSize;

  // The title row spans the window, level with the corner buttons; the origin
  // is centred between them, its baseline 1 pt above a label centred on them.
  title_view_->SetBoundsRect({0, 0, size.width(), kMargin + kButton});
  favicon_view_->SetVisible(false);
  constexpr int kOriginX = kMargin + kButton + 8;
  origin_->SetBoundsRect({kOriginX, kMargin - 1,
                          std::max(0, size.width() - 2 * kOriginX), kButton});

  minimize_button_->SetVisible(false);
  static_cast<NetnyahooBackToTabButton*>(back_to_tab_button_.get())
      ->Place(size);
  static_cast<NetnyahooCloseButton*>(close_controls_view_.get())->Place(size);

  // Video conferencing controls stay Chrome's.
  if (vc_controls_container_view_->GetVisible()) {
    return;
  }

  // Dia's playback controls are the play/pause glyph at the centre of the
  // window and its progress bar; Chrome's skip, track, time, captions and mute
  // controls stay hidden (keyboard shortcuts still work).
  play_pause_controls_view_->SetPosition(
      {size.width() / 2 - kCenterButtonSize / 2,
       (size.height() + 1) / 2 - kCenterButtonSize / 2});
  nn_progress_bar_->Place(size);
  nn_progress_bar_->SetVisible(!is_live_);
  progress_view_->SetVisible(false);
  timestamp_->SetVisible(false);
  live_status_->SetVisible(false);
  live_caption_button_->SetVisible(false);
  if (toggle_mute_button_) {
    toggle_mute_button_->SetVisible(false);
  }
  replay_10_seconds_button_->SetVisible(false);
  forward_10_seconds_button_->SetVisible(false);
  previous_track_controls_view_->SetVisible(false);
  next_track_controls_view_->SetVisible(false);
}

void NetnyahooVideoOverlayWindow::UpdateControlsVisibility(
    bool is_visible,
    bool should_animate) {
  // As in Dia, the origin (Chrome's title) shows only with the controls: the
  // resting window is just the video. Chrome's title rule reads this first.
  force_title_and_scrim_visible_ =
      !IsOverlayViewShown() && force_controls_visible_.value_or(is_visible);

  const OverlayControlsFadeAnimation* title_fade =
      title_and_top_scrim_fade_animation_.get();
  const OverlayControlsFadeAnimation* controls_fade = fade_animation_.get();
  VideoOverlayWindowViews::UpdateControlsVisibility(is_visible,
                                                    should_animate);

  // Any fade Chrome just started runs on Dia's curve instead. Chrome's never
  // stepped, so swapping it has no other effect.
  if (title_and_top_scrim_fade_animation_ &&
      title_and_top_scrim_fade_animation_.get() != title_fade) {
    title_and_top_scrim_fade_animation_ =
        std::make_unique<NetnyahooControlsFadeAnimation>(
            std::vector<raw_ptr<views::View>>{title_view_,
                                              controls_top_scrim_view_},
            title_and_top_scrim_fade_animation_->type());
    title_and_top_scrim_fade_animation_->Start();
  }
  if (fade_animation_ && fade_animation_.get() != controls_fade) {
    fade_animation_ = std::make_unique<NetnyahooControlsFadeAnimation>(
        std::vector<raw_ptr<views::View>>{controls_container_view_,
                                          controls_scrim_view_,
                                          controls_bottom_scrim_view_},
        fade_animation_->type());
    fade_animation_->Start();
  }
}

gfx::Rect NetnyahooVideoOverlayWindow::GetProgressViewBounds() {
  return nn_progress_bar_->GetVisible() ? nn_progress_bar_->GetMirroredBounds()
                                        : gfx::Rect();
}

void NetnyahooVideoOverlayWindow::SetMediaPosition(
    const media_session::MediaPosition& position) {
  VideoOverlayWindowViews::SetMediaPosition(position);
  nn_progress_bar_->SetMediaPosition(position);
}

gfx::Rect NetnyahooVideoOverlayWindow::CalculateAndUpdateWindowBounds() {
  // A new window opens where the user last left one, on that display if it's
  // still there, sized to the new video, and kept on screen.
  std::optional<gfx::Rect> saved;
  if (!has_been_shown_) {
    saved = LoadNetnyahooPictureInPictureBounds();
  }
  if (saved) {
    const gfx::Rect work_area =
        display::Screen::Get()->GetDisplayMatching(*saved).work_area();
    UpdateMaxSize(work_area);
    gfx::Rect rect = *saved;
    gfx::Size size = rect.size();
    size.SetToMin(max_size_);
    size.SetToMax(GetMinimumSize());
    rect.set_size(size);
    if (!natural_size_.IsEmpty()) {
      // Keep the corner nearest the work area's corner where it was.
      const gfx::Point center = rect.CenterPoint();
      const bool left = center.x() < work_area.CenterPoint().x();
      const bool top = center.y() < work_area.CenterPoint().y();
      const gfx::ResizeEdge edge =
          top ? (left ? gfx::ResizeEdge::kBottomRight
                      : gfx::ResizeEdge::kBottomLeft)
              : (left ? gfx::ResizeEdge::kTopRight
                      : gfx::ResizeEdge::kTopLeft);
      gfx::SizeRectToAspectRatio(
          edge,
          static_cast<float>(natural_size_.width()) / natural_size_.height(),
          GetMinimumSize(), max_size_, &rect);
      UpdateLayerBoundsWithLetterboxing(rect.size());
    }
    rect.AdjustToFit(work_area);
    return rect;
  }
  return VideoOverlayWindowViews::CalculateAndUpdateWindowBounds();
}

void NetnyahooVideoOverlayWindow::ShowInactive() {
  // Dia's window appears at once; this also takes back a window that's still
  // fading out.
  nn_hide_timer_.Stop();
  ResetNetnyahooPictureInPictureFade(GetNativeWindow());
  SetVisibilityChangedAnimationsEnabled(false);
  SetOpacity(1.0f);
  views::Widget::ShowInactive();
  // Chrome's own fade in finds the window visible and leaves it opaque; the
  // rest is Chrome's.
  VideoOverlayWindowViews::ShowInactive();
  if (fade_animator_) {
    fade_animator_->CancelAndReset();
  }
  SetOpacity(1.0f);
}

// Chrome's Hide(), except that the window fades out first: 100 ms from the
// close button and 70 ms otherwise.
void NetnyahooVideoOverlayWindow::Hide() {
  RemoveOverlayViewIfExists();
  if (fade_animator_) {
    fade_animator_->CancelAndReset();
  }
  const base::TimeDelta fade = std::exchange(nn_hide_fade_, kHideFade);
  if (views::Widget::IsVisible() && fade.is_positive()) {
    if (!nn_hide_timer_.IsRunning()) {
      FadeOutNetnyahooPictureInPicture(GetNativeWindow(), fade);
      nn_hide_timer_.Start(
          FROM_HERE, fade,
          base::BindOnce(&NetnyahooVideoOverlayWindow::FinishHide,
                         base::Unretained(this)));
    }
  } else {
    nn_hide_timer_.Stop();
    views::Widget::Hide();
  }
  MaybeUnregisterFrameSinkHierarchy();
  PictureInPictureWindowManager::GetInstance()->OnPictureInPictureWindowHidden(
      this);
}

void NetnyahooVideoOverlayWindow::FinishHide() {
  views::Widget::Hide();
}

void NetnyahooVideoOverlayWindow::OnCloseButtonPressed() {
  nn_hide_fade_ = kCloseFade;
  // Closes without pausing (chromium-zz-pip-close-keeps-playing.patch).
  CloseAndPauseIfAvailable();
}

void NetnyahooVideoOverlayWindow::OnNativeWidgetMove() {
  VideoOverlayWindowViews::OnNativeWidgetMove();
  MaybeSaveBounds();
}

void NetnyahooVideoOverlayWindow::OnNativeWidgetSizeChanged(
    const gfx::Size& new_size) {
  VideoOverlayWindowViews::OnNativeWidgetSizeChanged(new_size);
  MaybeSaveBounds();
}

void NetnyahooVideoOverlayWindow::MaybeSaveBounds() {
  if (has_been_shown_ && !is_tucking_forced_ && views::Widget::IsVisible() &&
      !nn_hide_timer_.IsRunning()) {
    SaveNetnyahooPictureInPictureBounds(GetBounds());
  }
}

std::unique_ptr<VideoOverlayWindowViews> NewNetnyahooVideoOverlayWindow(
    content::VideoPictureInPictureWindowController* controller) {
  return std::make_unique<NetnyahooVideoOverlayWindow>(controller);
}
