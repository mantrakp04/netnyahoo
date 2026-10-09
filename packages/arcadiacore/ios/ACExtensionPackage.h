#pragma once

#import <Foundation/Foundation.h>

namespace ac::ext {

bool IsExtensionId(NSString *s);

NSDictionary *ReadManifest(NSString *folder);

NSString *IdForKey(NSString *base64Key);

NSString *DataURL(NSString *folder, NSString *relativePath);

}
