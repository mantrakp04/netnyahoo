// Addresses and cards are Chrome autofill's (it offers, fills and saves them in
// pages). For the settings pane this drives Chrome's settings page API
// (autofillPrivate) in a hidden chrome://settings.
#import "NNChromePages.h"

#import <LocalAuthentication/LocalAuthentication.h>

using namespace nn;

namespace {

NSString *const kPage = @"chrome://settings/";

// Our address keys ⇄ Chrome's autofill field types.
NSString *const kAddressFields =
    @"{ name: 'NAME_FULL', organization: 'COMPANY_NAME', street: 'ADDRESS_HOME_STREET_ADDRESS',"
     "  city: 'ADDRESS_HOME_CITY', state: 'ADDRESS_HOME_STATE', postalCode: 'ADDRESS_HOME_ZIP',"
     "  country: 'ADDRESS_HOME_COUNTRY', phone: 'PHONE_HOME_WHOLE_NUMBER', email: 'EMAIL_ADDRESS' }";

/// Our card network from Chrome's card icon ("chrome://theme/IDR_AUTOFILL_METADATA_CC_MASTERCARD").
NSString *const kCardNetwork =
    @"((c) => ({ VISA: 'visa', MASTERCARD: 'mastercard', AMEX: 'amex', DISCOVER: 'discover', DINERS: 'diners', JCB: 'jcb',"
     "  UNIONPAY: 'unionpay' })[((c.imageSrc || '').match(/_CC_([A-Z]+)/) || [])[1]] || 'card')";

void Run(NSString *profile, NSString *expression, NNResultCompletion completion) {
  pages::WebUIEval(profile, kPage, expression, ^(id value, NSString *error) {
    if (error) return completion(@{@"error" : error});
    completion([value isKindOfClass:NSDictionary.class] ? value : @{@"ok" : @YES});
  });
}

CefRefPtr<CefRequestContext> Context(NSString *profile) { return ContextForProfile(pages::DataProfile(profile)); }

bool BoolPreference(NSString *profile, const char *name) {
  CefRefPtr<CefValue> value = Context(profile)->GetPreference(name);
  return !value || value->GetType() != VTYPE_BOOL || value->GetBool();
}

void SetBoolPreference(NSString *profile, const char *name, bool on) {
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetBool(on);
  CefString error;
  if (!Context(profile)->SetPreference(name, value, error)) NSLog(@"[autofill] %s: %@", name, ToNS(error));
}

/// Touch ID, or the login password.
void Authenticate(NSString *reason, void (^completion)(BOOL ok)) {
  LAContext *context = [[LAContext alloc] init];
  [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication
          localizedReason:reason
                    reply:^(BOOL success, NSError *) { dispatch_async(dispatch_get_main_queue(), ^{ completion(success); }); }];
}

}  // namespace

@implementation NNAutofill

+ (NSDictionary<NSString *, NSNumber *> *)settingsForProfile:(NSString *)profile {
  return @{
    @"addresses" : @(BoolPreference(profile, "autofill.profile_enabled")),
    @"cards" : @(BoolPreference(profile, "autofill.credit_card_enabled")),
  };
}

+ (void)setSettings:(NSDictionary<NSString *, NSNumber *> *)settings profile:(NSString *)profile {
  if (settings[@"addresses"]) SetBoolPreference(profile, "autofill.profile_enabled", settings[@"addresses"].boolValue);
  if (settings[@"cards"]) SetBoolPreference(profile, "autofill.credit_card_enabled", settings[@"cards"].boolValue);
}

+ (void)addressesForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSString *js = [NSString stringWithFormat:
      @"chrome.autofillPrivate.getAddressList().then((list) => {"
       "  const keys = %@;"
       "  return { addresses: list.map((a) => {"
       "    const out = { id: a.guid, created: 0, modified: 0 };"
       "    for (const [key, type] of Object.entries(keys)) {"
       "      const field = a.fields.find((f) => f.type === type);"
       "      if (field && field.value) out[key] = field.value;"
       "    }"
       "    return out;"
       "  }) };"
       "})",
      kAddressFields];
  Run(profile, js, completion);
}

+ (void)saveAddress:(NSDictionary<NSString *, id> *)address profile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSString *format = [NSString stringWithFormat:
      @"(async () => {"
       "  const keys = %@, address = %%@;"
       "  const before = new Set((await chrome.autofillPrivate.getAddressList()).map((a) => a.guid));"
       // Every field, so a replaced address loses the ones it no longer has.
       "  const fields = Object.entries(keys).map(([key, type]) => ({ type, value: address[key] ? String(address[key]) : '' }));"
       "  await chrome.autofillPrivate.saveAddress({ guid: address.id || undefined, fields });"
       "  const name = (a) => (a.fields.find((f) => f.type === 'NAME_FULL') || {}).value || '';"
       "  for (let i = 0; i < 20; i++) {"  // Chrome's store writes asynchronously
       "    const list = await chrome.autofillPrivate.getAddressList();"
       "    const saved = address.id ? list.find((a) => a.guid === address.id && name(a) === (address.name || ''))"
       "                             : list.find((a) => !before.has(a.guid));"
       "    if (saved) return { id: saved.guid };"
       "    await new Promise((r) => setTimeout(r, 50));"
       "  }"
       "  return address.id ? { id: address.id } : { error: 'The address was not saved' };"
       "})()",
      kAddressFields];
  Run(profile, pages::Script(format, @[ address ]), completion);
}

