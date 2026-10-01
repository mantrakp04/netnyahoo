// What NNCore's C++ side needs from its ObjC objects (not part of the host API).

#ifndef NETNYAHOO_CORE_NNCORE_INTERNAL_H_
#define NETNYAHOO_CORE_NNCORE_INTERNAL_H_

#import "netnyahoo/core/public/NNCore.h"

class Profile;

namespace content {
class WebContents;
}

namespace nncore {
class WindowHost;
}

@interface NNCoreProfile ()
+ (NNCoreProfile*)wrapperFor:(Profile*)profile;
@property(readonly) Profile* chromeProfile;
@end

@interface NNCoreTab ()
- (instancetype)initWithContents:(content::WebContents*)contents;
@property(readonly) content::WebContents* contents;
- (void)contentsDestroyed;
- (void)notify:(SEL)selector;
@end

@interface NNCoreWindow ()
@property(readonly) nncore::WindowHost* host;
@end

#endif  // NETNYAHOO_CORE_NNCORE_INTERNAL_H_
