// Links to other apps (mailto:, zoommtg:…) from the host's tabs: Chrome decides as always
// (a blocked scheme, a remembered allow, a missing gesture), and where it would show its
// "Open <app>?" dialog the host is asked instead, in the wording packages/cef's
// NNExternalApps.mm used (JS ExternalAppRequest). "Open" launches through Chrome.

#include "netnyahoo/core/nn_external_apps.h"

#import <AppKit/AppKit.h>

#include <map>
#include <optional>
#include <string>

#include "base/base64.h"
#include "base/command_line.h"
#include "base/memory/weak_ptr.h"
#include "base/functional/bind.h"
#include "base/no_destructor.h"
#include "base/task/single_thread_task_runner.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/external_protocol/external_protocol_handler.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/common/pref_names.h"
#include "components/prefs/pref_service.h"
#include "chrome/browser/ui/browser_window/public/global_browser_collection.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents.h"
#include "netnyahoo/core/nn_browser.h"
#import "netnyahoo/core/nncore_internal.h"
#include "url/gurl.h"
#include "url/origin.h"
#include "services/network/public/cpp/is_potentially_trustworthy.h"
#include "content/public/browser/render_frame_host.h"

// The hook in Chrome's external_protocol_dialog.cc (engine/nncore/apply.sh).
extern bool (*g_netnyahoo_external_protocol_dialog)(
    const GURL& url,
    content::WebContents* web_contents,
    const std::optional<url::Origin>& initiating_origin,
    content::WeakDocumentPtr initiator_document,
    const std::u16string& program_name);

namespace nncore {

namespace {

struct Pending {
  GURL url;
  base::WeakPtr<content::WebContents> contents;
  std::optional<url::Origin> origin;
  content::WeakDocumentPtr initiator;
  bool can_remember = false;
};

std::map<std::string, Pending>& PendingRequests() {
  static base::NoDestructor<std::map<std::string, Pending>> pending;
  return *pending;
}

NSString* IconDataURI(NSURL* app, CGFloat size) {
  NSImage* icon = [NSWorkspace.sharedWorkspace iconForFile:app.path];
  if (!icon) {
    return nil;
  }
  NSBitmapImageRep* rep = [[NSBitmapImageRep alloc]
      initWithBitmapDataPlanes:nullptr
                    pixelsWide:size * 2
                    pixelsHigh:size * 2
                 bitsPerSample:8
               samplesPerPixel:4
                      hasAlpha:YES
                      isPlanar:NO
                colorSpaceName:NSDeviceRGBColorSpace
                   bytesPerRow:0
                  bitsPerPixel:0];
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext =
      [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [icon drawInRect:NSMakeRect(0, 0, size * 2, size * 2)];
  [NSGraphicsContext restoreGraphicsState];
  NSData* png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  return png ? [@"data:image/png;base64," stringByAppendingString:
                   [png base64EncodedStringWithOptions:0]]
             : nil;
}

bool AskHost(const GURL& url,
             content::WebContents* contents,
             const std::optional<url::Origin>& initiating_origin,
             content::WeakDocumentPtr initiator_document,
             const std::u16string& program_name) {
  BrowserWindowInterface* browser =
      GlobalBrowserCollection::GetInstance()->FindBrowserWithTab(contents);
  if (!browser || !WindowHost::ForBrowser(browser)) {
    return false;  // Chrome's own windows keep Chrome's dialog.
  }
  NNCoreTab* tab = TabBridge::GetOrCreate(contents)->tab();
  id<NNCoreTabDelegate> delegate = tab.delegate;
  if (![delegate respondsToSelector:@selector(tab:externalAppRequest:)]) {
    return false;
  }
  NSURL* ns_url = [NSURL URLWithString:base::SysUTF8ToNSString(url.spec())];
  NSURL* app = ns_url ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:ns_url]
                      : nil;
  NSString* name =
      app ? [NSFileManager.defaultManager displayNameAtPath:app.path]
                .stringByDeletingPathExtension
          : nil;
  if (!name.length && !program_name.empty()) {
    name = base::SysUTF16ToNSString(program_name);
  }
  const bool has_origin = initiating_origin && !initiating_origin->opaque();
  NSString* origin =
      has_origin ? base::SysUTF8ToNSString(initiating_origin->Serialize()) : nil;
  NSString* scheme = base::SysUTF8ToNSString(std::string(url.scheme()));
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  // As Chrome's dialog: "always" only for a trustworthy origin, outside incognito.
  const bool can_remember = app && has_origin && !profile->IsOffTheRecord() &&
                            network::IsOriginPotentiallyTrustworthy(*initiating_origin);

  static int last_id = 0;
  const std::string request_id = "x" + std::to_string(++last_id);
  if (app) {
    PendingRequests()[request_id] = {url, contents->GetWeakPtr(), initiating_origin,
                             initiator_document, can_remember};
  }
  NSString* title = app ? [NSString stringWithFormat:@"Open “%@”?", name]
                        : @"No application is set to open this link";
  NSString* message =
      app ? (origin ? [NSString stringWithFormat:@"%@ wants to open this application.",
                                                 origin]
                    : @"This page wants to open this application.")
          : [NSString stringWithFormat:@"Your Mac doesn’t have an app for “%@:” links.",
                                       scheme];
  NSString* remember =
      can_remember
          ? [NSString stringWithFormat:@"Always allow %@ to open links of this type in %@",
                                       origin, name]
          : nil;
  NSDictionary* request = @{
        @"id" : base::SysUTF8ToNSString(request_id),
        @"url" : base::SysUTF8ToNSString(url.spec()),
        @"scheme" : scheme,
        @"origin" : origin ?: NSNull.null,
        @"app" : app ? name : NSNull.null,
        @"appPath" : app.path ?: NSNull.null,
        @"icon" : (app ? IconDataURI(app, 64) : nil) ?: NSNull.null,
        @"title" : title,
        @"message" : message ?: NSNull.null,
        @"remember" : remember ?: NSNull.null,
  };
  // On the next turn: the host may answer (and launch) at once.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(
                     [](base::WeakPtr<content::WebContents> contents,
                        NSDictionary* request) {
                       if (!contents) {
                         return;
                       }
                       NNCoreTab* tab = TabBridge::GetOrCreate(contents.get())->tab();
                       id<NNCoreTabDelegate> delegate = tab.delegate;
                       if ([delegate respondsToSelector:@selector(tab:externalAppRequest:)]) {
                         [delegate tab:tab externalAppRequest:request];
                       }
                     },
                     contents->GetWeakPtr(), request));
  return true;
}

}  // namespace

