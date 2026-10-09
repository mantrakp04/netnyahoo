// Device choosers (WebUSB, WebHID, Web Serial, Web Bluetooth) for the host's tabs, to the host.

#ifndef ARCADIA_CORE_AC_DEVICE_CHOOSER_H_
#define ARCADIA_CORE_AC_DEVICE_CHOOSER_H_

#import <Foundation/Foundation.h>

#include <memory>

#include "base/functional/callback.h"

namespace content {
class RenderFrameHost;
class WebContents;
}  // namespace content

namespace permissions {
class ChooserController;
}

namespace arcadiacore {

// The device chooser hook (g_arcadia_device_chooser, ac_seams.mm): true if the host took it.
bool HandleDeviceChooser(content::RenderFrameHost* owner,
                         std::unique_ptr<permissions::ChooserController>* controller,
                         base::OnceClosure* close_closure);
void SelectDevice(int chooser_id, int index);
void CancelDeviceChooser(int chooser_id);
void RefreshDeviceChooser(int chooser_id);
void OpenDeviceChooserSettings(int chooser_id);
// Test runs (--arcadia-test-bluetooth-chooser): Chrome's Bluetooth chooser for the tab's
// page with no adapter behind it (unauthorized, or one device "Arcadia Test Device"), and
// what the page would have heard from it: [{event, device}].
bool ShowTestBluetoothChooser(content::WebContents* contents, bool unauthorized);
NSArray<NSDictionary*>* TestChooserEvents();

// Implemented by the API (arcadiacore_api.mm).
bool HostWantsDeviceChoosers();
void HostDeviceChooser(content::WebContents* contents, NSDictionary* state);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_DEVICE_CHOOSER_H_
