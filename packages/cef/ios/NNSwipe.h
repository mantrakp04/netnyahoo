#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol NNSwipeTarget <NSObject>
@property (nonatomic, readonly) BOOL canSwipeBack;
@property (nonatomic, readonly) BOOL canSwipeForward;
@property (nonatomic, readonly) BOOL tracksUnavailableDirections;
@property (nonatomic, readonly) BOOL allowsVerticalMotion;
@optional
@property (nonatomic, readonly) BOOL isPager;
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
