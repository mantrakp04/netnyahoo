// Field timing for the opt-in journey telemetry (apps/browser/src/telemetry/journeys.ts). NNCoreFieldTiming.mm.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

// Off until JS turns it on (only while the user shares diagnostics): then every call below records nothing.
BOOL NNFieldTimingEnabled(void);
// Epoch milliseconds, the clock JS's Date.now() and a page's Date.now() share.
double NNFieldNow(void);
// `kind` happened to the app's tab `key` (a WebView's transferKey) at `at` (epoch ms).
void NNFieldMark(NSString *_Nullable key, NSString *kind, double at);
// The same, now: the clock is read only when field timing is on.
void NNFieldMarkNow(NSString *_Nullable key, NSString *kind);
// The same, timed when the Core Animation transaction now open commits (main thread): what changed in it is on its way
// to the screen.
void NNFieldMarkAtCommit(NSString *_Nullable key, NSString *kind);
// Tells every live page to start or stop reporting its paint times (NNCoreWebView.mm; main thread).
void NNCoreWebViewsSetFieldTiming(BOOL on);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
