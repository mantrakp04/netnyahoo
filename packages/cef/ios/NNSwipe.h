#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

/// A view that receives horizontal trackpad swipes started over its superview
/// (a pane's content, the sidebar). Register it with +[NNSwipe addTarget:].
@protocol NNSwipeTarget <NSObject>
/// Directions the target can go now. "back" is a swipe whose content moves right
/// (fingers right with natural scrolling), like Chrome's history swiper.
@property (nonatomic, readonly) BOOL canSwipeBack;
@property (nonatomic, readonly) BOOL canSwipeForward;
/// Swipes toward an unavailable direction still track (rubber band, never commits)
/// instead of passing through to the content. Profile paging does this at its ends.
@property (nonatomic, readonly) BOOL tracksUnavailableDirections;
/// Vertical motion doesn't cancel the swipe (a list of destinations is being picked from).
@property (nonatomic, readonly) BOOL allowsVerticalMotion;
/// {phase: "began"|"changed"|"ended"|"cancelled"|"swipe", direction: "back"|"forward",
///  distance (points along the direction, can go negative), dy, velocity (points/s along
///  the direction), available (the direction can commit), width (the target's width)}.
/// "swipe" is a discrete three-finger swipe (System Settings › Swipe between pages).
- (void)swipeEvent:(NSDictionary<NSString *, id> *)event;
@end

/// Two-finger swipe navigation, with Chrome's semantics: the gesture belongs to the
/// page first. It starts only when the first scroll update of a gesture wasn't consumed
/// by the page (renderer ack), the renderer reported an overscroll that its
/// `overscroll-behavior-x` allows, and nothing native under the pointer scrolls
/// horizontally that way. Honours System Settings › Trackpad › Swipe between pages.
@interface NNSwipe : NSObject

/// "Swipe between pages" allows two-finger scroll swipes.
@property (class, nonatomic, readonly) BOOL systemSwipeEnabled;

/// NSHapticFeedbackManager pattern: "levelChange" | "alignment" | "generic".
+ (void)performHaptic:(NSString *)pattern;

+ (void)addTarget:(NSView<NNSwipeTarget> *)target;
+ (void)removeTarget:(NSView<NNSwipeTarget> *)target;

/// DEV: plays a synthetic trackpad gesture over `window` at `point` (window coordinates,
/// origin top-left) through the same tracker path real events take, then delivers the
/// events it lets through to the window (so pages scroll and the renderer acks them).
/// Steps: [{phase: "began"|"changed"|"ended"|"cancelled"|"momentum", dx, dy, delayMs?}].
/// `ignoreSystemPreference` tracks even when Swipe between pages is off.
+ (void)simulateInWindow:(NSWindow *)window
                   point:(NSPoint)point
                   steps:(NSArray<NSDictionary<NSString *, id> *> *)steps
  ignoreSystemPreference:(BOOL)ignoreSystemPreference
              completion:(void (^)(NSDictionary<NSString *, id> *result))completion;

@end

NS_ASSUME_NONNULL_END
