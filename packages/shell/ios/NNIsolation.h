#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// A test instance (NETNYAHOO_DATA_DIR set, as an absolute path) keeps the app's own state in that directory: its
// defaults (+[NSUserDefaults standardUserDefaults] is its <dir>/Preferences/<bundle id>.plist, for the app, Sparkle,
// React Native and AppKit alike), its keychain items and its update checks. Nil in the owner's app, which is untouched.
FOUNDATION_EXPORT NSString *_Nullable NNIsolatedDataDirectory(void);

NS_ASSUME_NONNULL_END
