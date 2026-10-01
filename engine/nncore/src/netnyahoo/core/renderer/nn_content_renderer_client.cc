#include "netnyahoo/core/renderer/nn_content_renderer_client.h"

#include <map>
#include <optional>
#include <string>
#include <tuple>
#include <utility>

#include "base/functional/bind.h"
#include "base/memory/weak_ptr.h"
#include "base/no_destructor.h"
#include "content/public/common/isolated_world_ids.h"
#include "content/public/renderer/render_frame.h"
#include "content/public/renderer/render_frame_observer.h"
#include "content/public/renderer/render_thread.h"
#include "content/public/renderer/render_thread_observer.h"
#include "gin/arguments.h"
#include "gin/converter.h"
#include "gin/function_template.h"
#include "mojo/public/cpp/bindings/associated_receiver.h"
#include "mojo/public/cpp/bindings/associated_receiver_set.h"
#include "mojo/public/cpp/bindings/associated_remote.h"
#include "netnyahoo/core/mojom/nncore.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "url/gurl.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-isolate.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-persistent-handle.h"
#include "v8/include/v8-primitive.h"

namespace nncore {

namespace {

// The page script this process runs; set by the browser before any frame exists here.
std::string& PageScript() {
  static base::NoDestructor<std::string> script;
  return *script;
}

blink::WebScriptSource Source(const std::string& code, const char* url) {
  return blink::WebScriptSource(blink::WebString::FromUtf8(code),
                                blink::WebURL(GURL(url)));
}

// One frame: runs the page script in its main world at document start, keeps the script's
// receive function, and carries messages both ways.
class NNPageObserver : public content::RenderFrameObserver,
                       public mojom::NNPage {
 public:
  explicit NNPageObserver(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame) {
    frame->GetAssociatedInterfaceRegistry()->AddInterface<mojom::NNPage>(
        base::BindRepeating(&NNPageObserver::BindPage,
                            weak_factory_.GetWeakPtr()));
  }

  ~NNPageObserver() override { AnswerAll(); }

  // content::RenderFrameObserver:
  void OnDestruct() override { delete this; }

  void DidCreateScriptContext(v8::Local<v8::Context> context,
                              int32_t world_id) override {
    if (world_id != content::ISOLATED_WORLD_ID_GLOBAL || PageScript().empty()) {
      return;
    }
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Context::Scope context_scope(context);
    receive_.Reset();
    // Before the page's own scripts: the document's first script context.
    v8::Local<v8::Value> install = frame->ExecuteScriptAndReturnValue(
        Source(PageScript(), "netnyahoo://page-script"));
    if (install.IsEmpty() || !install->IsFunction()) {
      return;
    }
    v8::Local<v8::Value> post = PostFunction(isolate, context, std::nullopt);
    v8::Local<v8::Value> receive;
    if (!frame
             ->CallFunctionEvenIfScriptDisabled(install.As<v8::Function>(),
                                                v8::Undefined(isolate), 1, &post)
             .ToLocal(&receive) ||
        !receive->IsFunction()) {
      return;
    }
    receive_.Reset(isolate, receive.As<v8::Function>());
    receive_context_.Reset(isolate, context);
  }

  void WillReleaseScriptContext(v8::Local<v8::Context> context,
                                int32_t world_id) override {
    if (world_id != content::ISOLATED_WORLD_ID_GLOBAL) {
      return;
    }
    receive_.Reset();
    receive_context_.Reset();
    // A new document's evaluations start over; the old ones get no answer.
    AnswerAll();
  }

  // mojom::NNPage:
  void CallPage(const std::string& kind, const std::string& json) override {
    if (receive_.IsEmpty()) {
      return;
    }
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = receive_context_.Get(isolate);
    v8::Context::Scope context_scope(context);
    v8::Local<v8::Value> args[] = {gin::StringToV8(isolate, kind),
                                   gin::StringToV8(isolate, json)};
    std::ignore = frame->CallFunctionEvenIfScriptDisabled(
        receive_.Get(isolate), v8::Undefined(isolate), 2, args);
  }

  void Execute(const std::string& code) override {
    render_frame()->GetWebFrame()->ExecuteScript(
        Source(code, "netnyahoo://execute"));
  }

  void Evaluate(const std::string& code, EvaluateCallback callback) override {
    blink::WebLocalFrame* frame = render_frame()->GetWebFrame();
    v8::Isolate* isolate = frame->GetAgentGroupScheduler()->Isolate();
    v8::HandleScope handle_scope(isolate);
    v8::Local<v8::Context> context = frame->MainWorldScriptContext();
    if (context.IsEmpty()) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    v8::Context::Scope context_scope(context);
    // Strict, so a page function it calls can't walk up to it (`arguments.callee.caller`
    // is null for a strict caller) and take `post` to answer for it.
    v8::Local<v8::Value> fn = frame->ExecuteScriptAndReturnValue(
        Source("(function(post){'use strict';\n" + code + "\n})",
               "netnyahoo://evaluate"));
    if (fn.IsEmpty() || !fn->IsFunction()) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    const int id = ++last_evaluation_;
    evaluations_[id] = std::move(callback);
    v8::Local<v8::Value> post = PostFunction(isolate, context, id);
    v8::Local<v8::Value> result;
    if (!frame
             ->CallFunctionEvenIfScriptDisabled(fn.As<v8::Function>(),
                                                v8::Undefined(isolate), 1, &post)
             .ToLocal(&result)) {
      // It threw (an answer posted before the throw still counts).
      Answer(id, std::nullopt);
    }
  }

 private:
  void BindPage(mojo::PendingAssociatedReceiver<mojom::NNPage> receiver) {
    page_receivers_.Add(this, std::move(receiver));
  }

  v8::Local<v8::Value> PostFunction(v8::Isolate* isolate,
                                    v8::Local<v8::Context> context,
                                    std::optional<int> evaluation) {
    return gin::CreateFunctionTemplate(
               isolate, base::BindRepeating(&NNPageObserver::Post,
                                            weak_factory_.GetWeakPtr(),
                                            evaluation))
        ->GetFunction(context)
        .ToLocalChecked();
  }

  // post(kind, json): json is a string the script serialized ("null" otherwise).
  void Post(std::optional<int> evaluation, gin::Arguments* args) {
    std::string kind;
    if (!args->GetNext(&kind)) {
      return;
    }
    std::string json = "null";
    v8::Local<v8::Value> value;
    if (args->GetNext(&value) && value->IsString()) {
      json = gin::V8ToString(args->isolate(), value);
    }
    if (evaluation && kind == "result") {
      Answer(*evaluation, std::move(json));
      return;
    }
    if (!host_.is_bound()) {
      render_frame()->GetRemoteAssociatedInterfaces()->GetInterface(&host_);
    }
    host_->Post(kind, json);
  }

  void Answer(int id, std::optional<std::string> json) {
    auto it = evaluations_.find(id);
    if (it == evaluations_.end()) {
      return;
    }
    EvaluateCallback callback = std::move(it->second);
    evaluations_.erase(it);
    std::move(callback).Run(std::move(json));
  }

  // Mojo wants every response callback run, even with no answer.
  void AnswerAll() {
    std::map<int, EvaluateCallback> pending = std::move(evaluations_);
    evaluations_.clear();
    for (auto& [id, callback] : pending) {
      std::move(callback).Run(std::nullopt);
    }
  }

  mojo::AssociatedReceiverSet<mojom::NNPage> page_receivers_;
  mojo::AssociatedRemote<mojom::NNPageHost> host_;
  v8::Global<v8::Function> receive_;
  v8::Global<v8::Context> receive_context_;
  std::map<int, EvaluateCallback> evaluations_;
  int last_evaluation_ = 0;
  base::WeakPtrFactory<NNPageObserver> weak_factory_{this};
};

}  // namespace

// The process's NNRendererConfig: the browser sends the page script on the IPC channel
// right after launch, ahead of any frame creation.
class NNRenderThreadObserver : public content::RenderThreadObserver,
                               public mojom::NNRendererConfig {
 public:
  // content::RenderThreadObserver:
  void RegisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->AddInterface<mojom::NNRendererConfig>(
        base::BindRepeating(&NNRenderThreadObserver::Bind,
                            base::Unretained(this)));
  }
  void UnregisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->RemoveInterface(mojom::NNRendererConfig::Name_);
  }

  // mojom::NNRendererConfig:
  void SetPageScript(const std::string& script) override {
    PageScript() = script;
  }

 private:
  void Bind(mojo::PendingAssociatedReceiver<mojom::NNRendererConfig> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

  mojo::AssociatedReceiverSet<mojom::NNRendererConfig> receivers_;
};

NNContentRendererClient::NNContentRendererClient() = default;
NNContentRendererClient::~NNContentRendererClient() = default;

void NNContentRendererClient::RenderThreadStarted() {
  ChromeContentRendererClient::RenderThreadStarted();
  observer_ = std::make_unique<NNRenderThreadObserver>();
  content::RenderThread::Get()->AddObserver(observer_.get());
}

void NNContentRendererClient::RenderFrameCreated(
    content::RenderFrame* render_frame) {
  ChromeContentRendererClient::RenderFrameCreated(render_frame);
  new NNPageObserver(render_frame);  // Owns itself (OnDestruct).
}

}  // namespace nncore
