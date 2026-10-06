// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_omnibox.h"

#include <memory>
#include <optional>
#include <string>

#include "base/memory/weak_ptr.h"
#include "base/strings/utf_string_conversions.h"
#include "base/time/time.h"
#include "base/timer/timer.h"
#include "chrome/browser/extensions/extension_tab_util.h"
#include "chrome/browser/predictors/autocomplete_action_predictor.h"
#include "chrome/browser/predictors/autocomplete_action_predictor_factory.h"
#include "chrome/browser/predictors/loading_predictor.h"
#include "chrome/browser/predictors/loading_predictor_factory.h"
#include "chrome/browser/preloading/chrome_preloading.h"
#include "chrome/browser/preloading/prerender/prerender_utils.h"
#include "chrome/browser/profiles/profile.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_match_type.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/navigation_handle.h"
#include "content/public/browser/preload_pipeline_info.h"
#include "content/public/browser/preloading_data.h"
#include "content/public/browser/prerender_handle.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_observer.h"
#include "content/public/browser/web_contents_user_data.h"
#include "extensions/common/constants.h"
#include "net/base/url_util.h"
#include "net/http/http_request_headers.h"
#include "services/network/public/cpp/constants.h"
#include "url/gurl.h"

using predictors::AutocompleteActionPredictor;

