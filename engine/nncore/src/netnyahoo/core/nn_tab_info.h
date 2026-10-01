// Per-tab state NNCore reports in the shapes packages/cef's JS uses (packages/cef/src/*.ts), so
// the RN module passes them through as they are.

#ifndef NETNYAHOO_CORE_NN_TAB_INFO_H_
#define NETNYAHOO_CORE_NN_TAB_INFO_H_

#import <Foundation/Foundation.h>

#include <string>

class GURL;

namespace content {
class WebContents;
}

namespace nncore {

// JS SecurityInfo (WebView.tsx), as packages/cef/ios/NNSiteSettings.mm builds it.
NSDictionary* SecurityInfoFor(content::WebContents* contents);

// "scheme://host[:port]" for http(s) URLs, else nil (NNCef.mm OriginOf).
NSString* OriginOf(const GURL& url);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_TAB_INFO_H_
