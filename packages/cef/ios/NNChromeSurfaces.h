#pragma once

#import "NNCef.h"

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeSurfaces : NSObject

@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;

+ (void)selectDevice:(NSInteger)chooserId index:(NSInteger)index NS_SWIFT_NAME(selectDevice(_:index:));
+ (void)cancelDeviceChooser:(NSInteger)chooserId NS_SWIFT_NAME(cancelDeviceChooser(_:));
+ (void)refreshDeviceChooser:(NSInteger)chooserId NS_SWIFT_NAME(refreshDeviceChooser(_:));
+ (void)openBluetoothSettings:(NSInteger)chooserId NS_SWIFT_NAME(openBluetoothSettings(_:));

+ (BOOL)showCastDialog:(NSInteger)browserId NS_SWIFT_NAME(showCastDialog(_:));
+ (void)startCasting:(NSInteger)dialogId sink:(NSString *)sinkId mode:(NSInteger)mode NS_SWIFT_NAME(startCasting(_:sink:mode:));
+ (void)stopCasting:(NSInteger)dialogId route:(NSString *)routeId NS_SWIFT_NAME(stopCasting(_:route:));
+ (void)closeCastDialog:(NSInteger)dialogId NS_SWIFT_NAME(closeCastDialog(_:));
+ (void)watchCastRoutes:(NSString *)profile NS_SWIFT_NAME(watchCastRoutes(_:));
+ (void)terminateCastRoute:(NSString *)routeId NS_SWIFT_NAME(terminateCastRoute(_:));

+ (NSDictionary<NSString *, id> *)actionStatesForBrowser:(NSInteger)browserId
                                              extensions:(NSArray<NSString *> *)extensionIds
    NS_SWIFT_NAME(actionStates(browserId:extensions:));
+ (nullable NSString *)sidePanelURLForBrowser:(NSInteger)browserId
                                    extension:(NSString *)extensionId NS_SWIFT_NAME(sidePanelURL(browserId:extension:));

+ (BOOL)changeCaptureSource:(NSInteger)capturerId toTab:(NSInteger)targetId NS_SWIFT_NAME(changeCaptureSource(_:toTab:));
+ (BOOL)stopCapture:(NSInteger)capturerId NS_SWIFT_NAME(stopCapture(_:));

+ (BOOL)showAutofillSuggestions:(NSInteger)browserId passwords:(BOOL)passwords
    NS_SWIFT_NAME(showAutofillSuggestions(_:passwords:));

@end

NS_ASSUME_NONNULL_END
