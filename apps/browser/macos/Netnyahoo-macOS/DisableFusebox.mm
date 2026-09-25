// React Native 0.81's modern inspector ("Fusebox") asserts in
// HostTarget::registerInstance when the legacy-architecture bridge reloads
// (the old instance hasn't unregistered yet), which kills the app on every full
// JS reload in debug builds. Fall back to the legacy Hermes inspector instead.
#if DEBUG
#import <Foundation/Foundation.h>
#include <jsinspector-modern/InspectorFlags.h>

@interface NNDisableFusebox : NSObject
@end

@implementation NNDisableFusebox
+ (void)load
{
  facebook::react::jsinspector_modern::InspectorFlags::getInstance().dangerouslyDisableFuseboxForTest();
}
@end
#endif
