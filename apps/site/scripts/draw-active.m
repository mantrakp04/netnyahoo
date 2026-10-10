// The site's window captures (README › Screenshots): injected into a re-signed copy of a Debug Arcadia.app, every
// window draws as the active key window (coloured traffic lights, active materials) while the hidden instance stays
// BackgroundOnly and never activates, and a session's 1440 × 900 pt frame isn't cut down to the screen's visible frame.
//   clang -dynamiclib -fobjc-arc -framework AppKit -o draw-active.dylib draw-active.m && codesign -s - -f draw-active.dylib
//   copy the app, add com.apple.security.cs.allow-dyld-environment-variables and …disable-library-validation to its
//   entitlements, re-sign the bundle, then: scripts/agent/ac launch <copy> … --env DYLD_INSERT_LIBRARIES=<dylib>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <string.h>

static BOOL yes(id self, SEL _cmd) { return YES; }
static NSRect unconstrained(id self, SEL _cmd, NSRect rect, NSScreen *screen) { return rect; }

static void force(Class c, const char *name) {
  SEL sel = sel_registerName(name);
  Method m = class_getInstanceMethod(c, sel);
  if (m) method_setImplementation(m, (IMP)yes);
  else class_addMethod(c, sel, (IMP)yes, "c@:");
}

__attribute__((constructor)) static void drawActive(void) {
  const char *name = getprogname();
  if (!name || strcmp(name, "Arcadia") != 0) return;  // the app's process, not Chrome's helpers
  Class w = [NSWindow class];
  force(w, "_hasActiveAppearance");
  force(w, "_hasActiveAppearanceIgnoringKeyFocus");
  force(w, "_hasKeyAppearance");
  force(w, "_hasMainAppearance");
  method_setImplementation(class_getInstanceMethod(w, @selector(constrainFrameRect:toScreen:)), (IMP)unconstrained);
}
