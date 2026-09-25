// Entry point for every CEF child process (renderer, GPU, utility…).
// Built by scripts/embed.sh into "<App> Helper*.app" bundles.
#include <map>
#include <string>

#include "include/cef_app.h"
#include "include/cef_command_line.h"
#include "include/cef_parser.h"
#include "include/cef_sandbox_mac.h"
#include "include/wrapper/cef_library_loader.h"

#include "page_script.h"

namespace {

/// Native `post(kind, json[, id])` that forwards to the browser process.
class PostHandler : public CefV8Handler {
 public:
  explicit PostHandler(int evalId = 0) : eval_id_(evalId) {}
  bool Execute(const CefString &name, CefRefPtr<CefV8Value> object, const CefV8ValueList &args,
               CefRefPtr<CefV8Value> &retval, CefString &exception) override {
    if (args.size() < 2 || !args[0]->IsString()) return true;
    CefRefPtr<CefV8Context> context = CefV8Context::GetCurrentContext();
    CefRefPtr<CefProcessMessage> message = CefProcessMessage::Create("nn");
    CefRefPtr<CefListValue> list = message->GetArgumentList();
    list->SetString(0, args[0]->GetStringValue());
    list->SetString(1, args[1]->IsString() ? args[1]->GetStringValue() : CefString("null"));
    if (eval_id_) list->SetInt(2, eval_id_);
    context->GetFrame()->SendProcessMessage(PID_BROWSER, message);
    return true;
  }

 private:
  int eval_id_;
  IMPLEMENT_REFCOUNTING(PostHandler);
};

/// The page script's `receive(kind, json)` for each frame's current context,
/// so the browser can call into it ("nn-call" messages).
struct Receiver {
  CefRefPtr<CefV8Context> context;
  CefRefPtr<CefV8Value> receive;
};

class RendererApp : public CefApp, public CefRenderProcessHandler {
 public:
  CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override { return this; }

  void OnContextCreated(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                        CefRefPtr<CefV8Context> context) override {
    // The page's own world only: extensions' content scripts (uBlock Origin Lite…) get
    // isolated worlds of their own, whose script instance would take over `receive`.
    CefRefPtr<CefV8Context> main = frame->GetV8Context();
    if (main && !main->IsSame(context)) return;
    // The page script receives `post` as an argument, so pages can't reach it.
    CefRefPtr<CefV8Value> retval;
    CefRefPtr<CefV8Exception> exception;
    if (!context->Eval(kPageScript, "netnyahoo://page-script", 0, retval, exception) || !retval || !retval->IsFunction())
      return;
    CefRefPtr<CefV8Value> post = CefV8Value::CreateFunction("post", new PostHandler());
    CefRefPtr<CefV8Value> receive = retval->ExecuteFunctionWithContext(context, nullptr, {post});
    if (receive && receive->IsFunction()) receivers_[frame->GetIdentifier().ToString()] = {context, receive};
  }

  void OnContextReleased(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                         CefRefPtr<CefV8Context> context) override {
    auto it = receivers_.find(frame->GetIdentifier().ToString());
    if (it != receivers_.end() && it->second.context->IsSame(context)) receivers_.erase(it);
  }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, CefProcessId source,
                                CefRefPtr<CefProcessMessage> message) override {
    if (message->GetName() == "nn-call") {
      auto it = receivers_.find(frame->GetIdentifier().ToString());
      if (it == receivers_.end() || !it->second.context->IsValid()) return true;
      CefRefPtr<CefListValue> args = message->GetArgumentList();
      CefRefPtr<CefV8Context> context = it->second.context;
      context->Enter();
      it->second.receive->ExecuteFunctionWithContext(
          context, nullptr, {CefV8Value::CreateString(args->GetString(0)), CefV8Value::CreateString(args->GetString(1))});
      context->Exit();
      return true;
    }
    if (message->GetName() != "nn-eval") return false;
    int id = message->GetArgumentList()->GetInt(0);
    std::string code = message->GetArgumentList()->GetString(1);
    CefRefPtr<CefV8Context> context = frame->GetV8Context();
    auto fail = [&](const std::string &error) {
      CefRefPtr<CefProcessMessage> reply = CefProcessMessage::Create("nn");
      CefRefPtr<CefValue> json = CefValue::Create();
      CefRefPtr<CefDictionaryValue> body = CefDictionaryValue::Create();
      body->SetString("error", error);
      json->SetDictionary(body);
      reply->GetArgumentList()->SetString(0, "result");
      reply->GetArgumentList()->SetString(1, CefWriteJSON(json, JSON_WRITER_DEFAULT));
      reply->GetArgumentList()->SetInt(2, id);
      frame->SendProcessMessage(PID_BROWSER, reply);
    };
    if (!context) {
      fail("no context");
      return true;
    }
    // Values must be created and called inside the context (unlike in
    // OnContextCreated, it isn't entered for us here).
    context->Enter();
    CefRefPtr<CefV8Value> fn;
    CefRefPtr<CefV8Exception> exception;
    std::string wrapped = "(function(post){\n" + code + "\n})";
    if (!context->Eval(wrapped, "netnyahoo://eval", 0, fn, exception) || !fn || !fn->IsFunction()) {
      context->Exit();
      fail(exception ? exception->GetMessage().ToString() : "eval failed");
      return true;
    }
    CefRefPtr<CefV8Value> post = CefV8Value::CreateFunction("post", new PostHandler(id));
    CefRefPtr<CefV8Value> result = fn->ExecuteFunctionWithContext(context, nullptr, {post});
    // A synchronous throw would otherwise leave the caller waiting forever.
    if (!result && fn->HasException()) fail(fn->GetException()->GetMessage().ToString());
    context->Exit();
    return true;
  }

 private:
  std::map<std::string, Receiver> receivers_;
  IMPLEMENT_REFCOUNTING(RendererApp);
};

}  // namespace

int main(int argc, char *argv[]) {
  CefScopedSandboxContext sandbox_context;
  if (!sandbox_context.Initialize(argc, argv)) return 1;

  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInHelper()) return 1;

  CefMainArgs main_args(argc, argv);
  CefRefPtr<CefCommandLine> command_line = CefCommandLine::CreateCommandLine();
  command_line->InitFromArgv(argc, argv);
  CefRefPtr<CefApp> app;
  if (command_line->GetSwitchValue("type") == "renderer") app = new RendererApp();
  return CefExecuteProcess(main_args, app, nullptr);
}
