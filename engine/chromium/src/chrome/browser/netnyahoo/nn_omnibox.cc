// Copyright 2026 Netnyahoo. Apache-2.0.

#include "chrome/browser/netnyahoo/nn_omnibox.h"

#include "base/values.h"

NN_ENGINE_CALL(nn_omnibox_opened) {
  netnyahoo::Call call(profile_dir, args_json, reply, context);
  if (!call) {
    return;
  }
  // 2: the window-close and quit fix (an engine that answered {} had only the first two).
  call.TakeReply().Send(base::DictValue().Set("prewarm", 2));
}
