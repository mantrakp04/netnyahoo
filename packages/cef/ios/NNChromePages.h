#pragma once

#import "NNCefInternal.h"

namespace nn::pages {

typedef void (^EvalCompletion)(id _Nullable value, NSString *_Nullable error);

NSString *DataProfile(NSString *profile);

NSString *Script(NSString *format, NSArray *args);

void WebUIEval(NSString *profile, NSString *url, NSString *expression, EvalCompletion completion);
void SetWebUIDialogPath(NSString *profile, NSString *url, NSString *path);

void ExtensionEval(NSString *profile, NSString *extensionId, NSString *expression, EvalCompletion completion);
void CloseExtensionContext(NSString *profile, NSString *extensionId);

void CloseAll();

void WhenProfileReady(NSString *profile, void (^ready)(CefRefPtr<CefRequestContext> context));

}
