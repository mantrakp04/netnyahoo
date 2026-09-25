// Per-origin site controls: content settings, the pop-up blocker, connection
// security, remembered permission decisions, certificate errors. Public
// controls are NNSiteSettings in NNCef.h.
#pragma once

#import "NNCefInternal.h"

#include <vector>

#include "include/cef_ssl_info.h"
#include "include/cef_unresponsive_process_callback.h"

namespace nn {
class Client;
}

namespace nn::site {

/// Whether `openerURL` may open windows without a user gesture.
bool PopupsAllowed(NSString *profile, NSString *openerURL);
/// Remembers a blocked popup so it can be opened later; returns its id.
NSString *RecordBlockedPopup(int browserId, NSString *url, NSString *name, const CefPopupFeatures &features);
/// Re-runs a blocked window.open() with a user gesture (keeps window.opener).
bool OpenBlockedPopup(CefRefPtr<CefBrowser> browser, NSString *popupId, bool always, NSString *profile);

/// {level, url, origin, certificate…} for the visible navigation entry.
NSDictionary *SecurityInfo(CefRefPtr<CefBrowser> browser);
bool OnCertificateError(Client *client, cef_errorcode_t error, NSString *url, CefRefPtr<CefSSLInfo> info,
                        CefRefPtr<CefCallback> callback);

// Permission decisions. A remembered decision is stored as a content setting
// for the origin; "this time only" decisions are undone when the tab leaves
// the origin or closes.
std::vector<cef_content_setting_types_t> TypesForPermissions(uint32_t permissions);
std::vector<cef_content_setting_types_t> TypesForMedia(uint32_t mediaPermissions);
/// ALLOW if every type is allowed, BLOCK if any is blocked, else DEFAULT (ask).
cef_content_setting_values_t Decision(NSString *profile, NSString *origin,
                                      const std::vector<cef_content_setting_types_t> &types);
void Remember(NSString *profile, NSString *origin, const std::vector<cef_content_setting_types_t> &types,
              cef_content_setting_values_t value, int temporaryForBrowser);
void NoteGrantedMedia(int browserId, uint32_t mediaPermissions);
/// The user just picked a screen/window in the app's picker for this browser:
/// its next desktop-capture request is granted without another prompt.
void AllowDesktopCapture(int browserId);
bool ConsumeDesktopCapture(int browserId);
/// Screens and windows that can be shared: [{id, kind, name, app?, width, height}].
NSArray<NSDictionary *> *DesktopCaptureSources();
uint32_t GrantedMedia(int browserId);
void ClearGrantedMedia(int browserId);

/// Whether the page's site has "autoplay: block" (enforced by the page script).
bool AutoplayBlocked(NSString *profile, NSString *topURL);

/// Main-frame origin changed: expire temporary grants, apply the sound setting.
void OriginChanged(Client *client);
void BrowserClosed(int browserId);

void SetUnresponsiveCallback(int browserId, CefRefPtr<CefUnresponsiveProcessCallback> callback);
CefRefPtr<CefUnresponsiveProcessCallback> UnresponsiveCallback(int browserId);

}  // namespace nn::site
