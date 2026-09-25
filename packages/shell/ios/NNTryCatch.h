#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs `block`, returning the reason of any Objective-C exception it raised (nil if none).
/// For AppKit calls that report bad input by throwing, e.g. converting an Apple event reply.
FOUNDATION_EXPORT NSString *_Nullable NNTryCatch(NS_NOESCAPE void (^block)(void));

NS_ASSUME_NONNULL_END
