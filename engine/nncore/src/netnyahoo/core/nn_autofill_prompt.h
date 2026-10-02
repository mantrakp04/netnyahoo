// Chrome's offers to save or update an address or a card after a form is sent, for the host's
// own UI. Chrome's controllers (AddressBubblesController, SaveCardBubbleControllerImpl) ask the
// window's AutofillBubbleHandler for a bubble; NNCore's returns one of these prompts, which tells
// the host (-[NNCoreWindowDelegate window:autofillPrompt:forTab:]) and answers the controller as
// Chrome's bubble views do (save_address_profile_view.cc, update_address_profile_view.cc,
// save_card_bubble_views.cc). Chrome keeps the controllers' lifetimes: it hides a prompt when the
// tab is switched away from, the page goes, or another offer replaces it.

#ifndef NETNYAHOO_CORE_NN_AUTOFILL_PROMPT_H_
#define NETNYAHOO_CORE_NN_AUTOFILL_PROMPT_H_

#import <Foundation/Foundation.h>

#include <memory>

namespace autofill {
class AutofillBubbleBase;
class SaveAddressBubbleController;
class SaveCardBubbleController;
class UpdateAddressBubbleController;
}  // namespace autofill

namespace content {
class WebContents;
}

namespace nncore {

// The bubbles Chrome's controllers expect (never null: they keep a reference to it).
autofill::AutofillBubbleBase* ShowSaveAddressPrompt(
    content::WebContents* contents,
    std::unique_ptr<autofill::SaveAddressBubbleController> controller);
autofill::AutofillBubbleBase* ShowUpdateAddressPrompt(
    content::WebContents* contents,
    std::unique_ptr<autofill::UpdateAddressBubbleController> controller);
autofill::AutofillBubbleBase* ShowSaveCardPrompt(
    content::WebContents* contents,
    autofill::SaveCardBubbleController* controller);
// Bubbles with no UI here (a local IBAN to save; Google Pay's card offers): closed at once,
// unanswered, so their controllers never hold a missing bubble.
autofill::AutofillBubbleBase* SkipIbanBubble(content::WebContents* contents);
autofill::AutofillBubbleBase* SkipOfferNotification(content::WebContents* contents);
// After an address is saved Chrome may offer to sign in to keep it in an account. There is no
// account here: the promo closes at once, as if dismissed.
autofill::AutofillBubbleBase* SkipAddressSignInPromo(content::WebContents* contents);

// The tab's pending offer, as the host was told it, or nil:
// {id, kind: "saveAddress" | "updateAddress" | "saveCard", origin, title, message, accept,
//  decline, footer, lines (what is saved, one string per line), changes (an update's
//  [{field: "name" | "address" | "email" | "phone" | "other", from, to}]), newLabel,
//  oldLabel}.
NSDictionary<NSString*, id>* AutofillPrompt(content::WebContents* contents);

// The host's answer to offer `prompt_id`: "accept" (save or update), "decline" (Chrome's "No
// thanks"), "dismiss" (its close button: no decision). An answer to an offer that is no longer
// pending is ignored.
void ResolveAutofillPrompt(content::WebContents* contents,
                           NSInteger prompt_id,
                           NSString* action);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_AUTOFILL_PROMPT_H_
