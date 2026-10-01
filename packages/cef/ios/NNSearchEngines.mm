#import "NNExtensions.h"

#import "NNEngine.h"

using namespace nn;

@implementation NNExtensions (SearchEngines)

// Chrome's search engines (//chrome/browser/netnyahoo/nn_search_engines.h), as {list: {engines: [...]}}: the
// JS reads the extension-provided ones from every group of `list`.
+ (void)searchEngineListForProfile:(NSString *)profile completion:(NNExtensionsCompletion)completion {
  engine::Call("nn_search_engines_list", profile, nil, ^(NSDictionary *result) {
    if (result[@"error"]) return completion(result);
    completion(@{@"list" : @{@"engines" : result[@"engines"] ?: @[]}});
  });
}

@end
