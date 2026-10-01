#include "netnyahoo/core/nn_strings.h"

#include <optional>
#include <string_view>
#include <utility>

#include "base/auto_reset.h"
#include "base/command_line.h"
#include "base/files/file_path.h"
#include "base/memory/ref_counted_memory.h"
#include "base/no_destructor.h"
#include "chrome/grit/generated_resources.h"
#include "ui/base/ui_base_switches.h"
#include "ui/gfx/image/image.h"

namespace nncore {

namespace {

// Chrome's post-install bubble points at a Window > Extensions item; the app's is a menu of its own.
constexpr char16_t kManageExtensions[] = u"Manage your extensions from the Extensions menu.";

class Strings : public ui::ResourceBundle::Delegate {
 public:
  base::FilePath GetPathForResourcePack(const base::FilePath& pack_path,
                                        ui::ResourceScaleFactor) override {
    return pack_path;  // load it as Chrome would
  }
  gfx::Image GetImageNamed(int) override { return gfx::Image(); }
  gfx::Image GetNativeImageNamed(int) override { return gfx::Image(); }
  bool HasDataResource(int) const override { return false; }
  scoped_refptr<base::RefCountedMemory> LoadDataResourceBytes(
      int,
      ui::ResourceScaleFactor) override {
    return nullptr;
  }
  std::optional<std::string> LoadDataResourceString(int) override {
    return std::nullopt;
  }
  bool GetRawDataResource(int,
                          ui::ResourceScaleFactor,
                          std::string_view*) const override {
    return false;
  }

  // Called on any thread. Chrome's own string is read through the shared bundle again; the
  // flag makes that inner read skip this delegate.
  bool GetLocalizedString(int message_id,
                          std::u16string* value) const override {
    if (message_id == IDS_EXTENSION_INSTALLED_MANAGE_INFO) {
      *value = kManageExtensions;
      return true;
    }
    // (--mangle-localized-strings, a debugging aid, mangles the inner read already; renaming
    // that would mangle it twice.)
    static const bool mangled = base::CommandLine::ForCurrentProcess()->HasSwitch(
        switches::kMangleLocalizedStrings);
    thread_local bool reading = false;
    if (mangled || reading || !ui::ResourceBundle::HasSharedInstance()) {
      return false;
    }
    std::u16string text;
    {
      base::AutoReset<bool> inner(&reading, true);
      text = ui::ResourceBundle::GetSharedInstance().GetLocalizedString(message_id);
    }
    if (!RenameProduct(text)) {
      return false;
    }
    *value = std::move(text);
    return true;
  }
};

bool Letter(char16_t c) {
  return (c >= u'A' && c <= u'Z') || (c >= u'a' && c <= u'z');
}

}  // namespace

ui::ResourceBundle::Delegate* ProductStrings() {
  static base::NoDestructor<Strings> strings;
  return strings.get();
}

bool RenameProduct(std::u16string& text) {
  static constexpr std::u16string_view kFrom = u"Chromium";
  static constexpr std::u16string_view kTo = u"Netnyahoo";
  static constexpr std::u16string_view kCredits[] = {u" Authors", u" open source",
                                                     u"</a> open source"};
  const auto credit = [&](size_t end) {
    const std::u16string_view rest = std::u16string_view(text).substr(end);
    for (std::u16string_view after : kCredits) {
      if (rest.starts_with(after)) {
        return true;
      }
    }
    return false;
  };
  bool renamed = false;
  for (size_t at = text.find(kFrom); at != std::u16string::npos;
       at = text.find(kFrom, at)) {
    const size_t end = at + kFrom.size();
    if ((at > 0 && Letter(text[at - 1])) ||
        (end < text.size() && Letter(text[end])) || credit(end)) {
      at = end;
      continue;
    }
    text.replace(at, kFrom.size(), kTo);
    at += kTo.size();
    renamed = true;
  }
  return renamed;
}

}  // namespace nncore
