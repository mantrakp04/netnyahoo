// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_autofill.h"

#include <cmath>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "base/task/sequenced_task_runner.h"
#include "base/time/time.h"
#include "base/uuid.h"
#include "chrome/browser/autofill/personal_data_manager_factory.h"
#include "chrome/browser/netnyahoo/nn_reauth.h"
#include "chrome/browser/netnyahoo/nn_sensitive_args.h"
#include "components/autofill/core/browser/data_manager/addresses/address_data_manager.h"
#include "components/autofill/core/browser/data_manager/payments/payments_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager_observer.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_i18n_api.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile_comparator.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"
#include "components/autofill/core/browser/field_types.h"
#include "components/autofill/core/common/credit_card_network_identifiers.h"
#include "components/strings/grit/components_strings.h"
#include "ui/base/l10n/l10n_util.h"

namespace netnyahoo {
namespace {

using autofill::PersonalDataManager;

constexpr int kSettleChecks = 20;
constexpr base::TimeDelta kSettleStep = base::Milliseconds(50);

// The app's address keys and Chrome's field types.
constexpr std::pair<const char*, autofill::FieldType> kAddressFields[] = {
    {"name", autofill::NAME_FULL},
    {"organization", autofill::COMPANY_NAME},
    {"street", autofill::ADDRESS_HOME_STREET_ADDRESS},
    {"city", autofill::ADDRESS_HOME_CITY},
    {"state", autofill::ADDRESS_HOME_STATE},
    {"postalCode", autofill::ADDRESS_HOME_ZIP},
    {"country", autofill::ADDRESS_HOME_COUNTRY},
    {"phone", autofill::PHONE_HOME_WHOLE_NUMBER},
    {"email", autofill::EMAIL_ADDRESS},
};

const char* NetworkName(const std::string& network) {
  static constexpr std::pair<const char*, const char*> kNetworks[] = {
      {autofill::kVisaCard, "visa"},
      {autofill::kMasterCard, "mastercard"},
      {autofill::kAmericanExpressCard, "amex"},
      {autofill::kDiscoverCard, "discover"},
      {autofill::kDinersCard, "diners"},
      {autofill::kJCBCard, "jcb"},
      {autofill::kUnionPay, "unionpay"},
  };
  for (const auto& [id, name] : kNetworks) {
    if (network == id) {
      return name;
    }
  }
  return "card";
}

std::string Digits(const std::string& text) {
  std::string digits;
  for (char c : text) {
    if (base::IsAsciiDigit(c)) {
      digits.push_back(c);
    }
  }
  return digits;
}

base::DictValue AddressEntry(const autofill::AutofillProfile& profile) {
  base::DictValue entry;
  entry.Set("id", profile.guid());
  for (const auto& [key, type] : kAddressFields) {
    std::u16string value = profile.GetRawInfo(type);
    if (!value.empty()) {
      entry.Set(key, value);
    }
  }
  return entry;
}

base::DictValue CardEntry(const autofill::CreditCard& card) {
  base::DictValue entry;
  entry.Set("id", card.guid());
  std::u16string name = card.GetRawInfo(autofill::CREDIT_CARD_NAME_FULL);
  if (!name.empty()) {
    entry.Set("name", name);
  }
  entry.Set("network", NetworkName(card.network()));
  entry.Set("last4", card.LastFourDigits());
  if (card.expiration_month()) {
    entry.Set("expMonth", card.expiration_month());
  }
  if (card.expiration_year()) {
    entry.Set("expYear", card.expiration_year());
  }
  return entry;
}

using Ready = base::OnceCallback<void(PersonalDataManager*)>;

// Calls that wait for the profile's addresses and cards to load.
class AutofillState : public ProfileState,
                      public autofill::PersonalDataManagerObserver {
 public:
  explicit AutofillState(Profile* profile) : ProfileState(profile) {}

  void WhenLoaded(PersonalDataManager* pdm, Ready ready) {
    if (!observation_.IsObserving()) {
      observation_.Observe(pdm);
    }
    if (pdm->IsDataLoaded()) {
      return std::move(ready).Run(pdm);
    }
    waiting_.push_back(std::move(ready));
  }

  // How many times the data changed: Chrome notifies once a write has gone
  // through its database and the data was read back.
  int changes() const { return changes_; }
  base::WeakPtr<AutofillState> GetWeakPtr() {
    return weak_factory_.GetWeakPtr();
  }

 private:
  void Release() override {
    weak_factory_.InvalidateWeakPtrs();
    observation_.Reset();
    waiting_.clear();
  }

  void OnPersonalDataChanged() override {
    ++changes_;
    PersonalDataManager* pdm = observation_.GetSource();
    if (!pdm->IsDataLoaded()) {
      return;
    }
    for (Ready& ready : std::exchange(waiting_, {})) {
      std::move(ready).Run(pdm);
    }
  }

  base::ScopedObservation<PersonalDataManager,
                          autofill::PersonalDataManagerObserver>
      observation_{this};
  std::vector<Ready> waiting_;
  int changes_ = 0;
  base::WeakPtrFactory<AutofillState> weak_factory_{this};
};

// Runs |then| with the loaded data manager, or replies with an error.
void Load(const Call& call,
          base::OnceCallback<void(PersonalDataManager*, Reply)> then,
          Reply reply) {
  PersonalDataManager* pdm =
      autofill::PersonalDataManagerFactory::GetForBrowserContext(
          call.profile());
  if (!pdm) {
    return reply.Error("no autofill in this profile");
  }
  StateFor<AutofillState>(call.profile())
      .WhenLoaded(pdm, base::BindOnce(
                           [](base::OnceCallback<void(PersonalDataManager*,
                                                      Reply)> then,
                              Reply reply, PersonalDataManager* pdm) {
                             std::move(then).Run(pdm, std::move(reply));
                           },
                           std::move(then), std::move(reply)));
}

using Check = base::RepeatingCallback<bool(PersonalDataManager*)>;

// A write in flight: the data manager, and the change count before it.
struct Write {
  base::WeakPtr<PersonalDataManager> pdm;
  base::WeakPtr<AutofillState> state;
  int changes;
};

Write StartWrite(Profile* profile, PersonalDataManager* pdm) {
  AutofillState& state = StateFor<AutofillState>(profile);
  return {pdm->GetWeakPtr(), state.GetWeakPtr(), state.changes()};
}

// Sends |result| once Chrome has written the change (its data changed since
// the write began: the in-memory copy updates before the database does) and
// |landed| holds for what it read back; an error after kSettleChecks (Chrome
// refused it: a duplicate, say).
void Settle(Write write,
            Check landed,
            base::DictValue result,
            Reply reply,
            int checks_left = kSettleChecks) {
  if (!write.pdm || !write.state) {
    return reply.Error("closed");
  }
  if (write.state->changes() > write.changes && landed.Run(write.pdm.get())) {
    return reply.Send(std::move(result));
  }
  if (checks_left <= 1) {
    return reply.Error("Chrome didn't save the change");
  }
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&Settle, write, landed, std::move(result),
                     std::move(reply), checks_left - 1),
      kSettleStep);
}

