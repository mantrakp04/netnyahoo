#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeWindowHost : NSObject

+ (nullable NSWindow *)makeWindowForProfile:(NSString *)profile;

+ (nullable NSWindow *)makePopupWindowForProfile:(NSString *)profile root:(NSView *)root;

+ (void)embedRootView:(NSView *)root inWindow:(NSWindow *)window;

+ (nullable NSView *)rootViewOfWindow:(NSWindow *)window;

+ (void)removeRootViewOfWindow:(NSWindow *)window;

+ (void)setTrafficLightsCenter:(nullable NSValue *)center inWindow:(NSWindow *)window;
/// The same spot, drawn there at once and laid out there once it holds still (a move every frame: the sidebar's slide).
+ (void)moveTrafficLightsCenter:(nullable NSValue *)center inWindow:(NSWindow *)window;

+ (void)closeWindow:(NSWindow *)window;

+ (void)showProfile:(NSString *)profile inWindow:(NSWindow *)window;
+ (void)prepareProfiles:(NSArray<NSString *> *)profiles forWindow:(NSWindow *)window;
@property(class, nonatomic, copy, nullable) void (^swappedHandler)(NSWindow *from, NSWindow *to);

@property(class, nonatomic, copy, nullable) BOOL (^shouldCloseHandler)(NSWindow *window);
+ (BOOL)windowShouldClose:(NSWindow *)window;

@end

NSView *_Nullable NNWindowRootView(NSWindow *_Nullable window);

@interface NNChromeWindowHost (Dev)

+ (nullable NSString *)devAction:(NSString *)action window:(NSWindow *)window;

@end

NS_ASSUME_NONNULL_END
