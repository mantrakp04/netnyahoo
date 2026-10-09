// Copyright 2026 Arcadia. Apache-2.0.

#include "chrome/browser/arcadia/ac_omnibox.h"

#include "base/values.h"

AC_ENGINE_CALL(ac_omnibox_opened) {
  arcadia::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  // 2: the window-close and quit fix (an engine that answered {} had only the first two).
  call.TakeReply().Send(base::DictValue().Set("prewarm", 2));
}
