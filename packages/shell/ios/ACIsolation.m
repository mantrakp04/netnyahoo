#import "ACIsolation.h"

#import <objc/runtime.h>

static NSString *gDataDirectory;
static NSUserDefaults *gDefaults;

NSString *ACIsolatedDataDirectory(void) { return gDataDirectory; }

static NSUserDefaults *IsolatedStandardUserDefaults(id self, SEL _cmd) { return gDefaults; }

@interface ACIsolation : NSObject
@end

@implementation ACIsolation

// Before main, ahead of the app's own code, AppKit, React Native and Sparkle. A Debug build and the installed app share
// com.arcadia.browser; a test instance's persistent domain is a plist in its data dir instead. The argument, global
// and registration domains stay the process's own, as with the standard object. Only what goes through
// +standardUserDefaults is covered: CFPreferences on kCFPreferencesCurrentApplication still reaches the shared domain.
+ (void)load {
  const char *dir = getenv("ARCADIA_DATA_DIR");
  if (!dir || !*dir) return;
  NSString *path = @(dir);
  if (!path.absolutePath)
    path = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:path];
  gDataDirectory = path.stringByStandardizingPath;
  NSString *domain = NSBundle.mainBundle.bundleIdentifier ?: @"com.arcadia.browser";
  // A suite named by an absolute path is that plist (".plist" appended), never searched past to the app's domain.
  gDefaults = [[NSUserDefaults alloc]
      initWithSuiteName:[[gDataDirectory stringByAppendingPathComponent:@"Preferences"] stringByAppendingPathComponent:domain]];
  if (!gDefaults) return;
  method_setImplementation(class_getClassMethod(NSUserDefaults.class, @selector(standardUserDefaults)),
                           (IMP)IsolatedStandardUserDefaults);
}

@end
