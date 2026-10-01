// What the NNCore module's files share. NNCore.h is the engine's API (engine/nncore/src/netnyahoo/core/public);
// it stays out of the pod's public headers, so Swift sees only NNCoreHost.h and NNCoreWebView.h.
#import <AppKit/AppKit.h>

#import "NNCore.h"
#import "NNCoreHost.h"

@class NNCoreWebView;

NS_ASSUME_NONNULL_BEGIN

// MARK: Profiles
// The app names profiles as packages/cef does: "" is Chrome's default profile ("Default"), "<id>" is
// "Profile <id>", and "incognito…" is the default profile's off-the-record profile.
namespace nncore_host {

NNCoreProfile *_Nullable LoadedProfile(NSString *name);
void WithProfile(NSString *name, void (^completion)(NNCoreProfile *_Nullable profile));
NSString *ProfileName(NNCoreProfile *_Nullable profile);
bool IsIncognito(NSString *name);

// A stable id per tab for the app's lifetime (the WebView's browserId).
int BrowserId(NNCoreTab *tab);
NNCoreTab *_Nullable TabWithBrowserId(int browserId);

// What the engine's dispositions mean to the app (OpenWindowRequest.disposition).
NSString *AppDisposition(NSString *chromeDisposition);

// Background test instances (NETNYAHOO_BACKGROUND=1): no activation, menus or panels (NNCoreActivation.mm).
void InstallActivationGuardsEarly();
void InstallActivationGuardsLate();
bool Background();

}  // namespace nncore_host

// MARK: Windows
// One per NNCoreWindow: its delegate, and the app's root view in it.
@interface NNCoreWindowController : NSObject <NNCoreWindowDelegate>
+ (nullable NNCoreWindowController *)forNSWindow:(nullable NSWindow *)window;
+ (NSArray<NNCoreWindowController *> *)all;
@property(nonatomic, readonly) NNCoreWindow *coreWindow;
@property(nonatomic, strong, nullable) NSView *root;
// The host itself is changing Chrome's tab strip (opening, activating, placing a tab): reports it causes
// are the app's own (TabStripPlace.byApp).
@property(nonatomic) NSInteger hostChanges;
@end

// MARK: Tabs
// Which WebView hosts which tab, and tabs Chrome opened that wait for the app to adopt them.
@interface NNCoreTabs : NSObject
+ (void)setView:(nullable NNCoreWebView *)view forTab:(NNCoreTab *)tab;
+ (nullable NNCoreWebView *)viewForTab:(NNCoreTab *)tab;
// The app's adoptId for a tab Chrome made ("nncore:<browserId>"); kept until adopted, closed if never.
+ (NSString *)offerTab:(NNCoreTab *)tab;
+ (nullable NNCoreTab *)takeOffered:(NSString *)adoptId;
+ (void)forget:(NNCoreTab *)tab;
@end

@interface NNCoreFavicons (Tabs)
// A tab showed this favicon: fetch() for its URL uses it instead of downloading it again.
+ (void)noteImage:(nullable NSImage *)image forURL:(nullable NSString *)url;
@end

NS_ASSUME_NONNULL_END
