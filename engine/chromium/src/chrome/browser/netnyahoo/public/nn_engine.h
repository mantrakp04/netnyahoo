// Copyright 2026 Netnyahoo. Apache-2.0.
//
// The plain C surface of //chrome/browser/netnyahoo: Netnyahoo's own code in
// the Chromium tree, calling Chrome's services directly. Chrome's framework
// (NNCore) links it and exports these symbols; the app looks them up with
// dlsym on the engine framework.
//
// This header is plain C with no Chromium includes: the app includes it from
// the repo (engine/chromium/src).
//
// Conventions (every nn_* export follows them):
//   - Names are nn_<domain>_<verb> (nn_passwords_list, nn_zoom_set…), one
//     domain per file pair chrome/browser/netnyahoo/nn_<domain>.{h,cc}.
//   - Every call has the nn_engine_call_t signature: the profile's directory
//     (absolute, UTF-8; the profile must be loaded), the arguments as a JSON
//     object (UTF-8, may be NULL for none), and a reply.
//   - Call on the browser UI thread (the app's main thread).
//   - A call reads args_json only before it returns: the caller may wipe or
//     free the buffer then (arguments holding secrets are zeroed at once).
//   - The reply runs exactly once, on the UI thread, possibly before the call
//     returns. Its JSON is an object: {"error": "<message>"} on failure,
//     otherwise the call's own result. The string is only valid during the
//     reply. If the engine shuts down first the reply may never run.
//   - Changes the app should hear about without asking arrive through the one
//     event sink as (topic, JSON object); every event carries "profile" (the
//     profile directory), and "offTheRecord": true when it happened in that
//     profile's off-the-record profile. Topics are "<domain>.<what>".
//   - "offTheRecord": true in a call's arguments (ABI 2) runs it on the
//     profile's primary off-the-record profile (a private window's session)
//     instead: {"error": "no private session"} while there is none. Only calls
//     whose state Chrome keeps per off-the-record profile take it (site
//     settings, site data, zoom: netnyahoo::OffTheRecord::kAllow); any other
//     answers {"error": "not for a private session"}.

#ifndef CHROME_BROWSER_NETNYAHOO_PUBLIC_NN_ENGINE_H_
#define CHROME_BROWSER_NETNYAHOO_PUBLIC_NN_ENGINE_H_

#ifdef __cplusplus
extern "C" {
#endif

#define NN_ENGINE_EXPORT __attribute__((visibility("default")))

// The version of these conventions; bumped only when they change, not when a
// call is added (a missing call is a missing symbol).
#define NN_ENGINE_ABI_VERSION 2

typedef void (*nn_engine_reply_t)(void* context, const char* json);
typedef void (*nn_engine_call_t)(const char* profile_dir,
                                 const char* args_json,
                                 nn_engine_reply_t reply,
                                 void* context);
typedef void (*nn_engine_event_t)(void* context,
                                  const char* topic,
                                  const char* json);

// int nn_engine_abi_version(void)
typedef int (*nn_engine_abi_version_t)(void);
// void nn_engine_set_event_sink(nn_engine_event_t sink, void* context):
// replaces the sink (NULL to stop). Events run on the UI thread.
typedef void (*nn_engine_set_event_sink_t)(nn_engine_event_t sink,
                                           void* context);

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // CHROME_BROWSER_NETNYAHOO_PUBLIC_NN_ENGINE_H_
