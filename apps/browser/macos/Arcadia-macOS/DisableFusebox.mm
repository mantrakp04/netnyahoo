// RN legacy bridge reload races Fusebox registration; disable Fusebox.
#if DEBUG
#import <Foundation/Foundation.h>
#include <jsinspector-modern/InspectorFlags.h>

@interface ACDisableFusebox : NSObject
@end

@implementation ACDisableFusebox
+ (void)load
{
  facebook::react::jsinspector_modern::InspectorFlags::getInstance().dangerouslyDisableFuseboxForTest();
}
@end
#endif
