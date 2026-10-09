#include "arcadia/core/renderer/ac_content_renderer_client.h"

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
#include "arcadia/core/mojom/arcadiacore.mojom.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_provider.h"
#include "third_party/blink/public/common/associated_interfaces/associated_interface_registry.h"
#include "third_party/blink/public/platform/scheduler/web_agent_group_scheduler.h"
#include "third_party/blink/public/platform/web_string.h"
#include "third_party/blink/public/platform/web_url.h"
#include "third_party/blink/public/web/web_local_frame.h"
#include "third_party/blink/public/web/web_script_source.h"
#include "third_party/blink/public/mojom/frame/user_activation_notification_type.mojom.h"
#include "url/gurl.h"
#include "v8/include/v8-context.h"
#include "v8/include/v8-function.h"
#include "v8/include/v8-isolate.h"
#include "v8/include/v8-local-handle.h"
#include "v8/include/v8-persistent-handle.h"
#include "v8/include/v8-primitive.h"

namespace arcadiacore {

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
class ACPageObserver : public content::RenderFrameObserver,
                       public mojom::ACPage {
 public:
  explicit ACPageObserver(content::RenderFrame* frame)
      : content::RenderFrameObserver(frame) {
    frame->GetAssociatedInterfaceRegistry()->AddInterface<mojom::ACPage>(
        base::BindRepeating(&ACPageObserver::BindPage,
                            weak_factory_.GetWeakPtr()));
  }

  ~ACPageObserver() override { AnswerAll(); }

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
    // Script can remove this frame (and this observer) synchronously, e.g. a same-origin
    // parent removing the iframe: check after every call into it.
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    // Before the page's own scripts: the document's first script context.
    v8::Local<v8::Value> install = frame->ExecuteScriptAndReturnValue(
        Source(PageScript(), "arcadia://page-script"));
    if (!alive || install.IsEmpty() || !install->IsFunction()) {
      return;
    }
    v8::Local<v8::Value> post = PostFunction(isolate, context, std::nullopt);
    v8::Local<v8::Value> receive;
    const bool ran = frame
                         ->CallFunctionEvenIfScriptDisabled(
                             install.As<v8::Function>(), v8::Undefined(isolate),
                             1, &post)
                         .ToLocal(&receive);
    if (!alive || !ran || !receive->IsFunction() ||
        frame->MainWorldScriptContext() != context) {
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

  // mojom::ACPage:
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

  void Execute(const std::string& code, bool user_gesture) override {
    if (user_gesture) {
      NotifyUserActivation();
    }
    render_frame()->GetWebFrame()->ExecuteScript(
        Source(code, "arcadia://execute"));
  }

  void Evaluate(const std::string& code,
                bool user_gesture,
                EvaluateCallback callback) override {
    if (user_gesture) {
      NotifyUserActivation();
    }
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
               "arcadia://evaluate"));
    if (fn.IsEmpty() || !fn->IsFunction()) {
      std::move(callback).Run(std::nullopt);
      return;
    }
    const int id = ++last_evaluation_;
    evaluations_[id] = std::move(callback);
    v8::Local<v8::Value> post = PostFunction(isolate, context, id);
    v8::Local<v8::Value> result;
    base::WeakPtr<ACPageObserver> alive = weak_factory_.GetWeakPtr();
    const bool ran = frame
                         ->CallFunctionEvenIfScriptDisabled(
                             fn.As<v8::Function>(), v8::Undefined(isolate), 1,
                             &post)
                         .ToLocal(&result);
    if (alive && !ran) {
      // It threw (an answer posted before the throw still counts).
      Answer(id, std::nullopt);
    }
  }

 private:
  // As CEF's EvaluateWithGesture: a transient activation, as a click would give.
  void NotifyUserActivation() {
    render_frame()->GetWebFrame()->NotifyUserActivation(
        blink::mojom::UserActivationNotificationType::kInteraction);
  }

  void BindPage(mojo::PendingAssociatedReceiver<mojom::ACPage> receiver) {
    page_receivers_.Add(this, std::move(receiver));
  }

  v8::Local<v8::Value> PostFunction(v8::Isolate* isolate,
                                    v8::Local<v8::Context> context,
                                    std::optional<int> evaluation) {
    return gin::CreateFunctionTemplate(
               isolate, base::BindRepeating(&ACPageObserver::Post,
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

  mojo::AssociatedReceiverSet<mojom::ACPage> page_receivers_;
  mojo::AssociatedRemote<mojom::ACPageHost> host_;
  v8::Global<v8::Function> receive_;
  v8::Global<v8::Context> receive_context_;
  std::map<int, EvaluateCallback> evaluations_;
  int last_evaluation_ = 0;
  base::WeakPtrFactory<ACPageObserver> weak_factory_{this};
};

}  // namespace

// The process's ACRendererConfig: the browser sends the page script on the IPC channel
// right after launch, ahead of any frame creation.
class ACRenderThreadObserver : public content::RenderThreadObserver,
                               public mojom::ACRendererConfig {
 public:
  // content::RenderThreadObserver:
  void RegisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->AddInterface<mojom::ACRendererConfig>(
        base::BindRepeating(&ACRenderThreadObserver::Bind,
                            base::Unretained(this)));
  }
  void UnregisterMojoInterfaces(
      blink::AssociatedInterfaceRegistry* associated_interfaces) override {
    associated_interfaces->RemoveInterface(mojom::ACRendererConfig::Name_);
  }

  // mojom::ACRendererConfig:
  void SetPageScript(const std::string& script) override {
    PageScript() = script;
  }

 private:
  void Bind(mojo::PendingAssociatedReceiver<mojom::ACRendererConfig> receiver) {
    receivers_.Add(this, std::move(receiver));
  }

  mojo::AssociatedReceiverSet<mojom::ACRendererConfig> receivers_;
};

ACContentRendererClient::ACContentRendererClient() = default;
ACContentRendererClient::~ACContentRendererClient() = default;

void ACContentRendererClient::RenderThreadStarted() {
  ChromeContentRendererClient::RenderThreadStarted();
  observer_ = std::make_unique<ACRenderThreadObserver>();
  content::RenderThread::Get()->AddObserver(observer_.get());
}

void ACContentRendererClient::RenderFrameCreated(
    content::RenderFrame* render_frame) {
  ChromeContentRendererClient::RenderFrameCreated(render_frame);
  new ACPageObserver(render_frame);  // Owns itself (OnDestruct).
}

}  // namespace arcadiacore
