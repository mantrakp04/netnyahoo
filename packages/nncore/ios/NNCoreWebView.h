// The WebView's native view on NNCore: the same interface as packages/cef's NNBrowserView (NNCef.h), so the
// Expo view definition (CefModule.swift) stays the same. It hosts one NNCoreTab: Chrome's WebContents view goes
// straight into it, and the tab lives in the Chrome Browser of its window and profile.
#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

@class NNCoreWebView;

@protocol NNCoreWebViewDelegate <NSObject>
- (void)webView:(NNCoreWebView *)view event:(NSString *)name payload:(NSDictionary<NSString *, id> *)payload;
@end

@interface NNCoreWebView : NSView

@property (nonatomic, weak, nullable) id<NNCoreWebViewDelegate> delegate;
@property (nonatomic, copy) NSString *profile;
@property (nonatomic, copy, nullable) NSString *initialURL;
@property (nonatomic, copy, nullable) NSString *adoptId;
@property (nonatomic, copy, nullable) NSString *transferKey;
@property (nonatomic) BOOL standalone;
@property (nonatomic, strong, nullable) NSColor *pageBackgroundColor;
@property (nonatomic) BOOL visible;
@property (nonatomic) BOOL warm;
@property (nonatomic) BOOL autoPictureInPicture;
@property (nonatomic, readonly) BOOL discarded;
@property (nonatomic) BOOL frozen;
@property (nonatomic, readonly) int browserId;
@property (nonatomic, readonly) int chromeTabId;

+ (void)prepareTransfer:(NSString *)transferKey;

- (void)loadURL:(NSString *)url;
- (void)loadURL:(NSString *)url userInitiated:(BOOL)userInitiated NS_SWIFT_NAME(loadURL(_:userInitiated:));
- (void)loadOpenedURL:(NSInteger)openedId url:(NSString *)url NS_SWIFT_NAME(loadOpenedURL(_:url:));
- (void)goBack;
- (void)goForward;
- (void)goToHistoryOffset:(NSInteger)offset;
- (void)reload;
- (void)reloadIgnoringCache;
- (void)stopLoading;
- (void)focusPage;
- (void)setMuted:(BOOL)muted;
- (void)setZoomFactor:(double)factor;
- (void)zoomStep:(NSInteger)direction NS_SWIFT_NAME(zoomStep(_:));
- (void)find:(NSString *)text forward:(BOOL)forward findNext:(BOOL)findNext;
- (void)stopFinding:(BOOL)clearSelection;
- (void)print;
- (void)showDevTools;
- (void)showDevToolsPanel:(nullable NSString *)panel NS_SWIFT_NAME(showDevTools(panel:));
- (void)runPageCommand:(NSString *)name NS_SWIFT_NAME(runPageCommand(_:));
- (void)executeJavaScript:(NSString *)code;
- (void)evaluate:(NSString *)code completion:(void (^)(NSString *_Nullable json))completion;
- (void)navigationEntries:(void (^)(NSArray<NSDictionary<NSString *, id> *> *entries))completion;
- (void)downloadFavicon:(NSString *)url name:(nullable NSString *)name
             completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadFavicon(_:name:completion:));
- (void)downloadImage:(NSString *)url
            maxPixels:(NSInteger)maxPixels
           completion:(void (^)(NSDictionary<NSString *, id> *_Nullable result))completion
    NS_SWIFT_NAME(downloadImage(_:maxPixels:completion:));

- (void)mediaCommand:(NSString *)action seconds:(double)seconds NS_SWIFT_NAME(mediaCommand(_:seconds:));
- (void)requestPictureInPicture:(void (^)(BOOL ok))completion NS_SWIFT_NAME(requestPictureInPicture(_:));
- (void)exitPictureInPicture;

- (void)securityInfo:(void (^)(NSDictionary<NSString *, id> *info))completion NS_SWIFT_NAME(securityInfo(_:));
- (void)openBlockedPopup:(NSString *)popupId always:(BOOL)always NS_SWIFT_NAME(openBlockedPopup(_:always:));
- (void)clearSiteData:(void (^)(NSDictionary<NSString *, id> *result))completion NS_SWIFT_NAME(clearSiteData(_:));

- (void)resolvePasswordPrompt:(NSString *)action username:(nullable NSString *)username password:(nullable NSString *)password
    NS_SWIFT_NAME(resolvePasswordPrompt(_:username:password:));
- (void)setTabStripIndex:(NSInteger)index pinned:(BOOL)pinned NS_SWIFT_NAME(setTabStrip(index:pinned:));
- (nullable NSString *)executeExtensionAction:(NSString *)extensionId NS_SWIFT_NAME(executeExtensionAction(_:));

- (void)resolveDisplayMedia:(NSString *)requestId sourceId:(nullable NSString *)sourceId
    NS_SWIFT_NAME(resolveDisplayMedia(_:sourceId:));
@property (nonatomic, readonly, nullable) NSString *mediaCaptureSourceId;

- (void)notificationAction:(NSString *)notificationId action:(NSString *)action NS_SWIFT_NAME(notificationAction(_:action:));

- (void)resolveUnresponsive:(BOOL)terminate NS_SWIFT_NAME(resolveUnresponsive(terminate:));
- (BOOL)discard:(BOOL)unload NS_SWIFT_NAME(discard(unload:));
- (void)closeBrowser;

@end

NS_ASSUME_NONNULL_END
