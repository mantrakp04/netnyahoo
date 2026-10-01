#import "NNCoreNavigationDownloads.h"

#import "NNCoreInternal.h"

namespace nncore_host {

namespace {

constexpr NSTimeInterval kTTL = 7 * 86400;
NSMutableDictionary<NSString *, NSNumber *> *gSaved;
NSMutableDictionary<NSString *, NSMutableDictionary<NSString *, NSNumber *> *> *gPrivate;

NSString *SavedPath() { return [NNCoreHost.dataDirectory stringByAppendingPathComponent:@"NavigationDownloads.json"]; }

NSMutableDictionary<NSString *, NSNumber *> *Saved() {
  if (!gSaved) {
    NSData *data = [NSData dataWithContentsOfFile:SavedPath()];
    id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
    gSaved = [saved isKindOfClass:NSMutableDictionary.class] ? saved : [NSMutableDictionary dictionary];
    const NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    for (NSString *url in gSaved.allKeys)
      if (![gSaved[url] isKindOfClass:NSNumber.class] || now - gSaved[url].doubleValue > kTTL) [gSaved removeObjectForKey:url];
  }
  return gSaved;
}

}  // namespace

void NoteNavigationDownload(NSString *url, NSString *profile) {
  if (!url.length) return;
  NSNumber *now = @(NSDate.date.timeIntervalSince1970);
  if (IsIncognito(profile)) {
    if (!gPrivate) gPrivate = [NSMutableDictionary dictionary];
    if (!gPrivate[profile]) gPrivate[profile] = [NSMutableDictionary dictionary];
    gPrivate[profile][url] = now;
    return;
  }
  NSMutableDictionary *entries = Saved();
  entries[url] = now;
  if (entries.count > 200) {
    NSArray *oldest = [entries keysSortedByValueUsingSelector:@selector(compare:)];
    [entries removeObjectsForKeys:[oldest subarrayWithRange:NSMakeRange(0, entries.count - 200)]];
  }
  [[NSJSONSerialization dataWithJSONObject:entries options:0 error:nil] writeToFile:SavedPath() atomically:YES];
}

bool WasNavigationDownload(NSString *url, NSString *profile) {
  if (!url.length) return false;
  NSNumber *when = Saved()[url];
  if (!when && IsIncognito(profile)) when = gPrivate[profile][url];
  return when && NSDate.date.timeIntervalSince1970 - when.doubleValue < kTTL;
}

void ForgetPrivateNavigationDownloads(NSString *profile) {
  if (profile) [gPrivate removeObjectForKey:profile];
}

}  // namespace nncore_host
