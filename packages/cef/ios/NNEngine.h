#pragma once

#import "NNCefInternal.h"

NS_ASSUME_NONNULL_BEGIN

// //chrome/browser/netnyahoo's C exports (engine/chromium/src/chrome/browser/netnyahoo/public/nn_engine.h), looked
// up in the engine framework. Main thread only.
namespace nn::engine {

typedef void (^Completion)(NSDictionary<NSString *, id> *result);

// Calls the export `name` (nn_<domain>_<verb>) for the profile's data (a private window's is its parent's), once
// its context is ready. The completion gets the export's JSON object: {error} on failure.
void Call(const char *name, NSString *profile, NSDictionary<NSString *, id> *_Nullable args, Completion completion);

// Every event of `topic` ("<domain>.<what>"), for the life of the app. The payload's "profile" is the app's
// profile name ("" for the default one).
void Observe(NSString *topic, void (^handler)(NSDictionary<NSString *, id> *payload));

}

namespace nn {

// The app's name for a profile's data: a private window keeps its parent's ("").
NSString *DataProfile(NSString *profile);

// Runs `ready` once the profile's request context is initialized (the first time, also its preferences and
// content blocker).
void WhenProfileReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext> context));

}

NS_ASSUME_NONNULL_END
