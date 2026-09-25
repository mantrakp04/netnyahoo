// Chrome UI surfaces the app draws instead of Chrome (NNChromeUI.h): device
// choosers (Web Bluetooth, USB, HID, serial), the Cast dialog and the toolbar's
// cast state, extension side panels and toolbar action state, and switching a
// tab capture to another tab ("Share this tab instead"). They need our CEF
// build's CEF_NN_CHROME_UI; `available` is NO without it.
#pragma once

#import "NNCef.h"

NS_ASSUME_NONNULL_BEGIN

@interface NNChromeSurfaces : NSObject

@property (class, nonatomic, readonly) BOOL available;

/// Events:
/// - "deviceChooser" {id, browserId, open, title, okLabel, cancelLabel, noOptionsText, scanningText,
///   refreshing, canRefresh, adapterOff, unauthorized, bothButtonsEnabled, showSignal,
///   options [{name, connected, paired, signal}]}: shown, changed, or closed (open: NO).
/// - "castDialog" {id, browserId, open, header, permissionRejected, castingStarted,
///   sinks [{id, name, status, state, icon, modes, routeId, issue}]}: the same for Cast.
/// - "castRoutes" {profile, routes [{id, sink, description, source}]}: routes this browser
///   started in that profile (see -watchCastRoutes:).
/// - "sidePanel" {browserId, extensionId, open}: chrome.sidePanel.open / close.
/// Setting it takes Chrome's surfaces over (once the engine runs).
@property (class, nonatomic, copy, nullable) NNEventHandler eventHandler;

/// Grants the device at `index`, or (a scanning prompt) allows it with index -1.
+ (void)selectDevice:(NSInteger)chooserId index:(NSInteger)index NS_SWIFT_NAME(selectDevice(_:index:));
+ (void)cancelDeviceChooser:(NSInteger)chooserId NS_SWIFT_NAME(cancelDeviceChooser(_:));
+ (void)refreshDeviceChooser:(NSInteger)chooserId NS_SWIFT_NAME(refreshDeviceChooser(_:));
/// System Settings › Privacy › Bluetooth.
+ (void)openBluetoothSettings:(NSInteger)chooserId NS_SWIFT_NAME(openBluetoothSettings(_:));

/// Opens the Cast dialog for a tab ("castDialog" follows). NO if the Media Router is off.
+ (BOOL)showCastDialog:(NSInteger)browserId NS_SWIFT_NAME(showCastDialog(_:));
/// `mode`: 1 presentation (the site's own cast), 2 tab, 4 screen.
+ (void)startCasting:(NSInteger)dialogId sink:(NSString *)sinkId mode:(NSInteger)mode NS_SWIFT_NAME(startCasting(_:sink:mode:));
+ (void)stopCasting:(NSInteger)dialogId route:(NSString *)routeId NS_SWIFT_NAME(stopCasting(_:route:));
+ (void)closeCastDialog:(NSInteger)dialogId NS_SWIFT_NAME(closeCastDialog(_:));
/// Reports the profile's local routes ("castRoutes") now and whenever they change.
+ (void)watchCastRoutes:(NSString *)profile NS_SWIFT_NAME(watchCastRoutes(_:));
/// Ends a route from "castRoutes".
+ (void)terminateCastRoute:(NSString *)routeId NS_SWIFT_NAME(terminateCastRoute(_:));

/// Toolbar action state of each extension for a tab: {id: {title, badgeText, badgeColor,
/// badgeTextColor (#rrggbb, or null), popup, enabled, icon (data URL or "")}}.
+ (NSDictionary<NSString *, id> *)actionStatesForBrowser:(NSInteger)browserId
                                              extensions:(NSArray<NSString *> *)extensionIds
    NS_SWIFT_NAME(actionStates(browserId:extensions:));
/// The extension's side panel page for the tab (nil if it has none there).
+ (nullable NSString *)sidePanelURLForBrowser:(NSInteger)browserId
                                    extension:(NSString *)extensionId NS_SWIFT_NAME(sidePanelURL(browserId:extension:));

/// Switches the tab capture `capturerId` runs to the tab `targetId`. NO if it isn't capturing a tab.
+ (BOOL)changeCaptureSource:(NSInteger)capturerId toTab:(NSInteger)targetId NS_SWIFT_NAME(changeCaptureSource(_:toTab:));
/// Stops the screen / window / tab sharing `capturerId` runs ("Stop Sharing"). NO if none (or this engine can't).
+ (BOOL)stopCapture:(NSInteger)capturerId NS_SWIFT_NAME(stopCapture(_:));
/// Which of `browserIds` the tab capture of `capturerId` shows now (0 if none).
+ (NSInteger)captureTargetOf:(NSInteger)capturerId among:(NSArray<NSNumber *> *)browserIds NS_SWIFT_NAME(captureTarget(of:among:));

/// Opens Chrome's autofill dropdown at the form field focused in the tab, as its field menu does:
/// the saved `passwords` (manual fallback, any text field), or the field's own suggestions
/// (addresses, cards). NO if no form field has focus (or this engine can't).
+ (BOOL)showAutofillSuggestions:(NSInteger)browserId passwords:(BOOL)passwords
    NS_SWIFT_NAME(showAutofillSuggestions(_:passwords:));

@end

NS_ASSUME_NONNULL_END