// Imports: what the call parses before it returns, kept until the data loads.
constexpr size_t kMaxImportBytes = 4 * 1024 * 1024;
constexpr size_t kMaxImportItems = 1000;

struct ImportedAddress {
  std::vector<std::pair<autofill::FieldType, std::u16string>> fields;
  std::string country;
};

struct ImportBatch {
  std::vector<ImportedAddress> addresses;
  std::vector<autofill::CreditCard> cards;
  int rejected = 0;
};

std::optional<int> IntArg(const base::DictValue& dict, std::string_view key) {
  if (std::optional<int> value = dict.FindInt(key)) {
    return value;
  }
  if (std::optional<double> value = dict.FindDouble(key);
      value && std::isfinite(*value) && std::abs(*value) < 1e6) {
    return static_cast<int>(*value);
  }
  int value = 0;
  const std::string* text = dict.FindString(key);
  if (text && base::StringToInt(*text, &value)) {
    return value;
  }
  return std::nullopt;
}

bool PassesLuhn(const std::string& digits) {
  int sum = 0;
  bool twice = false;
  for (size_t i = digits.size(); i-- > 0;) {
    int digit = digits[i] - '0';
    if (twice) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    twice = !twice;
  }
  return sum % 10 == 0;
}

std::optional<ImportedAddress> ToAddress(const base::Value& entry) {
  const base::DictValue* dict = entry.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  ImportedAddress address;
  for (const auto& [key, type] : kAddressFields) {
    const std::string* value = dict->FindString(key);
    if (!value) {
      continue;
    }
    std::u16string trimmed;
    base::TrimWhitespace(base::UTF8ToUTF16(*value), base::TRIM_ALL, &trimmed);
    if (!trimmed.empty()) {
      address.fields.emplace_back(type, std::move(trimmed));
    }
  }
  if (address.fields.empty()) {
    return std::nullopt;
  }
  if (const std::string* country = dict->FindString("country")) {
    address.country = base::ToUpperASCII(*country);
  }
  return address;
}

