// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_sensitive_args.h"

#include <string.h>

#include "base/json/json_reader.h"
#include "third_party/boringssl/src/include/openssl/mem.h"

namespace netnyahoo {

void Cleanse(std::string& string) {
  if (!string.empty()) {
    OPENSSL_cleanse(string.data(), string.size());
  }
}

void Cleanse(std::u16string& string) {
  if (!string.empty()) {
    OPENSSL_cleanse(string.data(), string.size() * sizeof(char16_t));
  }
}

void Cleanse(base::Value& value) {
  if (value.is_string()) {
    Cleanse(value.GetString());
  } else if (value.is_dict()) {
    for (auto [key, child] : value.GetDict()) {
      Cleanse(child);
    }
  } else if (value.is_list()) {
    for (base::Value& child : value.GetList()) {
      Cleanse(child);
    }
  }
}

SensitiveArgs::SensitiveArgs(const char* json, size_t max_bytes) {
  if (!json || !*json) {
    return;
  }
  if (strnlen(json, max_bytes + 1) > max_bytes) {
    too_large_ = true;
    return;
  }
  value_ = base::JSONReader::Read(json, base::JSON_PARSE_CHROMIUM_EXTENSIONS);
}

SensitiveArgs::~SensitiveArgs() {
  if (value_) {
    Cleanse(*value_);
  }
}

base::DictValue* SensitiveArgs::dict() {
  return value_ && value_->is_dict() ? &value_->GetDict() : nullptr;
}

}  // namespace netnyahoo
