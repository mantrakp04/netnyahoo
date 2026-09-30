#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol NNSwipeTarget <NSObject>
@property (nonatomic, readonly) BOOL canSwipeBack;
@property (nonatomic, readonly) BOOL canSwipeForward;
@property (nonatomic, readonly) BOOL tracksUnavailableDirections;
@property (nonatomic, readonly) BOOL allowsVerticalMotion;
@optional
@property (nonatomic, readonly) BOOL isPager;
// A native pager takes its drags here instead of swipeEvent: phase is prepare, began, changed, ended,
// cancelled or abandon; distance is cumulative along direction (1 back, -1 forward); timestamp is the event's.
@property (nonatomic, readonly) BOOL hasNativePager;
- (void)pagerInput:(NSString *)phase distance:(CGFloat)distance direction:(int)direction timestamp:(NSTimeInterval)timestamp;
@required
- (void)swipeEvent:(NSDictionary<NSString *, id> *)event;
@end

@interface NNSwipe : NSObject

+ (void)performHaptic:(NSString *)pattern;

+ (void)addTarget:(NSView<NNSwipeTarget> *)target;
+ (void)removeTarget:(NSView<NNSwipeTarget> *)target;

+ (void)simulateInWindow:(NSWindow *)window
                   point:(NSPoint)point
                   steps:(NSArray<NSDictionary<NSString *, id> *> *)steps
  ignoreSystemPreference:(BOOL)ignoreSystemPreference
              completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

@end

NS_ASSUME_NONNULL_END