// A local card with a 12–19 digit number that passes Luhn and a plausible
// expiry (an expired card is kept, as Chrome keeps one). The number's copies
// made here are zeroed.
std::optional<autofill::CreditCard> ToCard(const base::Value& entry) {
  const base::DictValue* dict = entry.GetIfDict();
  if (!dict) {
    return std::nullopt;
  }
  const std::string* number = dict->FindString("number");
  if (!number) {
    return std::nullopt;
  }
  std::string digits;
  digits.reserve(number->size());
  bool clean = true;
  for (char c : *number) {
    if (base::IsAsciiDigit(c)) {
      digits.push_back(c);
    } else if (c != ' ' && c != '-') {
      clean = false;
    }
  }
  const bool valid =
      clean && digits.size() >= 12 && digits.size() <= 19 && PassesLuhn(digits);
  std::optional<int> month = IntArg(*dict, "expMonth");
  std::optional<int> year = IntArg(*dict, "expYear");
  if (year && *year > 0 && *year < 100) {
    *year += 2000;
  }
  const bool valid_expiry =
      (!month || *month == 0 || (*month >= 1 && *month <= 12)) &&
      (!year || *year == 0 || (*year >= 1900 && *year <= 2199));
  if (!valid || !valid_expiry) {
    Cleanse(digits);
    return std::nullopt;
  }

  // As chrome://settings adds a card (autofillPrivate's saveCreditCard).
  autofill::CreditCard card(base::Uuid::GenerateRandomV4().AsLowercaseString());
  card.set_is_user_confirmed(true);
  std::u16string number16 = base::ASCIIToUTF16(digits);
  card.SetRawInfo(autofill::CREDIT_CARD_NUMBER, number16);
  Cleanse(number16);
  Cleanse(digits);
  if (const std::string* name = dict->FindString("name")) {
    card.SetRawInfo(autofill::CREDIT_CARD_NAME_FULL, base::UTF8ToUTF16(*name));
  }
  if (month && *month > 0) {
    card.SetExpirationMonth(*month);
  }
  if (year && *year > 0) {
    card.SetExpirationYear(*year);
  }
  if (const std::string* nickname = dict->FindString("nickname");
      nickname && !nickname->empty()) {
    card.SetNickname(base::UTF8ToUTF16(*nickname));
  }
  return card;
}

// Adds what the profile doesn't have yet; replies once it's queued.
void ImportLoaded(ImportBatch batch, PersonalDataManager* pdm, Reply reply) {
  autofill::AddressDataManager& adm = pdm->address_data_manager();
  autofill::PaymentsDataManager& paydm = pdm->payments_data_manager();
  autofill::AutofillProfileComparator comparator(adm.app_locale());
  int existing = 0;
  int rejected = batch.rejected;

  std::vector<autofill::AutofillProfile> added_addresses;
  for (const ImportedAddress& address : batch.addresses) {
    // As chrome://settings saves an address (autofillPrivate's saveAddress).
    autofill::AutofillProfile profile(
        adm.IsEligibleForAddressAccountStorage()
            ? autofill::AutofillProfile::RecordType::kAccount
            : autofill::AutofillProfile::RecordType::kLocalOrSyncable,
        !address.country.empty()
            ? autofill::AddressCountryCode(address.country)
            : autofill::i18n_model_definition::kLegacyHierarchyCountryCode);
    for (const auto& [type, value] : address.fields) {
      profile.SetRawInfoWithVerificationStatus(
          type, value, autofill::VerificationStatus::kUserVerified);
    }
    profile.FinalizeAfterImport();
    if (profile.IsEmpty(adm.app_locale())) {
      ++rejected;
      continue;
    }
    bool present = false;
    for (const autofill::AutofillProfile* other : adm.GetProfiles()) {
      present = present || profile.IsSubsetOf(comparator, *other);
    }
    for (const autofill::AutofillProfile& other : added_addresses) {
      present = present || profile.IsSubsetOf(comparator, other);
    }
    if (present) {
      ++existing;
      continue;
    }
    adm.AddProfile(profile);
    added_addresses.push_back(std::move(profile));
  }

  std::vector<const autofill::CreditCard*> added_cards;
  for (const autofill::CreditCard& card : batch.cards) {
    bool present = false;
    for (const autofill::CreditCard* other : paydm.GetCreditCards()) {
      present = present || card.HasSameNumberAs(*other);
    }
    for (const autofill::CreditCard* other : added_cards) {
      present = present || card.HasSameNumberAs(*other);
    }
    if (present) {
      ++existing;
      continue;
    }
    paydm.AddCreditCard(card);
    added_cards.push_back(&card);
  }

  reply.Send(base::DictValue()
                 .Set("addresses", static_cast<int>(added_addresses.size()))
                 .Set("cards", static_cast<int>(added_cards.size()))
                 .Set("existing", existing)
                 .Set("rejected", rejected));
}

}  // namespace
}  // namespace netnyahoo

