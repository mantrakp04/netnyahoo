#pragma once

#import "NNCef.h"

NS_ASSUME_NONNULL_BEGIN

typedef void (^NNExtensionsCompletion)(NSDictionary<NSString *, id> *result);

@interface NNExtensions : NSObject

@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;
+ (void)resolveInstallPrompt:(NSString *)requestId accepted:(BOOL)accepted NS_SWIFT_NAME(resolveInstallPrompt(_:accepted:));

+ (void)listForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(list(profile:completion:));

+ (NSDictionary<NSString *, id> *)inspectUnpacked:(NSString *)path NS_SWIFT_NAME(inspectUnpacked(_:));
+ (void)installPath:(NSString *)path profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(install(path:profile:completion:));

+ (void)setEnabled:(BOOL)enabled
         extension:(NSString *)extensionId
           profile:(NSString *)profile
        completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(setEnabled(_:extension:profile:completion:));
+ (void)uninstall:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(uninstall(_:profile:completion:));
+ (void)reload:(NSString *)extensionId profile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(reload(_:profile:completion:));
+ (void)configure:(NSString *)extensionId
          profile:(NSString *)profile
          options:(NSDictionary<NSString *, id> *)options
       completion:(NNExtensionsCompletion)completion NS_SWIFT_NAME(configure(_:profile:options:completion:));

+ (void)evaluateInHost:(NSString *)expression
               profile:(NSString *)profile
                  page:(nullable NSString *)page
            completion:(void (^)(id _Nullable value))completion NS_SWIFT_NAME(evaluateInHost(_:profile:page:completion:));

@end

@interface NNExtensions (SearchEngines)

+ (void)searchEngineListForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion
    NS_SWIFT_NAME(searchEngineList(profile:completion:));

@end

NS_ASSUME_NONNULL_END
