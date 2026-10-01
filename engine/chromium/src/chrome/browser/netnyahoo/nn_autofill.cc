// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_autofill.h"

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
#include "components/autofill/core/browser/data_manager/addresses/address_data_manager.h"
#include "components/autofill/core/browser/data_manager/payments/payments_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager.h"
#include "components/autofill/core/browser/data_manager/personal_data_manager_observer.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_i18n_api.h"
#include "components/autofill/core/browser/data_model/addresses/autofill_profile.h"
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
    if (pdm->IsDataLoaded()) {
      return std::move(ready).Run(pdm);
    }
    waiting_.push_back(std::move(ready));
    if (!observation_.IsObserving()) {
      observation_.Observe(pdm);
    }
  }

 private:
  void Release() override {
    observation_.Reset();
    waiting_.clear();
  }

  void OnPersonalDataChanged() override {
    PersonalDataManager* pdm = observation_.GetSource();
    if (!pdm->IsDataLoaded()) {
      return;
    }
    observation_.Reset();
    for (Ready& ready : std::exchange(waiting_, {})) {
      std::move(ready).Run(pdm);
    }
  }

  base::ScopedObservation<PersonalDataManager,
                          autofill::PersonalDataManagerObserver>
      observation_{this};
  std::vector<Ready> waiting_;
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

// Sends |result| once |landed| holds, or an error after kSettleChecks: Chrome
// didn't take the change (a duplicate, say).
void Settle(base::WeakPtr<PersonalDataManager> pdm,
            Check landed,
            base::DictValue result,
            Reply reply,
            int checks_left = kSettleChecks) {
  if (!pdm) {
    return reply.Error("closed");
  }
  if (landed.Run(pdm.get())) {
    return reply.Send(std::move(result));
  }
  if (checks_left <= 1) {
    return reply.Error("Chrome didn't save the change");
  }
  base::SequencedTaskRunner::GetCurrentDefault()->PostDelayedTask(
      FROM_HERE,
      base::BindOnce(&Settle, pdm, landed, std::move(result), std::move(reply),
                     checks_left - 1),
      kSettleStep);
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
          [](base::DictValue address, PersonalDataManager* pdm, Reply reply) {
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
            if (existing) {
              adm.UpdateProfile(profile);
            } else {
              adm.AddProfile(profile);
            }
            netnyahoo::Settle(
                pdm->GetWeakPtr(),
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
          address->Clone()),
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
          [](base::DictValue card, std::string number, PersonalDataManager* pdm,
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
            if (existing) {
              if (existing->Compare(credit_card) != 0) {
                paydm.UpdateCreditCard(credit_card);
              }
            } else {
              paydm.AddCreditCard(credit_card);
            }
            netnyahoo::Settle(
                pdm->GetWeakPtr(),
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
          card->Clone(), call.String("number")),
      call.TakeReply());
}

NN_ENGINE_CALL(nn_autofill_remove) {
  NN_AUTOFILL_CALL();
  netnyahoo::Load(
      call,
      base::BindOnce(
          [](std::string id, PersonalDataManager* pdm, Reply reply) {
            if (pdm->address_data_manager().GetProfileByGUID(id)) {
              pdm->address_data_manager().RemoveProfile(id);
            } else {
              pdm->payments_data_manager().RemoveByGUID(id);
            }
            netnyahoo::Settle(
                pdm->GetWeakPtr(),
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
          call.String("id")),
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
