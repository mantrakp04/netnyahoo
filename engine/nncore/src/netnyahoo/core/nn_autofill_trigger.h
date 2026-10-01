// Chrome's autofill dropdown on demand, at the tab's focused form field (CEF's
// CefShowAutofillSuggestions, cef-ui-triggers.patch): the field focus Chrome's autofill
// reports is tracked per tab, and a trigger asks that field's renderer for suggestions.

#ifndef NETNYAHOO_CORE_NN_AUTOFILL_TRIGGER_H_
#define NETNYAHOO_CORE_NN_AUTOFILL_TRIGGER_H_

namespace content {
class WebContents;
}

namespace nncore {

void TrackAutofillFocus(content::WebContents* contents);
// passwords: the saved-passwords list (Chrome's manual fallback); else the field's own.
bool ShowAutofillSuggestions(content::WebContents* contents, bool passwords);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_AUTOFILL_TRIGGER_H_
