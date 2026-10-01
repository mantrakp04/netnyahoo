#include "netnyahoo/core/nn_test_media_route_provider.h"

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "base/command_line.h"
#include "base/memory/raw_ptr.h"
#include "base/no_destructor.h"
#include "base/scoped_observation.h"
#include "chrome/browser/media/router/media_router_feature.h"
#include "chrome/browser/media/router/mojo/media_router_desktop.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_observer.h"
#include "components/media_router/browser/media_router_factory.h"
#include "components/media_router/common/media_route.h"
#include "components/media_router/common/media_sink.h"
#include "components/media_router/common/media_source.h"
#include "components/media_router/common/mojom/media_router.mojom.h"
#include "components/media_router/common/discovery/media_sink_internal.h"
#include "mojo/public/cpp/bindings/receiver.h"
#include "mojo/public/cpp/bindings/remote.h"
#include "third_party/blink/public/mojom/presentation/presentation.mojom.h"

namespace nncore {

namespace {

namespace mr = media_router;
using mr::mojom::MediaRouteProviderId;
using mr::mojom::RouteRequestResultCode;

constexpr char kSwitch[] = "netnyahoo-test-media-route-provider";
constexpr MediaRouteProviderId kId = MediaRouteProviderId::TEST;

class Provider : public mr::mojom::MediaRouteProvider, public ProfileObserver {
 public:
  Provider(Profile* profile, mr::mojom::MediaRouter* router)
      : profile_(profile), router_receiver_(router) {
    profile_observation_.Observe(profile);
    // The router's mojom side, called through a pipe of our own (MediaRouterDesktop keeps
    // its receiver private); the receiver goes with this, before the router.
    router_.Bind(router_receiver_.BindNewPipeAndPassRemote());
    mr::MediaSinkInternal sink;
    sink.set_sink(mr::MediaSink("nn-test-sink", "Netnyahoo Test Sink",
                                mr::SinkIconType::CAST, kId));
    sinks_ = {sink};
  }

  void Register(mr::mojom::MediaRouter* router) {
    router->RegisterMediaRouteProvider(kId, receiver_.BindNewPipeAndPassRemote());
  }

  // mojom::MediaRouteProvider:
  void CreateRoute(const std::string& media_source,
                   const std::string& sink_id,
                   const std::string& presentation_id,
                   const url::Origin& origin,
                   int32_t frame_tree_node_id,
                   base::TimeDelta timeout,
                   CreateRouteCallback callback) override {
    mr::MediaRoute route(presentation_id, mr::MediaSource(media_source), sink_id,
                         "Test Route", /*is_local=*/true);
    route.set_presentation_id(presentation_id);
    route.set_controller_type(mr::RouteControllerType::kGeneric);
    const std::string route_id = route.media_route_id();
    routes_[route_id] = route;
    router_->OnPresentationConnectionStateChanged(
        route_id, blink::mojom::PresentationConnectionState::CONNECTED);
    router_->OnRoutesUpdated(kId, Routes());
    std::move(callback).Run(route, nullptr, std::nullopt, RouteRequestResultCode::OK);
  }
  void JoinRoute(const std::string&,
                 const std::string&,
                 const url::Origin&,
                 int32_t,
                 base::TimeDelta,
                 JoinRouteCallback callback) override {
    std::move(callback).Run(std::nullopt, nullptr, std::string("Not supported"),
                            RouteRequestResultCode::UNKNOWN_ERROR);
  }
  void TerminateRoute(const std::string& route_id,
                      TerminateRouteCallback callback) override {
    if (!routes_.erase(route_id)) {
      std::move(callback).Run(std::string("Route not found"),
                              RouteRequestResultCode::ROUTE_NOT_FOUND);
      return;
    }
    router_->OnPresentationConnectionStateChanged(
        route_id, blink::mojom::PresentationConnectionState::TERMINATED);
    router_->OnRoutesUpdated(kId, Routes());
    std::move(callback).Run(std::nullopt, RouteRequestResultCode::OK);
  }
  void SendRouteMessage(const std::string&, const std::string&) override {}
  void SendRouteBinaryMessage(const std::string&, const std::vector<uint8_t>&) override {}
  void StartObservingMediaSinks(const std::string& media_source) override {
    // Never the desktop: mirroring a screen opens the desktop picker (a macOS prompt).
    const bool desktop = mr::MediaSource(media_source).IsDesktopMirroringSource();
    router_->OnSinksReceived(kId, media_source,
                             desktop ? std::vector<mr::MediaSinkInternal>() : sinks_, {});
  }
  void StopObservingMediaSinks(const std::string&) override {}
  void StartObservingMediaRoutes() override {}
  void DetachRoute(const std::string& route_id) override {
    router_->OnPresentationConnectionClosed(
        route_id, blink::mojom::PresentationConnectionCloseReason::CLOSED, "Close route");
  }
  void DiscoverSinksNow() override {}
  void BindMediaController(const std::string&,
                           mojo::PendingReceiver<mr::mojom::MediaController>,
                           mojo::PendingRemote<mr::mojom::MediaStatusObserver>,
                           BindMediaControllerCallback callback) override {
    std::move(callback).Run(false);
  }
  void GetState(GetStateCallback callback) override { std::move(callback).Run(nullptr); }

  // ProfileObserver: before its keyed services (the router) go.
  void OnProfileWillBeDestroyed(Profile* profile) override;

 private:
  std::vector<mr::MediaRoute> Routes() const {
    std::vector<mr::MediaRoute> routes;
    for (const auto& [id, route] : routes_) {
      routes.push_back(route);
    }
    return routes;
  }

  raw_ptr<Profile> profile_;
  base::ScopedObservation<Profile, ProfileObserver> profile_observation_{this};
  mojo::Receiver<mr::mojom::MediaRouteProvider> receiver_{this};
  mojo::Receiver<mr::mojom::MediaRouter> router_receiver_;
  mojo::Remote<mr::mojom::MediaRouter> router_;
  std::vector<mr::MediaSinkInternal> sinks_;
  std::map<std::string, mr::MediaRoute> routes_;
};

std::map<Profile*, std::unique_ptr<Provider>>& Providers() {
  static base::NoDestructor<std::map<Profile*, std::unique_ptr<Provider>>> providers;
  return *providers;
}

void Provider::OnProfileWillBeDestroyed(Profile* profile) {
  profile_observation_.Reset();
  Providers().erase(profile);  // destroys this
}

}  // namespace

void MaybeRegisterTestMediaRouteProvider(Profile* profile) {
  if (!profile || Providers().contains(profile) ||
      !base::CommandLine::ForCurrentProcess()->HasSwitch(kSwitch) ||
      !mr::MediaRouterEnabled(profile)) {
    return;
  }
  auto* desktop = static_cast<mr::MediaRouterDesktop*>(
      mr::MediaRouterFactory::GetApiForBrowserContext(profile));
  if (!desktop) {
    return;
  }
  // mojom::MediaRouter is MediaRouterDesktop's public base (its overrides are private).
  auto* router = static_cast<mr::mojom::MediaRouter*>(desktop);
  auto provider = std::make_unique<Provider>(profile, router);
  provider->Register(router);
  Providers()[profile] = std::move(provider);
}

}  // namespace nncore
