// Per-tab state ArcadiaCore reports in the shapes packages/cef's JS uses (packages/cef/src/*.ts), so
// the RN module passes them through as they are.

#ifndef ARCADIA_CORE_AC_TAB_INFO_H_
#define ARCADIA_CORE_AC_TAB_INFO_H_

#import <Foundation/Foundation.h>

#include <string>

class GURL;

namespace content {
class WebContents;
}

namespace arcadiacore {

// JS SecurityInfo (WebView.tsx), as packages/cef/ios/ACSiteSettings.mm builds it.
NSDictionary* SecurityInfoFor(content::WebContents* contents);

// "scheme://host[:port]" for http(s) URLs, else nil (ACCef.mm OriginOf).
NSString* OriginOf(const GURL& url);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_TAB_INFO_H_