using netnyahoo::Call;
using netnyahoo::Reply;
using autofill::PersonalDataManager;

#define NN_AUTOFILL_CALL()                           \
  Call call(profile_dir, args_json, reply, context); \
  if (!call) {                                       \
    return;                                          \
  }

NN_ENGINE_CALL(nn_autofill_addresses) {
  NN_AUTOFILL_CALL();
  netnyahoo::Load(
      call, base::BindOnce([](PersonalDataManager* pdm, Reply reply) {
        base::ListValue list;
        for (const autofill::AutofillProfile* profile :
             pdm->address_data_manager().GetProfilesForSettings()) {
          list.Append(netnyahoo::AddressEntry(*profile));
        }
        reply.Send(base::DictValue().Set("addresses", std::move(list)));
      }),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_save_address) {
  NN_AUTOFILL_CALL();
  const base::DictValue* address = call.args().FindDict("address");
  if (!address) {
    return call.TakeReply().Error("address required");
  }
  netnyahoo::Load(
      call,
      base::BindOnce(
          [](Profile* owner, base::DictValue address, PersonalDataManager* pdm,
             Reply reply) {
            autofill::AddressDataManager& adm = pdm->address_data_manager();
            const std::string* id = address.FindString("id");
            const autofill::AutofillProfile* existing =
                id && !id->empty() ? adm.GetProfileByGUID(*id) : nullptr;
            if (id && !id->empty() && !existing) {
              return reply.Error("No such address");
            }
            // As chrome://settings saves an address (autofillPrivate's
            // saveAddress): every field, trimmed and user-verified.
            const std::string* country = address.FindString("country");
            autofill::AutofillProfile profile =
                existing
                    ? *existing
                    : autofill::AutofillProfile(
                          adm.IsEligibleForAddressAccountStorage()
                              ? autofill::AutofillProfile::RecordType::kAccount
                              : autofill::AutofillProfile::RecordType::
                                    kLocalOrSyncable,
                          country && !country->empty()
                              ? autofill::AddressCountryCode(*country)
                              : autofill::i18n_model_definition::
                                    kLegacyHierarchyCountryCode);
            for (const auto& [key, type] : netnyahoo::kAddressFields) {
              const std::string* value = address.FindString(key);
              std::u16string trimmed;
              base::TrimWhitespace(base::UTF8ToUTF16(value ? *value : ""),
                                   base::TRIM_ALL, &trimmed);
              profile.SetRawInfoWithVerificationStatus(
                  type, trimmed, autofill::VerificationStatus::kUserVerified);
            }
            profile.FinalizeAfterImport();
            const std::string guid = profile.guid();
            if (existing && existing->Compare(profile) == 0) {
              return reply.Send(base::DictValue().Set("id", guid));
            }
            netnyahoo::Write write = netnyahoo::StartWrite(owner, pdm);
            if (existing) {
              adm.UpdateProfile(profile);
            } else {
              adm.AddProfile(profile);
            }
            netnyahoo::Settle(
                write,
                base::BindRepeating(
                    [](const autofill::AutofillProfile& wanted,
                       PersonalDataManager* pdm) {
                      const autofill::AutofillProfile* saved =
                          pdm->address_data_manager().GetProfileByGUID(
                              wanted.guid());
                      return saved && saved->Compare(wanted) == 0;
                    },
                    profile),
                base::DictValue().Set("id", guid), std::move(reply));
          },
          call.profile(), address->Clone()),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_cards) {
  NN_AUTOFILL_CALL();
  netnyahoo::Load(
      call, base::BindOnce([](PersonalDataManager* pdm, Reply reply) {
        base::ListValue list;
        for (const autofill::CreditCard* card :
             pdm->payments_data_manager().GetCreditCards()) {
          list.Append(netnyahoo::CardEntry(*card));
        }
        reply.Send(base::DictValue().Set("cards", std::move(list)));
      }),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_save_card) {
  NN_AUTOFILL_CALL();
  const base::DictValue* card = call.args().FindDict("card");
  if (!card) {
    return call.TakeReply().Error("card required");
  }
  netnyahoo::Load(
      call,
      base::BindOnce(
          [](Profile* owner, base::DictValue card, std::string number,
             PersonalDataManager* pdm,
             Reply reply) {
            autofill::PaymentsDataManager& paydm = pdm->payments_data_manager();
            const std::string* id = card.FindString("id");
            const autofill::CreditCard* existing =
                id && !id->empty() ? paydm.GetCreditCardByGUID(*id) : nullptr;
            if (id && !id->empty() && !existing) {
              return reply.Error("No such card");
            }
            const std::string digits = netnyahoo::Digits(number);
            if (!existing && (digits.size() < 12 || digits.size() > 19)) {
              return reply.Error("invalid number");
            }
            // As chrome://settings saves a card (autofillPrivate's
            // saveCreditCard): only the fields given change.
            autofill::CreditCard credit_card =
                existing ? *existing
                         : autofill::CreditCard(
                               base::Uuid::GenerateRandomV4()
                                   .AsLowercaseString());
            if (!existing) {
              credit_card.set_is_user_confirmed(true);
            }
            if (const std::string* name = card.FindString("name")) {
              credit_card.SetRawInfo(autofill::CREDIT_CARD_NAME_FULL,
                                     base::UTF8ToUTF16(*name));
            }
            if (!digits.empty()) {
              credit_card.SetRawInfo(autofill::CREDIT_CARD_NUMBER,
                                     base::UTF8ToUTF16(digits));
            }
            if (std::optional<int> month = card.FindInt("expMonth");
                month && *month > 0) {
              credit_card.SetRawInfo(
                  autofill::CREDIT_CARD_EXP_MONTH,
                  base::UTF8ToUTF16((*month < 10 ? "0" : "") +
                                    base::NumberToString(*month)));
            }
            if (std::optional<int> year = card.FindInt("expYear");
                year && *year > 0) {
              credit_card.SetRawInfo(autofill::CREDIT_CARD_EXP_4_DIGIT_YEAR,
                                     base::NumberToString16(*year));
            }
            const std::string guid = credit_card.guid();
            if (existing && existing->Compare(credit_card) == 0) {
              return reply.Send(base::DictValue().Set("id", guid));
            }
            netnyahoo::Write write = netnyahoo::StartWrite(owner, pdm);
            if (existing) {
              paydm.UpdateCreditCard(credit_card);
            } else {
              paydm.AddCreditCard(credit_card);
            }
            netnyahoo::Settle(
                write,
                base::BindRepeating(
                    [](const autofill::CreditCard& wanted,
                       PersonalDataManager* pdm) {
                      const autofill::CreditCard* saved =
                          pdm->payments_data_manager().GetCreditCardByGUID(
                              wanted.guid());
                      return saved && saved->Compare(wanted) == 0;
                    },
                    credit_card),
                base::DictValue().Set("id", guid), std::move(reply));
          },
          call.profile(), card->Clone(), call.String("number")),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_remove) {
  NN_AUTOFILL_CALL();
  netnyahoo::Load(
      call,
      base::BindOnce(
          [](Profile* owner, std::string id, PersonalDataManager* pdm,
             Reply reply) {
            const bool address =
                !!pdm->address_data_manager().GetProfileByGUID(id);
            if (!address &&
                !pdm->payments_data_manager().GetCreditCardByGUID(id)) {
              return reply.Ok();
            }
            netnyahoo::Write write = netnyahoo::StartWrite(owner, pdm);
            if (address) {
              pdm->address_data_manager().RemoveProfile(id);
            } else {
              pdm->payments_data_manager().RemoveByGUID(id);
            }
            netnyahoo::Settle(
                write,
                base::BindRepeating(
                    [](const std::string& id, PersonalDataManager* pdm) {
                      return !pdm->address_data_manager().GetProfileByGUID(
                                 id) &&
                             !pdm->payments_data_manager().GetCreditCardByGUID(
                                 id);
                    },
                    id),
                base::DictValue().Set("ok", true), std::move(reply));
          },
          call.profile(), call.String("id")),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_card_number) {
  NN_AUTOFILL_CALL();
  // Load() runs |then| at once or from the profile's own state, so the
  // profile is alive when it does.
  netnyahoo::Load(
      call,
      base::BindOnce(
          [](Profile* profile, std::string id, PersonalDataManager* pdm,
             Reply reply) {
            if (!pdm->payments_data_manager().GetCreditCardByGUID(id)) {
              return reply.Send(base::DictValue().Set("number", base::Value()));
            }
            // Chrome's reauth before a full card number, every time (Chrome's
            // payments page asks when its mandatory reauth is on).
            netnyahoo::Reauth(
                profile, device_reauth::DeviceAuthSource::kAutofill,
                l10n_util::GetStringUTF16(
                    IDS_PAYMENTS_AUTOFILL_EDIT_CARD_MANDATORY_REAUTH_PROMPT),
                base::TimeDelta(),
                base::BindOnce(
                    [](std::string id, base::WeakPtr<PersonalDataManager> pdm,
                       Reply reply, bool authenticated) {
                      const autofill::CreditCard* card =
                          authenticated && pdm
                              ? pdm->payments_data_manager()
                                    .GetCreditCardByGUID(id)
                              : nullptr;
                      std::string number =
                          card ? netnyahoo::Digits(base::UTF16ToUTF8(
                                     card->GetRawInfo(
                                         autofill::CREDIT_CARD_NUMBER)))
                               : std::string();
                      base::DictValue result;
                      if (number.empty()) {
                        result.Set("number", base::Value());
                      } else {
                        result.Set("number", number);
                      }
                      result.Set("authenticated", authenticated);
                      reply.Send(std::move(result));
                    },
                    id, pdm->GetWeakPtr(), std::move(reply)));
          },
          call.profile(), call.String("id")),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_import) {
  // Parsed here, not by Call, so this copy of the card numbers is ours to
  // zero.
  Call call(profile_dir, nullptr, reply, context);
  if (!call) {
    return;
  }
  if (call.profile()->IsOffTheRecord()) {
    return call.TakeReply().Error("private profile");
  }
  netnyahoo::ImportBatch batch;
  {
    netnyahoo::SensitiveArgs args(args_json, netnyahoo::kMaxImportBytes);
    if (args.too_large()) {
      return call.TakeReply().Error("arguments too large");
    }
    if (!args.dict()) {
      return call.TakeReply().Error("arguments are not a JSON object");
    }
    // Call reads the private-session flag only from arguments it parsed itself:
    // refuse it here as Call refuses it for every call that keeps no state per
    // off-the-record profile (OffTheRecord::kRefuse).
    if (args.dict()->FindBool("offTheRecord").value_or(false)) {
      return call.TakeReply().Error("not for a private session");
    }
    const base::ListValue* addresses = args.dict()->FindList("addresses");
    const base::ListValue* cards = args.dict()->FindList("cards");
    if ((addresses && addresses->size() > netnyahoo::kMaxImportItems) ||
        (cards && cards->size() > netnyahoo::kMaxImportItems)) {
      return call.TakeReply().Error("too many items in one call");
    }
    if (addresses) {
      for (const base::Value& entry : *addresses) {
        if (std::optional<netnyahoo::ImportedAddress> address =
                netnyahoo::ToAddress(entry)) {
          batch.addresses.push_back(std::move(*address));
        } else {
          ++batch.rejected;
        }
      }
    }
    if (cards) {
      for (const base::Value& entry : *cards) {
        if (std::optional<autofill::CreditCard> card =
                netnyahoo::ToCard(entry)) {
          batch.cards.push_back(std::move(*card));
        } else {
          ++batch.rejected;
        }
      }
    }
  }  // The parsed arguments are zeroed here.
  netnyahoo::Load(call,
                  base::BindOnce(&netnyahoo::ImportLoaded, std::move(batch)),
                  call.TakeReply());
}