namespace {

AutocompleteMatchType::Type TypeOf(const std::string& kind) {
  if (kind == "typed") {
    return AutocompleteMatchType::URL_WHAT_YOU_TYPED;
  }
  if (kind == "history") {
    return AutocompleteMatchType::HISTORY_URL;
  }
  if (kind == "bookmark") {
    return AutocompleteMatchType::BOOKMARK_TITLE;
  }
  if (kind == "tab") {
    return AutocompleteMatchType::OPEN_TAB;
  }
  if (kind == "search") {
    return AutocompleteMatchType::SEARCH_WHAT_YOU_TYPED;
  }
  if (kind == "suggest") {
    return AutocompleteMatchType::SEARCH_SUGGEST;
  }
  return AutocompleteMatchType::CALCULATOR;
}

// Prerendered pages: https, or http on this machine (a local server, which
// has no network to hide and is what the benches load). Chrome's own rule is
// http(s); the bar is stricter.
bool MayPrerender(const GURL& url) {
  return url.SchemeIs(url::kHttpsScheme) ||
         (url.SchemeIs(url::kHttpScheme) && net::IsLocalhost(url));
}

// How long a prerendered page waits for Enter: what Enter shows is at most this
// old (the page was fetched when the prerender started). A bar left open longer
// loads afresh. Chrome keeps an omnibox prerender until the tab navigates.
constexpr base::TimeDelta kPrerenderTimeToLive = base::Seconds(10);

// The bar's prerender in a tab, as AutocompleteActionPredictor::StartPrerendering
// starts it (PrerenderManager::StartPrerenderDirectUrlInput: the same trigger,
// metric suffix and typed transition, so the bar's Enter activates it), but with
// its handle held here: it ends after kPrerenderTimeToLive, when the bar closes
// without opening it, or when another one starts. Only this prerender: the
// page's own (speculation rules) are untouched. Like Chrome's, it doesn't end
// when the site's cookies change (the page sets its own as it loads); the
// time limit bounds that.
class BarPrerender : public content::WebContentsObserver,
                     public content::WebContentsUserData<BarPrerender> {
 public:
  ~BarPrerender() override = default;

  // Whether a prerender of `url` is running (now or already).
  bool Start(const GURL& url) {
    if (handle_ && handle_->IsValid() &&
        handle_->GetInitialPrerenderingUrl() == url) {
      return true;
    }
    Stop();
    content::WebContents* contents = web_contents();
    auto* data = content::PreloadingData::GetOrCreateForWebContents(contents);
    content::PreloadingAttempt* attempt = data->AddPreloadingAttempt(
        chrome_preloading_predictor::kOmniboxDirectURLInput,
        content::PreloadingType::kPrerender,
        content::PreloadingData::GetSameURLMatcher(url),
        contents->GetPrimaryMainFrame()->GetPageUkmSourceId());
    handle_ = contents->StartPrerendering(
        url, content::PreloadingTriggerType::kEmbedder,
        prerender_utils::kDirectUrlInputMetricSuffix,
        /*additional_headers=*/net::HttpRequestHeaders(),
        /*no_vary_search_hint=*/std::nullopt,
        ui::PageTransitionFromInt(ui::PAGE_TRANSITION_TYPED |
                                  ui::PAGE_TRANSITION_FROM_ADDRESS_BAR),
        /*should_warm_up_compositor=*/true,
        /*should_prepare_paint_tree=*/false,
        content::PreloadingHoldbackStatus::kUnspecified,
        content::PreloadPipelineInfo::Create(
            /*planned_max_preloading_type=*/content::PreloadingType::kPrerender),
        attempt, /*url_match_predicate=*/{},
        /*prerender_navigation_handle_callback=*/{}, /*allow_reuse=*/false);
    if (!handle_) {
      return false;
    }
    expiry_.Start(FROM_HERE, kPrerenderTimeToLive,
                  base::BindOnce(&BarPrerender::Stop, base::Unretained(this)));
    return true;
  }

  // Ends the prerender (the handle's destruction cancels it, unless it was
  // activated already).
  void Stop() {
    expiry_.Stop();
    handle_.reset();
  }

  // content::WebContentsObserver: a page the tab shows now (the prerender
  // activated, or anything else committed) ends it, as PrerenderManager does.
  void PrimaryPageChanged(content::Page& page) override { Stop(); }

 private:
  explicit BarPrerender(content::WebContents* contents)
      : content::WebContentsObserver(contents),
        content::WebContentsUserData<BarPrerender>(*contents) {}
  friend class content::WebContentsUserData<BarPrerender>;
  WEB_CONTENTS_USER_DATA_KEY_DECL();

  std::unique_ptr<content::PrerenderHandle> handle_;
  base::OneShotTimer expiry_;
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(BarPrerender);

content::WebContents* TabById(Profile* profile, double id) {
  content::WebContents* contents = nullptr;
  if (id <= 0 || !extensions::ExtensionTabUtil::GetTabById(
                     static_cast<int>(id), profile,
                     /*include_incognito=*/true, &contents)) {
    return nullptr;
  }
  return contents;
}

}  // namespace

NN_ENGINE_CALL(nn_omnibox_typed) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  content::WebContents* contents = TabById(call.profile(), call.Double("tab"));
  // The tab's own profile (a private window's), as Chrome's omnibox asks its
  // window's.
  Profile* profile =
      contents ? Profile::FromBrowserContext(contents->GetBrowserContext())
               : call.profile();
  AutocompleteActionPredictor* predictor =
      predictors::AutocompleteActionPredictorFactory::GetForProfile(profile);
  const std::u16string text = base::UTF8ToUTF16(call.String("text"));
  const base::ListValue* list = call.args().FindList("matches");
  if (!predictor || text.empty() || !list) {
    return call.TakeReply().Send(base::DictValue().Set("action", "none"));
  }
  // -1: Enter opens no page (an action of the bar's).
  const int wanted = static_cast<int>(call.Double("default", 0));
  ACMatches matches;
  int default_index = -1;
  for (size_t i = 0; i < list->size(); ++i) {
    const base::Value& item = (*list)[i];
    const base::DictValue* dict = item.GetIfDict();
    const std::string* url = dict ? dict->FindString("url") : nullptr;
    const std::string* kind = dict ? dict->FindString("kind") : nullptr;
    if (!url || !kind) {
      continue;
    }
    AutocompleteMatch match;
    match.destination_url = GURL(*url);
    match.type = TypeOf(*kind);
    if (match.destination_url.is_valid()) {
      if (static_cast<int>(i) == wanted) {
        default_index = static_cast<int>(matches.size());
      }
      matches.push_back(std::move(match));
    }
  }
  AutocompleteResult result;
  result.AppendMatches(matches);
  // ChromeOmniboxClient::OnTextChanged.
  predictor->RegisterTransitionalMatches(text, result);
  if (default_index < 0) {
    return call.TakeReply().Send(base::DictValue().Set("action", "none"));
  }
  const AutocompleteMatch& match = matches[default_index];
  AutocompleteActionPredictor::Action action =
      predictor->RecommendAction(text, match, contents);
  // A tab switch opens no page.
  if (match.type == AutocompleteMatchType::OPEN_TAB) {
    action = AutocompleteActionPredictor::ACTION_NONE;
  }
  if (action == AutocompleteActionPredictor::ACTION_PRERENDER) {
    if (!contents || content::DevToolsAgentHost::IsDebuggerAttached(contents) ||
        match.destination_url == contents->GetLastCommittedURL()) {
      // ChromeOmniboxClient's: no page to prerender in (CurrentPageExists),
      // DevTools attached, or the page the tab shows: nothing at all.
      action = AutocompleteActionPredictor::ACTION_NONE;
    } else if (!MayPrerender(match.destination_url)) {
      // The bar's scheme rule, stricter than Chrome's: the page Chrome would
      // have prerendered is only connected to.
      action = AutocompleteActionPredictor::ACTION_PRECONNECT;
    }
  }
  const char* name = "none";
  switch (action) {
    case AutocompleteActionPredictor::ACTION_PRERENDER:
      BarPrerender::CreateForWebContents(contents);
      name = BarPrerender::FromWebContents(contents)->Start(
                 match.destination_url)
                 ? "prerender"
                 : "none";
      break;
    case AutocompleteActionPredictor::ACTION_PRECONNECT:
      // ChromeOmniboxClient::DoPreconnect.
      if (!match.destination_url.SchemeIs(extensions::kExtensionScheme)) {
        if (predictors::LoadingPredictor* loading =
                predictors::LoadingPredictorFactory::GetForProfile(profile)) {
          loading->PrepareForPageLoad(
              /*initiator_origin=*/std::nullopt, match.destination_url,
              predictors::HintOrigin::OMNIBOX,
              network::GetNoOpNetworkRestrictionsId(),
              AutocompleteActionPredictor::IsPreconnectable(match));
          name = "preconnect";
        }
      }
      break;
    case AutocompleteActionPredictor::ACTION_NONE:
      break;
  }
  call.TakeReply().Send(base::DictValue().Set("action", name));
}

NN_ENGINE_CALL(nn_omnibox_opened) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  content::WebContents* contents = TabById(call.profile(), call.Double("tab"));
  Profile* profile =
      contents ? Profile::FromBrowserContext(contents->GetBrowserContext())
               : call.profile();
  AutocompleteActionPredictor* predictor =
      predictors::AutocompleteActionPredictorFactory::GetForProfile(profile);
  const GURL url(call.String("url"));
  // AutocompleteActionPredictor::OnOmniboxOpenedUrl and
  // ChromeOmniboxClient::OnRevert (an empty URL: nothing was opened).
  if (predictor && predictor->initialized()) {
    predictor->UpdateDatabaseFromTransitionalMatches(url);
  }
  // The bar closed without opening anything: its prerender goes too (Chrome
  // keeps it until the tab navigates). An opened page keeps it for Enter's
  // navigation, which activates it.
  if (url.is_empty() && contents) {
    if (BarPrerender* prerender = BarPrerender::FromWebContents(contents)) {
      prerender->Stop();
    }
  }
  call.TakeReply().Ok();
}
