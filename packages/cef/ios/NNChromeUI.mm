#import "NNChromeUI.h"

#import "NNClient.h"

using namespace nn;

namespace nn::chromeui {

NSDictionary *PasswordPrompt(CefRefPtr<CefBrowser> browser) {
#if NN_PASSWORD_PROMPT
  CefRefPtr<CefDictionaryValue> prompt = browser->GetHost()->GetPasswordPrompt();
  if (!prompt) return nil;
  // password_manager::ui::State. Other states (auto sign-in, generated-password and
  // Keychain notices…) keep Chrome's bubble.
  NSString *state = nil;
  switch (prompt->GetInt("state")) {
    case 1: state = @"save"; break;     // PENDING_PASSWORD_STATE
    case 7: state = @"update"; break;   // PENDING_PASSWORD_UPDATE_STATE
    case 2:                             // SAVE_CONFIRMATION_STATE
    case 3: state = @"saved"; break;    // UPDATE_CONFIRMATION_STATE
    default: return nil;
  }
  NSMutableArray *usernames = [NSMutableArray array];
  if (CefRefPtr<CefListValue> list = prompt->GetList("usernames"))
    for (size_t i = 0; i < list->GetSize(); i++) [usernames addObject:ToNS(list->GetString(i))];
  return @{
    @"state" : state,
    @"origin" : ToNS(prompt->GetString("origin")),
    @"username" : ToNS(prompt->GetString("username")),
    @"passwordLength" : @(prompt->GetInt("passwordLength")),
    @"federation" : ToNS(prompt->GetString("federation")),
    @"usernames" : usernames,
  };
#else
  return nil;
#endif
}

bool ShowPasswordPrompt(Client *client, CefRefPtr<CefBrowser> browser) {
  NSDictionary *prompt = client->View() ? PasswordPrompt(browser) : nil;
  if (!prompt) return false;
  client->Emit(@"passwordPrompt", prompt);
  return true;
}

void ResolvePasswordPrompt(CefRefPtr<CefBrowser> browser, NSString *action, NSString *username, NSString *password) {
#if NN_PASSWORD_PROMPT
  browser->GetHost()->ResolvePasswordPrompt(ToCef(action), ToCef(username ?: @""), ToCef(password ?: @""));
#endif
}

NSString *ExecuteExtensionAction(CefRefPtr<CefBrowser> browser, NSString *extensionId) {
#if NN_EXTENSION_ACTION
  switch (browser->GetHost()->ExecuteExtensionAction(ToCef(extensionId))) {
    case 0: return @"none";
    case 1: return @"popup";
    case 2: return @"sidePanel";
    default: return nil;
  }
#else
  return nil;
#endif
}

}  // namespace nn::chromeui
