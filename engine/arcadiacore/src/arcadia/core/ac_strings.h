// Chrome's own UI (bubbles, dialogs, its WebUI pages, the renderer's error pages) names the
// product "Chromium", literally in every locale's strings rather than through the branding
// file. ArcadiaCore says Arcadia instead, as Chrome says Chrome, the way CEF's build did
// (packages/cef/ios/ACCef.mm, class Strings): one ResourceBundle delegate for every process
// that loads Chrome's strings (browser, renderer, utility, GPU).

#ifndef ARCADIA_CORE_AC_STRINGS_H_
#define ARCADIA_CORE_AC_STRINGS_H_

#include <string>

#include "ui/base/resource/resource_bundle.h"

namespace arcadiacore {

// Lives for the process (ResourceBundle never owns its delegate).
ui::ResourceBundle::Delegate* ProductStrings();

// Whole words only ("Chromium's" → "Arcadia's"; "ChromiumOS" stays). The credits stay:
// "The Chromium Authors", "made possible by the Chromium open source project". Returns
// whether anything changed.
bool RenameProduct(std::u16string& text);

}  // namespace arcadiacore

#endif  // ARCADIA_CORE_AC_STRINGS_H_
