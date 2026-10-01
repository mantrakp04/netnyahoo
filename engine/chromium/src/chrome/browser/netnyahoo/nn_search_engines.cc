// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_search_engines.h"

#include <utility>
#include <vector>

#include "base/callback_list.h"
#include "base/functional/bind.h"
#include "chrome/browser/search_engines/template_url_service_factory.h"
#include "chrome/browser/search_engines/ui_thread_search_terms_data.h"
#include "components/search_engines/template_url.h"
#include "components/search_engines/template_url_service.h"
#include "extensions/browser/extension_registry.h"
#include "extensions/common/extension.h"

namespace netnyahoo {
namespace {

base::DictValue List(Profile* profile, TemplateURLService* service) {
  const TemplateURL* fallback = service->GetDefaultSearchProvider();
  UIThreadSearchTermsData terms;
  base::ListValue engines;
  for (TemplateURL* turl : service->GetTemplateURLs()) {
    base::DictValue engine;
    engine.Set("name", turl->short_name());
    engine.Set("keyword", turl->keyword());
    engine.Set("url", turl->url_ref().DisplayURL(terms));
    engine.Set("suggestionsUrl", turl->suggestions_url_ref().DisplayURL(terms));
    engine.Set("default", turl == fallback);
    engine.Set("isOmniboxExtension",
               turl->type() == TemplateURL::OMNIBOX_API_EXTENSION);
    if (turl->type() == TemplateURL::NORMAL_CONTROLLED_BY_EXTENSION ||
        turl->type() == TemplateURL::OMNIBOX_API_EXTENSION) {
      const extensions::Extension* extension =
          extensions::ExtensionRegistry::Get(profile)->GetExtensionById(
              turl->GetExtensionId(), extensions::ExtensionRegistry::EVERYTHING);
      if (extension) {
        engine.Set("extension", base::DictValue()
                                    .Set("id", extension->id())
                                    .Set("name", extension->name()));
      }
    }
    engines.Append(std::move(engine));
  }
  return base::DictValue().Set("engines", std::move(engines));
}

// Replies that wait for the service to load.
class SearchEnginesState : public ProfileState {
 public:
  explicit SearchEnginesState(Profile* profile) : ProfileState(profile) {}

  void WhenLoaded(TemplateURLService* service, Reply reply) {
    waiting_.push_back(std::move(reply));
    if (!subscription_) {
      subscription_ = service->RegisterOnLoadedCallback(base::BindOnce(
          &SearchEnginesState::Loaded, base::Unretained(this), service));
      service->Load();
    }
  }

 private:
  void Release() override {
    subscription_ = {};
    waiting_.clear();
  }

  void Loaded(TemplateURLService* service) {
    subscription_ = {};
    for (Reply& reply : std::exchange(waiting_, {})) {
      reply.Send(List(profile(), service));
    }
  }

  base::CallbackListSubscription subscription_;
  std::vector<Reply> waiting_;
};

}  // namespace
}  // namespace netnyahoo

NN_ENGINE_CALL(nn_search_engines_list) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  TemplateURLService* service =
      TemplateURLServiceFactory::GetForProfile(call.profile());
  if (!service) {
    return call.TakeReply().Error("no search engines in this profile");
  }
  if (!service->loaded()) {
    return netnyahoo::StateFor<netnyahoo::SearchEnginesState>(call.profile())
        .WhenLoaded(service, call.TakeReply());
  }
  call.TakeReply().Send(netnyahoo::List(call.profile(), service));
}
