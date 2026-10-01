// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_external_apps.h"

#import <AppKit/AppKit.h>

#include <string>
#include <utility>

#include "base/strings/sys_string_conversions.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "components/prefs/scoped_user_pref_update.h"

namespace netnyahoo {
namespace {

const char* const kPairs = prefs::kProtocolHandlerPerOriginAllowedProtocols;

// As NNExternalApps.mm: the bundle's display name, else its file name.
NSString* AppName(NSURL* app) {
  NSBundle* bundle = [NSBundle bundleWithURL:app];
  for (NSString* key in @[ @"CFBundleDisplayName", @"CFBundleName" ]) {
    NSString* name = bundle.localizedInfoDictionary[key]
                         ?: bundle.infoDictionary[key];
    if ([name isKindOfClass:NSString.class] && name.length) {
      return name;
    }
  }
  return app.lastPathComponent.stringByDeletingPathExtension;
}

NSString* IconDataURI(NSURL* app, int pixels) {
  NSImage* icon = [NSWorkspace.sharedWorkspace iconForFile:app.path];
  NSBitmapImageRep* rep = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:nil
                    pixelsWide:pixels
                    pixelsHigh:pixels
                 bitsPerSample:8
               samplesPerPixel:4
                      hasAlpha:YES
                      isPlanar:NO
                colorSpaceName:NSDeviceRGBColorSpace
                   bytesPerRow:0
                  bitsPerPixel:0];
  if (!icon || !rep) {
    return nil;
  }
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext =
      [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [icon drawInRect:NSMakeRect(0, 0, pixels, pixels)
          fromRect:NSZeroRect
         operation:NSCompositingOperationCopy
          fraction:1];
  [NSGraphicsContext restoreGraphicsState];
  NSData* png = [rep representationUsingType:NSBitmapImageFileTypePNG
                                  properties:@{}];
  return png ? [@"data:image/png;base64,"
                   stringByAppendingString:[png base64EncodedStringWithOptions:0]]
             : nil;
}

base::DictValue Allowance(const std::string& origin,
                          const std::string& scheme) {
  NSURL* probe = [NSURL
      URLWithString:[base::SysUTF8ToNSString(scheme) stringByAppendingString:@":"]];
  NSURL* app =
      probe ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:probe]
            : nil;
  NSString* icon = app ? IconDataURI(app, 64) : nil;
  return base::DictValue()
      .Set("origin", origin)
      .Set("scheme", scheme)
      .Set("app", app ? base::Value(base::SysNSStringToUTF8(AppName(app)))
                      : base::Value())
      .Set("icon", icon ? base::Value(base::SysNSStringToUTF8(icon))
                        : base::Value());
}

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_external_apps_allowances) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  // base::DictValue iterates in key order: sorted by origin, then scheme.
  base::ListValue allowances;
  for (const auto [origin, schemes] :
       call.profile()->GetPrefs()->GetDict(netnyahoo::kPairs)) {
    if (!schemes.is_dict()) {
      continue;
    }
    for (const auto [scheme, allowed] : schemes.GetDict()) {
      if (allowed.is_bool() && allowed.GetBool()) {
        allowances.Append(netnyahoo::Allowance(origin, scheme));
      }
    }
  }
  call.TakeReply().Send(
      base::DictValue().Set("allowances", std::move(allowances)));
}

NN_ENGINE_CALL(nn_external_apps_remove) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  const std::string origin = call.String("origin");
  const std::string scheme = call.String("scheme");
  if (origin.empty() || scheme.empty()) {
    return call.TakeReply().Error("origin and scheme required");
  }
  ScopedDictPrefUpdate pairs(call.profile()->GetPrefs(), netnyahoo::kPairs);
  if (base::DictValue* schemes = pairs->FindDict(origin)) {
    schemes->Remove(scheme);
    if (schemes->empty()) {
      pairs->Remove(origin);
    }
  }
  call.TakeReply().Ok();
}
