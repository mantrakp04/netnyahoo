#import "ArcadiaCoreStartup.h"

#import <AppKit/AppKit.h>

#import "ACNativeMessaging.h"

namespace arcadiacore_host {

namespace {

// The system's preferred languages as Accept-Language, as packages/cef's AcceptLanguages (CefSettings
// accept_language_list): "fr-FR,fr,en-US,en". Chrome's own default comes from its UI locale, which on the Mac is the
// app bundle's localization (English only), so every page would be told "en-US,en".
std::string AcceptLanguages() {
  NSMutableOrderedSet<NSString *> *list = [NSMutableOrderedSet orderedSet];
  for (NSString *identifier in NSLocale.preferredLanguages) {
    NSLocale *locale = [NSLocale localeWithLocaleIdentifier:identifier];
    NSString *language = locale.languageCode, *region = locale.regionCode, *script = locale.scriptCode;
    if (!language.length) continue;
    if ([language isEqualToString:@"zh"] && !region.length) region = [script isEqualToString:@"Hant"] ? @"TW" : @"CN";
    if (region.length) [list addObject:[NSString stringWithFormat:@"%@-%@", language, region]];
    [list addObject:language];
  }
  return [list.array componentsJoinedByString:@","].UTF8String;
}

}  // namespace

void PrepareStartup(NSString *userDataDir, std::vector<std::string> &switches) {
  // Before Chrome reads them; a password manager installed while the app runs connects once the user comes back.
  ac::nativemessaging::SyncHosts(userDataDir);
  static dispatch_queue_t syncQueue = dispatch_queue_create("arcadia.native-messaging", DISPATCH_QUEUE_SERIAL);
  NSString *dir = [userDataDir copy];
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidBecomeActiveNotification
                                                  object:nil
                                                   queue:nil
                                              usingBlock:^(NSNotification *) {
                                                dispatch_async(syncQueue, ^{ ac::nativemessaging::SyncHosts(dir); });
                                              }];

  // Chrome's command-line pref for the languages it sends and pages read (navigator.languages): set every launch,
  // as CEF set the pref on every profile.
  const std::string languages = AcceptLanguages();
  if (!languages.empty()) switches.push_back("--accept-lang=" + languages);
}

}  // namespace arcadiacore_host
