// Copyright 2026 Netnyahoo. Apache-2.0.
//
// Arguments that carry secrets (decrypted cookie values, card numbers): a
// call parses them itself, before it returns (the caller zeroes its buffer
// then), and every copy it owns is zeroed with a write the compiler can't drop
// before it's freed. Never log them.

#ifndef CHROME_BROWSER_NETNYAHOO_NN_SENSITIVE_ARGS_H_
#define CHROME_BROWSER_NETNYAHOO_NN_SENSITIVE_ARGS_H_

#include <cstddef>
#include <optional>
#include <string>

#include "base/values.h"

namespace netnyahoo {

// Zero in place: a string's characters, or every string in a value.
void Cleanse(std::string& string);
void Cleanse(std::u16string& string);
void Cleanse(base::Value& value);

// The call's own parse of its args_json, zeroed when this goes away. dict() is
// null when the JSON is missing, over |max_bytes| (too_large()) or not an
// object.
class SensitiveArgs {
 public:
  SensitiveArgs(const char* json, size_t max_bytes);
  SensitiveArgs(const SensitiveArgs&) = delete;
  SensitiveArgs& operator=(const SensitiveArgs&) = delete;
  ~SensitiveArgs();

  bool too_large() const { return too_large_; }
  base::DictValue* dict();

 private:
  std::optional<base::Value> value_;
  bool too_large_ = false;
};

}  // namespace netnyahoo

#endif  // CHROME_BROWSER_NETNYAHOO_NN_SENSITIVE_ARGS_H_
