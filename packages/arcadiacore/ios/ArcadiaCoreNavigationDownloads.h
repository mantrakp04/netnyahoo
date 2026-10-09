// Pages that turned out to be downloads, so a restored or reopened tab doesn't download them again at every launch
// (packages/cef's NoteNavigationDownload / WasNavigationDownload). Normal profiles' entries persist in
// NavigationDownloads.json in the user data dir (7 days, the newest 200); private ones stay in memory, per profile.
#import <Foundation/Foundation.h>

namespace arcadiacore_host {

void NoteNavigationDownload(NSString *url, NSString *profile);
bool WasNavigationDownload(NSString *url, NSString *profile);
void ForgetPrivateNavigationDownloads(NSString *profile);

}  // namespace arcadiacore_host
