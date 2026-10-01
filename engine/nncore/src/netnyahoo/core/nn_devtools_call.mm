// Copyright 2026 Netnyahoo. Apache-2.0.

#include "netnyahoo/core/nn_devtools_call.h"

#include <map>
#include <utility>

#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/memory/scoped_refptr.h"
#include "base/task/single_thread_task_runner.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/devtools_agent_host_client.h"
#include "content/public/browser/web_contents.h"
#include "content/public/browser/web_contents_user_data.h"

namespace nncore {

namespace {

void Answer(DevToolsReply reply,
            std::optional<base::DictValue> result,
            std::optional<std::string> error) {
  // Never from inside the agent host's dispatch or teardown: the host may close the tab.
  base::SingleThreadTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(std::move(reply), std::move(result), std::move(error)));
}

// NNCore's own DevTools client of one tab: attached on its first call, like any other
// client (the remote-debugging port's keep working beside it), and detached with the tab.
class DevToolsCaller : public content::DevToolsAgentHostClient,
                       public content::WebContentsUserData<DevToolsCaller> {
 public:
  ~DevToolsCaller() override {
    if (host_) {
      host_->DetachClient(this);
    }
    FailAll("the tab is gone");
  }

  void Call(const std::string& method, base::DictValue params, DevToolsReply reply) {
    if (!host_) {
      host_ = content::DevToolsAgentHost::GetOrCreateFor(&GetWebContents());
      if (!host_ || !host_->AttachClient(this)) {
        host_ = nullptr;
        Answer(std::move(reply), std::nullopt, "can't attach to the tab");
        return;
      }
    }
    const int id = next_id_++;
    base::DictValue message;
    message.Set("id", id);
    message.Set("method", method);
    message.Set("params", std::move(params));
    std::optional<std::string> json = base::WriteJson(message);
    if (!json) {
      Answer(std::move(reply), std::nullopt, "params aren't JSON");
      return;
    }
    pending_[id] = std::move(reply);
    // The agent host may answer (or close) from inside the call.
    scoped_refptr<content::DevToolsAgentHost> host = host_;
    host->DispatchProtocolMessage(this, base::as_byte_span(*json));
  }

  // content::DevToolsAgentHostClient:
  void DispatchProtocolMessage(content::DevToolsAgentHost* agent_host,
                               base::span<const uint8_t> message) override {
    std::optional<base::DictValue> parsed = base::JSONReader::ReadDict(
        base::as_string_view(message), base::JSON_PARSE_CHROMIUM_EXTENSIONS);
    if (!parsed) {
      return;
    }
    std::optional<int> id = parsed->FindInt("id");
    if (!id) {
      return;  // an event
    }
    auto it = pending_.find(*id);
    if (it == pending_.end()) {
      return;
    }
    DevToolsReply reply = std::move(it->second);
    pending_.erase(it);
    if (base::DictValue* error = parsed->FindDict("error")) {
      const std::string* text = error->FindString("message");
      Answer(std::move(reply), std::nullopt, text ? *text : "error");
      return;
    }
    base::DictValue* result = parsed->FindDict("result");
    Answer(std::move(reply), result ? std::move(*result) : base::DictValue(),
           std::nullopt);
  }

  void AgentHostClosed(content::DevToolsAgentHost* agent_host) override {
    host_ = nullptr;
    FailAll("the tab's DevTools target closed");
  }

  // Like the remote-debugging port's clients: not an extension's chrome.debugger.
  bool MayAttachToURL(const GURL& url, bool is_webui) override { return true; }
  bool IsTrusted() override { return true; }
  bool MayReadLocalFiles() override { return false; }
  bool MayWriteLocalFiles() override { return false; }

 private:
  friend class content::WebContentsUserData<DevToolsCaller>;
  explicit DevToolsCaller(content::WebContents* contents)
      : content::WebContentsUserData<DevToolsCaller>(*contents) {}

  void FailAll(const std::string& why) {
    std::map<int, DevToolsReply> pending = std::move(pending_);
    pending_.clear();
    for (auto& [id, reply] : pending) {
      Answer(std::move(reply), std::nullopt, why);
    }
  }

  scoped_refptr<content::DevToolsAgentHost> host_;
  int next_id_ = 1;
  std::map<int, DevToolsReply> pending_;
  WEB_CONTENTS_USER_DATA_KEY_DECL();
};

WEB_CONTENTS_USER_DATA_KEY_IMPL(DevToolsCaller);

}  // namespace

void CallDevTools(content::WebContents* contents,
                  const std::string& method,
                  base::DictValue params,
                  DevToolsReply reply) {
  if (!contents) {
    Answer(std::move(reply), std::nullopt, "no tab");
    return;
  }
  DevToolsCaller::CreateForWebContents(contents);
  DevToolsCaller::FromWebContents(contents)->Call(method, std::move(params),
                                                  std::move(reply));
}

}  // namespace nncore
