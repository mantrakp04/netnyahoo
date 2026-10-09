// Copyright 2026 Arcadia. Apache-2.0.

#include "chrome/browser/arcadia/pip/ac_pip_mac.h"

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>

#include "base/apple/foundation_util.h"
#include "base/files/file_path.h"
#include "base/path_service.h"
#include "chrome/common/chrome_paths.h"

namespace {

NSURL* BoundsFile() {
  base::FilePath dir;
  if (!base::PathService::Get(chrome::DIR_USER_DATA, &dir)) {
    return nil;
  }
  return base::apple::FilePathToNSURL(
      dir.Append("ArcadiaPictureInPicture.plist"));
}

NSString* const kFadeKey = @"arcadiaFadeOut";

// The frame view's layer holds everything the window shows.
CALayer* FadeLayer(NSWindow* window) {
  return window.contentView.superview.layer ?: window.contentView.layer;
}

}  // namespace

std::optional<gfx::Rect> LoadArcadiaPictureInPictureBounds() {
  NSURL* file = BoundsFile();
  NSArray* values = file ? [NSArray arrayWithContentsOfURL:file] : nil;
  if (values.count != 4) {
    return std::nullopt;
  }
  for (id value in values) {
    if (![value isKindOfClass:NSNumber.class]) {
      return std::nullopt;
    }
  }
  gfx::Rect bounds([values[0] intValue], [values[1] intValue],
                   [values[2] intValue], [values[3] intValue]);
  if (bounds.IsEmpty()) {
    return std::nullopt;
  }
  return bounds;
}

void SaveArcadiaPictureInPictureBounds(const gfx::Rect& bounds) {
  // Moves come in bursts while the user drags; skip the ones that change
  // nothing.
  static gfx::Rect last;
  NSURL* file = BoundsFile();
  if (!file || bounds.IsEmpty() || bounds == last) {
    return;
  }
  last = bounds;
  [@[ @(bounds.x()), @(bounds.y()), @(bounds.width()), @(bounds.height()) ]
      writeToURL:file
           error:nil];
}

void FadeOutArcadiaPictureInPicture(gfx::NativeWindow window,
                                      base::TimeDelta duration) {
  NSWindow* ns_window = window.GetNativeNSWindow();
  CALayer* layer = FadeLayer(ns_window);
  if (!layer) {
    return;
  }
  CABasicAnimation* fade = [CABasicAnimation animationWithKeyPath:@"opacity"];
  fade.fromValue = @1;
  fade.toValue = @0;
  fade.duration = duration.InSecondsF();
  fade.timingFunction =
      [CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionEaseOut];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  layer.opacity = 0;
  [layer addAnimation:fade forKey:kFadeKey];
  [CATransaction commit];
  // Hand it to the render server now, before whatever else this turn of the
  // run loop does (showing the tab it goes back to).
  [CATransaction flush];
  ns_window.hasShadow = NO;
}

void ResetArcadiaPictureInPictureFade(gfx::NativeWindow window) {
  NSWindow* ns_window = window.GetNativeNSWindow();
  CALayer* layer = FadeLayer(ns_window);
  if (!layer || layer.opacity == 1) {
    return;
  }
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [layer removeAnimationForKey:kFadeKey];
  layer.opacity = 1;
  [CATransaction commit];
  ns_window.hasShadow = YES;
}
