#import "NNIsolation.h"

#import <objc/runtime.h>

static NSString *gDataDirectory;
static NSUserDefaults *gDefaults;

NSString *NNIsolatedDataDirectory(void) { return gDataDirectory; }

static NSUserDefaults *IsolatedStandardUserDefaults(id self, SEL _cmd) { return gDefaults; }

@interface NNIsolation : NSObject
@end

@implementation NNIsolation

// Before main, ahead of the app's own code, AppKit, React Native and Sparkle. A Debug build and the installed app share
// com.netnyahoo.browser; a test instance's persistent domain is a plist in its data dir instead. The argument, global
// and registration domains stay the process's own, as with the standard object. Only what goes through
// +standardUserDefaults is covered: CFPreferences on kCFPreferencesCurrentApplication still reaches the shared domain.
+ (void)load {
  const char *dir = getenv("NETNYAHOO_DATA_DIR");
  if (!dir || !*dir) return;
  NSString *path = @(dir);
  if (!path.absolutePath)
    path = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:path];
  gDataDirectory = path.stringByStandardizingPath;
  NSString *domain = NSBundle.mainBundle.bundleIdentifier ?: @"com.netnyahoo.browser";
  // A suite named by an absolute path is that plist (".plist" appended), never searched past to the app's domain.
  gDefaults = [[NSUserDefaults alloc]
      initWithSuiteName:[[gDataDirectory stringByAppendingPathComponent:@"Preferences"] stringByAppendingPathComponent:domain]];
  if (!gDefaults) return;
  method_setImplementation(class_getClassMethod(NSUserDefaults.class, @selector(standardUserDefaults)),
                           (IMP)IsolatedStandardUserDefaults);
}

@end
