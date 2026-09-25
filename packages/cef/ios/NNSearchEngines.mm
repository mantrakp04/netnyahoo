// Search engines extensions add (`chrome_settings_overrides.search_provider`) live in
// Chrome's TemplateURLService, which also decides which one, if any, controls the
// default search engine. The app reads them the way Chrome's settings page does
// (its search engines handler) in the profile's hidden chrome://settings.
#import "NNExtensions.h"

#import "NNChromePages.h"

using namespace nn;

namespace {

// Chrome 154 lists engines through getSearchEnginesList; the categorized call replaces it
// behind the SearchSettingsUpdate feature (asking for the other one CHECK-fails).
NSString *const kListScript =
    @"(async () => {"
     "  const { sendWithPromise } = await import('chrome://resources/js/cr.js');"
     "  const { loadTimeData } = await import('chrome://resources/js/load_time_data.js');"
     "  const categorized = loadTimeData.valueExists('searchSettingsUpdate') && loadTimeData.getBoolean('searchSettingsUpdate');"
     "  return { list: await sendWithPromise(categorized ? 'getCategorizedTemplateUrls' : 'getSearchEnginesList') };"
     "})()";

}  // namespace

@implementation NNExtensions (SearchEngines)

+ (void)searchEngineListForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  pages::WebUIEval(profile, @"chrome://settings/", kListScript, ^(id value, NSString *error) {
    if (error) return completion(@{@"error" : error});
    completion([value isKindOfClass:NSDictionary.class] ? value : @{@"list" : @{}});
  });
}

@end
