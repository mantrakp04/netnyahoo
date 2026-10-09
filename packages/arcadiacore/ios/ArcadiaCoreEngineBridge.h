#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// //chrome/browser/arcadia's C exports (engine/chromium/src/chrome/browser/arcadia/public/ac_engine.h), the same
// code CEF's framework exports: ArcadiaCore's Chrome framework links and exports it too.
@interface ArcadiaCoreEngineBridge : NSObject
// Calls the export `name` for the profile's data (a private window's is the default profile's); the completion gets
// its JSON reply ({"error"} on failure).
+ (void)call:(NSString *)name
       profile:(NSString *)profile
          args:(nullable NSString *)args
    completion:(void (^)(NSString *json))completion NS_SWIFT_NAME(call(_:profile:args:completion:));
// As call:, for arguments that hold secrets (imported cookies, card numbers): `args` is a NUL-terminated JSON object
// the engine reads in place, zeroed as soon as the export has parsed it, or when the call can't run. A private profile
// is refused rather than mapped to the default profile's data.
+ (void)callWithSecret:(NSString *)name
               profile:(NSString *)profile
                  args:(NSMutableData *)args
            completion:(void (^)(NSString *json))completion NS_SWIFT_NAME(callWithSecret(_:profile:args:completion:));
// Every engine event (topic, JSON payload whose "profile" is the app's profile name).
+ (void)setEventHandler:(nullable void (^)(NSString *topic, NSString *json))handler;
// Every event of `topic` for the native side itself (its payload's "profile" the app's name), for the app's life.
+ (void)observe:(NSString *)topic handler:(void (^)(NSDictionary<NSString *, id> *payload))handler;
// The engine framework has this export.
+ (BOOL)exports:(NSString *)name;
@end

NS_ASSUME_NONNULL_END