+ (void)cardsForProfile:(NSString *)profile completion:(NNResultCompletion)completion {
  NSString *js = [NSString stringWithFormat:
      @"chrome.autofillPrivate.getCreditCardList().then((list) => ({ cards: list.map((c) => {"
       "  const digits = (c.cardNumber || '').replace(/\\D/g, '');"
       "  const label = (c.metadata && c.metadata.summarySublabel) || (c.metadata && c.metadata.summaryLabel) || '';"
       "  const last4 = digits.slice(-4) || (label.match(/(\\d{4})\\D*$/) || [])[1] || '';"
       "  return { id: c.guid, name: c.name || undefined, network: %@(c), last4,"
       "           expMonth: parseInt(c.expirationMonth, 10) || undefined, expYear: parseInt(c.expirationYear, 10) || undefined,"
       "           created: 0, modified: 0 };"
       "}) }))",
      kCardNetwork];
  Run(profile, js, completion);
}

+ (void)saveCard:(NSDictionary<NSString *, id> *)card
          number:(NSString *)number
         profile:(NSString *)profile
      completion:(NNResultCompletion)completion {
  NSString *js = pages::Script(
      @"(async () => {"
       "  const card = %@, number = %@;"
       "  const list = await chrome.autofillPrivate.getCreditCardList();"
       "  const current = card.id ? list.find((c) => c.guid === card.id) : null;"
       "  if (card.id && !current) return { error: 'No such card' };"
       "  const digits = (number || '').replace(/\\D/g, '');"
       "  if (!current && !/^\\d{12,19}$/.test(digits)) return { error: 'invalid number' };"
       "  const before = new Set(list.map((c) => c.guid));"
       "  const pad = (n) => (n ? String(n).padStart(2, '0') : undefined);"
       // The listed number is masked: an update without a new one leaves Chrome's alone.
       "  await chrome.autofillPrivate.saveCreditCard({ guid: card.id || undefined,"
       "    name: card.name ?? (current && current.name), cardNumber: digits || undefined,"
       "    expirationMonth: pad(card.expMonth) ?? (current && current.expirationMonth),"
       "    expirationYear: card.expYear ? String(card.expYear) : current && current.expirationYear,"
       "    nickname: current ? current.nickname : undefined });"
       "  if (card.id) return { id: card.id };"
       "  for (let i = 0; i < 20; i++) {"  // Chrome's store writes asynchronously
       "    const added = (await chrome.autofillPrivate.getCreditCardList()).find((c) => !before.has(c.guid));"
       "    if (added) return { id: added.guid };"
       "    await new Promise((r) => setTimeout(r, 50));"
       "  }"
       "  return { error: 'The card was not saved' };"
       "})()",
      @[ card, number ?: [NSNull null] ]);
  Run(profile, js, completion);
}

+ (void)deleteEntry:(NSString *)entryId profile:(NSString *)profile completion:(NNResultCompletion)completion {
  Run(profile,
      pages::Script(@"(async () => {"
                     "  const id = %@;"
                     "  const address = (await chrome.autofillPrivate.getAddressList()).some((a) => a.guid === id);"
                     "  await (address ? chrome.autofillPrivate.removeAddress(id) : chrome.autofillPrivate.removePaymentsEntity(id));"
                     "  const listed = async () => [...(await chrome.autofillPrivate.getAddressList()),"
                     "    ...(await chrome.autofillPrivate.getCreditCardList())].some((e) => e.guid === id);"
                     "  for (let i = 0; i < 20 && (await listed()); i++) await new Promise((r) => setTimeout(r, 50));"
                     "  return { ok: true };"
                     "})()",
                    @[ entryId ]),
      completion);
}

+ (void)revealCardNumber:(NSString *)cardId profile:(NSString *)profile completion:(NNResultCompletion)completion {
  Authenticate(@"show a saved card number", ^(BOOL ok) {
    if (!ok) return completion(@{});
    Run(profile,
        // Chrome's settings list masks numbers; its edit dialog's call has the whole one.
        pages::Script(@"new Promise((resolve) => chrome.autofillPrivate.getLocalCard(%@, resolve)).then((card) =>"
                       "  card ? { number: (card.cardNumber || '').replace(/\\D/g, '') || null } : {})",
                      @[ cardId ]),
        completion);
  });
}

@end
