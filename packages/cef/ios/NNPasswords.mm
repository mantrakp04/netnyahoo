// Saved passwords are Chrome's (its password manager fills, saves and generates
// them in pages). For the settings pane and imports, this drives Chrome's own
// passwords page API (passwordsPrivate) in a hidden chrome://password-manager.
#import "NNChromePages.h"

#import <Security/Security.h>

using namespace nn;

namespace {

NSString *const kPage = @"chrome://password-manager/";

/// Our shape of Chrome's PasswordUiEntry list: {id, origin, username, storedIn, created}.
NSString *const kEntries =
    @"chrome.passwordsPrivate.getSavedPasswordList().then((list) => list.filter((p) => !p.isPasskey).map((p) => {"
     "  const realm = (p.affiliatedDomains && p.affiliatedDomains[0] && p.affiliatedDomains[0].signonRealm) || '';"
     "  return { id: p.id, origin: realm.replace(/\\/$/, ''), username: p.username, storedIn: p.storedIn,"
     "           created: p.creationTime || 0 };"
     "}))";

/// Chrome's store writes asynchronously: `settle(check)` waits (≤1 s) until a fresh list agrees.
NSString *const kSettle = @"const settle = async (check) => { for (let i = 0; i < 20 && !check(await list()); i++)"
                           " await new Promise((r) => setTimeout(r, 50)); };";

void Run(NSString *profile, NSString *expression, NNResultCompletion completion) {
  pages::WebUIEval(profile, kPage, expression, ^(id value, NSString *error) {
    if (error) return completion(@{@"error" : error});
    completion([value isKindOfClass:NSDictionary.class] ? value : @{@"ok" : @YES});
  });
}

/// `body` (a pages::Script format, filled from `args`) runs with `entry` (Chrome's
/// list item for origin + username, or null) in scope.
NSString *WithEntry(NSString *origin, NSString *username, NSString *body, NSArray *args = @[]) {
  NSString *format = [@[
    @"(async () => { const want = %@, user = %@; const list = () => ", kEntries, @"; ", kSettle,
    @" const find = (entries, name) => entries.find((e) => e.origin === want && e.username === name) || null;"
     " const entry = find(await list(), user); ", body, @" })()"
  ] componentsJoinedByString:@""];
  return pages::Script(format, [@[ OriginOf(origin) ?: origin, username ] arrayByAddingObjectsFromArray:args]);
}

CefRefPtr<CefRequestContext> Context(NSString *profile) { return ContextForProfile(pages::DataProfile(profile)); }

}  // namespace

@implementation NNPasswords

+ (BOOL)autofillEnabledForProfile:(NSString *)profile {
  CefRefPtr<CefValue> value = Context(profile)->GetPreference("credentials_enable_service");
  return !value || value->GetType() != VTYPE_BOOL || value->GetBool();
}

+ (void)setAutofillEnabled:(BOOL)enabled profile:(NSString *)profile {
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetBool(enabled);
  CefString error;
  if (!Context(profile)->SetPreference("credentials_enable_service", value, error))
    NSLog(@"[passwords] credentials_enable_service: %@", ToNS(error));
}

+ (void)listForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSString *js = [NSString stringWithFormat:@"%@.then((list) => ({ passwords: list.map((e) => ({"
                                             "  origin: e.origin, username: e.username, created: e.created, modified: e.created })) }))",
                                             kEntries];
  Run(profile, js, completion);
}

+ (void)unlockForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  // requestPlaintextPassword runs Chrome's device authentication; it rejects when the user cancels.
  Run(profile, @"(async () => {"
                "  const [first] = await chrome.passwordsPrivate.getSavedPasswordList();"
                "  if (!first) return { unlocked: true };"
                "  try { await chrome.passwordsPrivate.requestPlaintextPassword(first.id, 'VIEW'); return { unlocked: true }; }"
                "  catch (e) { return { unlocked: false }; }"
                "})()",
      completion);
}

+ (void)passwordForProfile:(NSString *)profile
                    origin:(NSString *)origin
                  username:(NSString *)username
                completion:(NNResultCompletion)completion {
  Run(profile, WithEntry(origin, username, @"if (!entry) return { error: 'No such password' };"
                                            "const [details] = await chrome.passwordsPrivate.requestCredentialsDetails([entry.id]);"
                                            "return { password: details ? details.password : null };"),
      completion);
}

