// Test runs only (--netnyahoo-test-media-route-provider): a Cast route provider with one sink,
// "Netnyahoo Test Sink", so a hidden run can cast a tab, stop and terminate routes with no
// real device. Chrome's own TestMediaRouteProvider is testonly and can't link into the
// framework; this is a small copy of it. Run with Chrome's
// --disable-media-route-providers-for-test so the real Cast/DIAL providers (and their mDNS
// discovery) never start.

#ifndef NETNYAHOO_CORE_NN_TEST_MEDIA_ROUTE_PROVIDER_H_
#define NETNYAHOO_CORE_NN_TEST_MEDIA_ROUTE_PROVIDER_H_

class Profile;

namespace nncore {

// Registers the provider with the profile's media router once, if the switch is set. Call
// before any Cast dialog asks for sinks (the router doesn't replay sink queries to a
// provider that registers later). The provider goes with the profile.
void MaybeRegisterTestMediaRouteProvider(Profile* profile);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_TEST_MEDIA_ROUTE_PROVIDER_H_
