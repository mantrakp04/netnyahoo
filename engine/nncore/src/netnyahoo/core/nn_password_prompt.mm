#include "netnyahoo/core/nn_password_prompt.h"

#include <string>

#include "base/memory/weak_ptr.h"
#include "base/strings/sys_string_conversions.h"
#include "chrome/browser/ui/passwords/passwords_model_delegate.h"
#include "components/password_manager/core/browser/password_form.h"
#include "components/password_manager/core/browser/password_string.h"
#include "components/password_manager/core/common/password_manager_ui.h"
#include "url/origin.h"

namespace nncore {

namespace {

base::WeakPtr<PasswordsModelDelegate> ModelFor(content::WebContents* contents) {
  return contents ? PasswordsModelDelegateFromWebContents(contents) : nullptr;
}

}  // namespace

NSDictionary<NSString*, id>* PasswordPrompt(content::WebContents* contents) {
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  if (!model) {
    return nil;
  }
  using password_manager::ui::State;
  const State state = model->GetState();
  NSString* name = nil;
  switch (state) {
    case State::PENDING_PASSWORD_STATE:
      name = @"save";
      break;
    case State::PENDING_PASSWORD_UPDATE_STATE:
      name = @"update";
      break;
    case State::SAVE_CONFIRMATION_STATE:
    case State::UPDATE_CONFIRMATION_STATE:
      name = @"saved";
      break;
    default:
      return nil;
  }
  // The pending form's details for the states that have one (as CEF reports them).
  NSString* username = @"";
  NSUInteger length = 0;
  NSString* federation = @"";
  if (state != State::UPDATE_CONFIRMATION_STATE) {
    const password_manager::PasswordForm& form = model->GetPendingPassword();
    username = base::SysUTF16ToNSString(form.username_value);
    length = form.password_value.size();
    if (form.federation_origin.IsValid()) {
      federation = base::SysUTF8ToNSString(form.federation_origin.Serialize());
    }
  }
  NSMutableArray<NSString*>* usernames = [NSMutableArray array];
  for (const auto& form : model->GetCurrentForms()) {
    if (form && !form->username_value.empty()) {
      [usernames addObject:base::SysUTF16ToNSString(form->username_value)];
    }
  }
  return @{
    @"state" : name,
    @"origin" : base::SysUTF8ToNSString(model->GetOrigin().Serialize()),
    @"username" : username,
    @"passwordLength" : @(length),
    @"federation" : federation,
    @"usernames" : usernames,
  };
}

void PasswordPromptShown(content::WebContents* contents) {
  // What Chrome's bubble reports once shown; resolving reports it hidden again.
  if (base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents)) {
    model->OnBubbleShown();
  }
}

void PasswordConfirmationShown(content::WebContents* contents) {
  // "Saved" asks nothing: the host may never answer it, so it counts as shown and closed
  // at once (Chrome's own closes by itself). A closed bubble lets a new page reset the state.
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  using password_manager::ui::State;
  if (model && (model->GetState() == State::SAVE_CONFIRMATION_STATE ||
                model->GetState() == State::UPDATE_CONFIRMATION_STATE)) {
    model->OnBubbleHidden();
  }
}

void ResolvePasswordPrompt(content::WebContents* contents,
                           NSString* action,
                           NSString* username,
                           NSString* password) {
  base::WeakPtr<PasswordsModelDelegate> model = ModelFor(contents);
  if (!model) {
    return;
  }
  // Only what the current prompt offers: a late or repeated answer (a second "save" after
  // the first moved Chrome on) would hit the controller's state CHECKs. It is dropped
  // whole, so it never closes a newer prompt either.
  using password_manager::ui::State;
  const State state = model->GetState();
  const bool offers_save =
      state == State::PENDING_PASSWORD_STATE || state == State::PENDING_PASSWORD_UPDATE_STATE;
  if ((([action isEqualToString:@"save"] || [action isEqualToString:@"update"]) && !offers_save) ||
      ([action isEqualToString:@"never"] && state != State::PENDING_PASSWORD_STATE) ||
      ([action isEqualToString:@"nope"] && state != State::PENDING_PASSWORD_UPDATE_STATE)) {
    return;
  }
  if ([action isEqualToString:@"save"] || [action isEqualToString:@"update"]) {
    const password_manager::PasswordForm& pending = model->GetPendingPassword();
    model->SavePassword(
        username.length ? base::SysNSStringToUTF16(username) : pending.username_value,
        password.length ? password_manager::PasswordString(base::SysNSStringToUTF16(password))
                        : pending.password_value);
  } else if ([action isEqualToString:@"never"]) {
    model->NeverSavePassword();
  } else if ([action isEqualToString:@"nope"]) {
    model->OnNopeUpdateClicked();
  } else if (![action isEqualToString:@"dismiss"]) {
    return;
  }
  // As Chrome's bubble closing after any of these (the action may have destroyed the model).
  if (model) {
    model->OnBubbleHidden();
  }
}

}  // namespace nncore
