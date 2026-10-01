// Chrome's Cast dialog for the host's tabs, to the host (nn_cast_dialog.mm).

#ifndef NETNYAHOO_CORE_NN_CAST_DIALOG_H_
#define NETNYAHOO_CORE_NN_CAST_DIALOG_H_

#import <Foundation/Foundation.h>

#include <string>

class Profile;

namespace content {
class WebContents;
}

namespace media_router {
class MediaRouterUI;
}

namespace nncore {

// The cef::WantsCastDialog / HandleCastDialog seams (nn_seams.mm).
bool WantsCastDialog(content::WebContents* initiator);
bool HandleCastDialog(content::WebContents* initiator, media_router::MediaRouterUI* ui);
// Chrome's Cast dialog for a tab (as its toolbar button).
bool ShowCastDialog(content::WebContents* contents);
void StartCasting(int dialog_id, const std::string& sink_id, int cast_mode);
void StopCasting(int dialog_id, const std::string& route_id);
void CloseCastDialog(int dialog_id);

// A profile's Cast routes, to the host (HostCastRoutes) now and on every change.
void WatchCastRoutes(Profile* profile);
void TerminateCastRoute(const std::string& route_id);

// Implemented by the API (nncore_api.mm).
void HostCastRoutes(Profile* profile, NSArray* routes);
bool HostWantsCastDialogs();
void HostCastDialog(content::WebContents* contents, NSDictionary* state);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_CAST_DIALOG_H_
