// Zoom is Chrome's own (zoom::ZoomController / HostZoomMap): one level per host
// and profile, persisted by Chrome, applied to every tab on the host. This adds
// the events the UI needs, ⌘-scroll zooming and the settings list. Public
// controls are NNZoom in NNCef.h.
#pragma once

#import "NNCefInternal.h"

namespace nn {
class Client;
}

namespace nn::zoom {

/// Chromium zoom level (log base 1.2) ⇄ factor (1 = 100%).
inline double FactorForLevel(double level) { return pow(1.2, level); }
inline double LevelForFactor(double factor) { return log(factor) / log(1.2); }

/// A tab's host zoom changed: every tab of the profile on `host` reports its new level.
void Changed(NSString *profile, NSString *host);
/// After a main-frame commit: a level set for the host while no tab showed it applies now.
void Committed(Client *client);
/// Installs the ⌘-scroll monitor (once).
void InstallScrollMonitor();

}  // namespace nn::zoom