namespace {

constexpr char kTestNoLaunchSwitch[] = "netnyahoo-test-external-protocol-no-launch";

NSMutableArray<NSDictionary*>* TestLaunches() {
  static NSMutableArray<NSDictionary*>* launches = [NSMutableArray array];
  return launches;
}

}  // namespace

void InstallExternalAppPrompts() {
  g_netnyahoo_external_protocol_dialog = &AskHost;
}

void ResolveExternalApp(const std::string& request_id, bool open, bool remember) {
  auto it = PendingRequests().find(request_id);
  if (it == PendingRequests().end()) {
    return;
  }
  Pending pending = std::move(it->second);
  PendingRequests().erase(it);
  content::WebContents* contents = pending.contents.get();
  // The page that asked must still be there (not navigated away from).
  if (!open || !contents || !pending.initiator.AsRenderFrameHostIfValid()) {
    return;
  }
  Profile* profile = Profile::FromBrowserContext(contents->GetBrowserContext());
  const std::string scheme(pending.url.scheme());
  if (remember && pending.can_remember && pending.origin) {
    // Chrome's own "always allow" (its protocol_handler prefs), as its dialog's checkbox.
    ExternalProtocolHandler::SetBlockState(scheme, *pending.origin,
                                           ExternalProtocolHandler::DONT_BLOCK, profile);
  }
  if (base::CommandLine::ForCurrentProcess()->HasSwitch(kTestNoLaunchSwitch)) {
    // Test runs: recorded, with what Chrome now remembers for the origin, not launched.
    // (Chrome's own prefs, not GetBlockState, which answers BLOCK for a while after any
    // request: its flood guard.)
    const base::DictValue* allowed =
        pending.origin ? profile->GetPrefs()
                             ->GetDict(prefs::kProtocolHandlerPerOriginAllowedProtocols)
                             .FindDict(pending.origin->Serialize())
                       : nullptr;
    const bool remembered = allowed && allowed->FindBool(scheme).value_or(false);
    [TestLaunches() addObject:@{
      @"url" : base::SysUTF8ToNSString(pending.url.spec()),
      @"remembered" : @(remembered),
    }];
    return;
  }
  ExternalProtocolHandler::LaunchUrlWithoutSecurityCheck(pending.url, contents,
                                                         pending.initiator);
}

NSArray<NSDictionary*>* TestExternalLaunches() {
  return [TestLaunches() copy];
}

}  // namespace nncore
