#import "NNExtensions.h"

#import "NNChromePages.h"

using namespace nn;

namespace {

NSString *const kListScript =
    @"(async () => {"
     "  const { sendWithPromise } = await import('chrome://resources/js/cr.js');"
     "  const { loadTimeData } = await import('chrome://resources/js/load_time_data.js');"
     "  const categorized = loadTimeData.valueExists('searchSettingsUpdate') && loadTimeData.getBoolean('searchSettingsUpdate');"
     "  return { list: await sendWithPromise(categorized ? 'getCategorizedTemplateUrls' : 'getSearchEnginesList') };"
     "})()";

}

@implementation NNExtensions (SearchEngines)

+ (void)searchEngineListForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  pages::WebUIEval(profile, @"chrome://settings/", kListScript, ^(id value, NSString *error) {
    if (error) return completion(@{@"error" : error});
    completion([value isKindOfClass:NSDictionary.class] ? value : @{@"list" : @{}});
  });
}

@end
