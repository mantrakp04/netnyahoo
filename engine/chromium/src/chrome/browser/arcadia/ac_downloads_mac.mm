// Copyright 2026 Arcadia. Apache-2.0.

#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>

#include "base/apple/foundation_util.h"
#include "base/logging.h"
#include "base/strings/sys_string_conversions.h"
#include "base/threading/scoped_blocking_call.h"
#include "chrome/browser/arcadia/ac_downloads.h"

namespace arcadia {
namespace {

// Only web URLs go into the record, never their credentials (a data: URL can
// be megabytes).
NSURL* RecordURL(const GURL& url) {
  if (!url.is_valid() ||
      !(url.SchemeIsHTTPOrHTTPS() || url.SchemeIs("ftp"))) {
    return nil;
  }
  GURL::Replacements strip;
  strip.ClearUsername();
  strip.ClearPassword();
  return [NSURL URLWithString:base::SysUTF8ToNSString(
                                  url.ReplaceComponents(strip).spec())];
}

}  // namespace

// As CEF's engine (packages/cef/ios/ACCef.mm): Chrome only adds metadata to a
// file the system already quarantined (LSFileQuarantineEnabled), which the
// app's Info.plist doesn't ask for.
void QuarantineDownload(const base::FilePath& file,
                        const GURL& source,
                        const GURL& referrer) {
  base::ScopedBlockingCall blocking(FROM_HERE, base::BlockingType::MAY_BLOCK);
  NSURL* url = base::apple::FilePathToNSURL(file);
  if (!url) {
    return;
  }
  NSDictionary* existing = nil;
  if ([url getResourceValue:&existing
                     forKey:NSURLQuarantinePropertiesKey
                      error:nil] &&
      existing) {
    return;
  }
  NSMutableDictionary* properties = [NSMutableDictionary dictionary];
  NSString* agent =
      NSBundle.mainBundle.infoDictionary[@"CFBundleName"] ?: @"Arcadia";
  properties[(__bridge NSString*)kLSQuarantineAgentNameKey] = agent;
  properties[(__bridge NSString*)kLSQuarantineTypeKey] =
      (__bridge NSString*)kLSQuarantineTypeWebDownload;
  if (NSURL* data = RecordURL(source)) {
    properties[(__bridge NSString*)kLSQuarantineDataURLKey] = data;
  }
  if (NSURL* origin = RecordURL(referrer)) {
    properties[(__bridge NSString*)kLSQuarantineOriginURLKey] = origin;
  }
  NSError* error = nil;
  if (![url setResourceValue:properties
                      forKey:NSURLQuarantinePropertiesKey
                       error:&error]) {
    LOG(WARNING) << "quarantine " << file.BaseName().value() << ": "
                 << base::SysNSStringToUTF8(error.localizedDescription);
  }
}

}  // namespace arcadia
