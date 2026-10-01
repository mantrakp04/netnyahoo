#pragma once

#import "NNCefInternal.h"

// Script in an extension's own page (chrome-extension://<id>/, a hidden Alloy view): how the app talks to the
// built-in content blocker, whose settings live behind its runtime messages. Main thread only.
namespace nn::extpage {

typedef void (^EvalCompletion)(id _Nullable value, NSString *_Nullable error);

// `format` with each %@ replaced by the next argument as JSON.
NSString *Script(NSString *format, NSArray *args);

void Eval(NSString *profile, NSString *extensionId, NSString *expression, EvalCompletion completion);
void Close(NSString *profile, NSString *extensionId);
void CloseAll();

}
