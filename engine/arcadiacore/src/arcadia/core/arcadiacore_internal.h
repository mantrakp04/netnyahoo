// What ArcadiaCore's C++ side needs from its ObjC objects (not part of the host API).

#ifndef ARCADIA_CORE_ARCADIACORE_INTERNAL_H_
#define ARCADIA_CORE_ARCADIACORE_INTERNAL_H_

#import "arcadia/core/public/ArcadiaCore.h"

class Profile;

namespace content {
class WebContents;
}

namespace arcadiacore {
class WindowHost;

// Profiles Chrome is destroying (their OnProfileWillBeDestroyed was sent; an off-the-record
// one is destroyed once its renderers are gone): never handed out or given a Browser again.
void NoteProfileDying(Profile* profile);
bool IsProfileDying(const Profile* profile);
// Profiles the host asked Chrome to delete (-deleteProfile:completion:): Chrome closes their
// Browsers before it removes their folder, so they never get a Browser again (a new one, a
// hidden page's, would keep the profile and its folder).
void NoteProfileDeleting(Profile* profile);
bool IsProfileDeleting(const Profile* profile);
}

@interface ArcadiaCoreProfile ()
+ (ArcadiaCoreProfile*)wrapperFor:(Profile*)profile;
@property(readonly) Profile* chromeProfile;
@end

@interface ArcadiaCoreTab ()
- (instancetype)initWithContents:(content::WebContents*)contents;
@property(readonly) content::WebContents* contents;
- (void)contentsDestroyed;
- (void)notify:(SEL)selector;
@end

@interface ArcadiaCoreWindow ()
@property(readonly) arcadiacore::WindowHost* host;
@end

#endif  // ARCADIA_CORE_ARCADIACORE_INTERNAL_H_