+ (void)saveForProfile:(NSString *)profile
                origin:(NSString *)origin
              username:(NSString *)username
              password:(NSString *)password
            completion:(NNResultCompletion)completion {
  NSString *body = @"await chrome.passwordsPrivate.addPassword({ url: want, username: user, password: %@, note: '',"
                    " useAccountStore: false });"
                    "await settle((entries) => find(entries, user));"
                    "return { ok: true };";
  Run(profile, WithEntry(origin, username, body, @[ password ]), completion);
}

+ (void)updateForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
             newUsername:(NSString *)newUsername
             newPassword:(NSString *)newPassword
              completion:(NNResultCompletion)completion {
  NSString *body = @"if (!entry) return { error: 'No such password' };"
                    "const [details] = await chrome.passwordsPrivate.requestCredentialsDetails([entry.id]);"
                    "const changes = { username: %@, password: %@ };"
                    "await chrome.passwordsPrivate.changeCredential({ ...details,"
                    "  username: changes.username ?? details.username, password: changes.password ?? details.password });"
                    "await settle((entries) => find(entries, changes.username ?? user));"
                    "return { ok: true };";
  Run(profile, WithEntry(origin, username, body, @[ newUsername ?: [NSNull null], newPassword ?: [NSNull null] ]), completion);
}

+ (void)deleteForProfile:(NSString *)profile
                  origin:(NSString *)origin
                username:(NSString *)username
              completion:(NNResultCompletion)completion {
  Run(profile, WithEntry(origin, username, @"if (!entry) return { ok: true };"
                                            "await chrome.passwordsPrivate.removeCredential(entry.id, entry.storedIn);"
                                            "await settle((entries) => !find(entries, user));"
                                            "return { ok: true };"),
      completion);
}

+ (void)neverSaveOriginsForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  Run(profile, @"chrome.passwordsPrivate.getPasswordExceptionList().then((list) => ({ origins: list.map((e) =>"
                "  (e.urls.signonRealm || e.urls.link || '').replace(/\\/$/, '')).filter(Boolean) }))",
      completion);
}

+ (void)allowSavingForProfile:(NSString *)profile origin:(NSString *)origin completion:(NNResultCompletion)completion {
  NSString *js = pages::Script(@"(async () => {"
                                "  const want = %@;"
                                "  for (const e of await chrome.passwordsPrivate.getPasswordExceptionList())"
                                "    if ((e.urls.signonRealm || e.urls.link || '').replace(/\\/$/, '') === want)"
                                "      chrome.passwordsPrivate.removePasswordException(e.id);"
                                "  return { ok: true };"
                                "})()",
                               @[ OriginOf(origin) ?: origin ]);
  Run(profile, js, completion);
}

+ (NSString *)generatePassword {
  // Three groups of six, one digit and one capital somewhere: "abcdef-GHIjk2-lmnopq".
  static NSString *const lower = @"abcdefghijkmnopqrstuvwxyz";
  uint8_t bytes[32];
  if (SecRandomCopyBytes(kSecRandomDefault, sizeof bytes, bytes) != errSecSuccess) arc4random_buf(bytes, sizeof bytes);
  NSMutableString *out = [NSMutableString string];
  for (int i = 0; i < 18; i++) {
    if (i && i % 6 == 0) [out appendString:@"-"];
    [out appendFormat:@"%C", [lower characterAtIndex:bytes[i] % lower.length]];
  }
  NSUInteger digitAt = bytes[18] % 18, upperAt = (digitAt + 1 + bytes[19] % 17) % 18;
  auto position = [](NSUInteger i) { return i + i / 6; };  // skip the dashes
  [out replaceCharactersInRange:NSMakeRange(position(digitAt), 1) withString:[NSString stringWithFormat:@"%d", bytes[20] % 10]];
  NSRange upper = NSMakeRange(position(upperAt), 1);
  [out replaceCharactersInRange:upper withString:[out substringWithRange:upper].uppercaseString];
  return out;
}

@end
