// Field timing for the opt-in journey telemetry (apps/browser/src/telemetry/journeys.ts). ArcadiaCoreFieldTiming.mm.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

// Off until JS turns it on (only while the user shares diagnostics): then every call below records nothing.
BOOL ACFieldTimingEnabled(void);
// Epoch milliseconds, the clock JS's Date.now() and a page's Date.now() share.
double ACFieldNow(void);
// `kind` happened to the app's tab `key` (a WebView's transferKey) at `at` (epoch ms).
void ACFieldMark(NSString *_Nullable key, NSString *kind, double at);
// The same, now: the clock is read only when field timing is on.
void ACFieldMarkNow(NSString *_Nullable key, NSString *kind);
// The same, timed when the Core Animation transaction now open commits (main thread): what changed in it is on its way
// to the screen.
void ACFieldMarkAtCommit(NSString *_Nullable key, NSString *kind);
// Tells every live page to start or stop reporting its paint times (ArcadiaCoreWebView.mm; main thread).
void ArcadiaCoreWebViewsSetFieldTiming(BOOL on);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
