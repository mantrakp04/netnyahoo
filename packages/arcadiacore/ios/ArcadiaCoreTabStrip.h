#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Chrome's tab strips as revisioned transactions, for the ArcadiaCEF module's onTabStrip, tabStrips and
// tabStripCommand (packages/cef/src/tabStrip.ts).
@interface ArcadiaCoreTabStrip : NSObject
+ (void)setHandler:(nullable void (^)(NSDictionary<NSString *, id> *transaction))handler;
// Every strip as it is now: a transaction with no command, its rev the last one sent.
@property(class, readonly) NSDictionary<NSString *, id> *allStrips;
+ (void)command:(NSInteger)commandId command:(NSDictionary<NSString *, id> *)command NS_SWIFT_NAME(command(_:command:));
@end

NS_ASSUME_NONNULL_END
