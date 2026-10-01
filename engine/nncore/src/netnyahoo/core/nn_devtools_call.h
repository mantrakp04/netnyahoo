// Copyright 2026 Netnyahoo. Apache-2.0.
//
// In-process DevTools protocol calls on a tab (as CEF's CefBrowserHost::ExecuteDevToolsMethod).

#ifndef NETNYAHOO_CORE_NN_DEVTOOLS_CALL_H_
#define NETNYAHOO_CORE_NN_DEVTOOLS_CALL_H_

#include <optional>
#include <string>

#include "base/functional/callback.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace nncore {

// Sends {id, method, params} to the tab's DevTools agent (its page target) through a client
// of NNCore's own, attached on the first call and detached when the tab goes. `reply` gets
// the matching reply's result, or its error message; always asynchronously.
using DevToolsReply = base::OnceCallback<void(std::optional<base::DictValue> result,
                                              std::optional<std::string> error)>;
void CallDevTools(content::WebContents* contents,
                  const std::string& method,
                  base::DictValue params,
                  DevToolsReply reply);

}  // namespace nncore

#endif  // NETNYAHOO_CORE_NN_DEVTOOLS_CALL_H_
