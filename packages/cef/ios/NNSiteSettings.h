#pragma once

#import "NNCefInternal.h"

#include <vector>

#include "include/cef_ssl_info.h"
#include "include/cef_unresponsive_process_callback.h"
#include "include/cef_values.h"

namespace nn {
class Client;
}

namespace nn::site {

bool PopupsAllowed(NSString *profile, NSString *openerURL);
// A popup the blocker stopped, to replay as asked: from its own frame, with noopener/noreferrer kept.
NSString *RecordBlockedPopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, NSString *url, NSString *name,
                             const CefPopupFeatures &features, CefRefPtr<CefDictionaryValue> extraInfo);
// The replayed window.open has no user gesture: let that one through the blocker.
bool ConsumePopupReplay(int browserId, NSString *url);
bool OpenBlockedPopup(CefRefPtr<CefBrowser> browser, NSString *popupId, bool always, NSString *profile);

NSDictionary *SecurityInfo(CefRefPtr<CefBrowser> browser);
bool OnCertificateError(Client *client, cef_errorcode_t error, NSString *url, CefRefPtr<CefSSLInfo> info,
                        CefRefPtr<CefCallback> callback);

std::vector<cef_content_setting_types_t> TypesForPermissions(uint32_t permissions);
std::vector<cef_content_setting_types_t> TypesForMedia(uint32_t mediaPermissions);
cef_content_setting_values_t Decision(NSString *profile, NSString *origin,
                                      const std::vector<cef_content_setting_types_t> &types);
void Remember(NSString *profile, NSString *origin, const std::vector<cef_content_setting_types_t> &types,
              cef_content_setting_values_t value, int temporaryForBrowser);
void NoteGrantedMedia(int browserId, uint32_t mediaPermissions);
// A screen-sharing approval: the next desktop capture request of |frameId|
// (of any frame when empty) showing |origin| may capture |source| with no more
// than |media| (CEF_MEDIA_PERMISSION_DESKTOP_*), within 15 seconds.
void AllowDesktopCapture(int browserId, const std::string &frameId, NSString *origin, NSString *source,
                         uint32_t media);
// Uses up the browser's approval; whether it covers this request. Without
// one, desktop capture is refused: as in Chrome, only a source picked in the
// share picker can be captured. A nil |source| (an engine that can't tell)
// skips the source check.
bool ConsumeDesktopCapture(int browserId, const std::string &frameId, NSString *origin, NSString *source,
                           uint32_t permissions);
NSArray<NSDictionary *> *DesktopCaptureSources();
uint32_t GrantedMedia(int browserId);
void ClearGrantedMedia(int browserId);

bool AutoplayBlocked(NSString *profile, NSString *topURL);

void OriginChanged(Client *client);
void BrowserClosed(int browserId);

void SetUnresponsiveCallback(int browserId, CefRefPtr<CefUnresponsiveProcessCallback> callback);
CefRefPtr<CefUnresponsiveProcessCallback> UnresponsiveCallback(int browserId);

}
